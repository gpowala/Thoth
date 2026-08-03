// ThothInputCapture — native messaging host for the Thoth browser recorder.
//
// Purpose: capture keystrokes the browser cannot observe. Opaque remote-app
// iframes (e.g. Thinfinity) grab the keyboard so deeply that no in-page listener
// — content script or CDP — sees what the user types. This host installs an
// OS-level low-level keyboard hook (WH_KEYBOARD_LL), which sits BELOW the app's
// grab, and streams the keystrokes back to the extension. Because we always call
// CallNextHookEx, the app still receives the keys and updates live — we only
// observe; we never inject or swallow.
//
// Safety: the hook is inert until the extension sends {"cmd":"arm"} (it only arms
// while the user is inside an opaque frame), and even when armed we forward keys
// ONLY while the foreground window belongs to a known browser. So we never record
// keystrokes typed into other applications.
//
// Protocol: Chrome native messaging — each message is a 4-byte little-endian
// length prefix followed by that many UTF-8 JSON bytes, over stdin/stdout.
//
//   extension -> host : {"cmd":"arm"} | {"cmd":"disarm"}
//   host -> extension : {"type":"hello","version":"1.0"}
//                       {"type":"key","key":"<char|Named>","clientTime":<ms>}

using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace ThothInputCapture
{
    internal static class Program
    {
        private static volatile bool _armed = false;
        private static readonly object _outLock = new object();
        private static Stream _stdout;

        private static IntPtr _hookId = IntPtr.Zero;
        private static NativeMethods.LowLevelKeyboardProc _hookProc; // kept alive against GC

        // Foreground apps we are willing to capture from (browsers that can host
        // the recorder). Everything else (Notepad, Slack, ...) is ignored even if
        // the hook happens to be armed.
        private static readonly HashSet<string> BrowserExes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "msedge.exe", "chrome.exe", "brave.exe", "chromium.exe", "opera.exe", "vivaldi.exe"
        };

        [STAThread]
        private static void Main()
        {
            _stdout = Console.OpenStandardOutput();

            // Install the hook on a dedicated thread with a message pump (required
            // for WH_KEYBOARD_LL to deliver callbacks).
            var hookThread = new Thread(HookThreadMain) { IsBackground = true, Name = "thoth-kbd-hook" };
            hookThread.SetApartmentState(ApartmentState.STA);
            hookThread.Start();

            Send("{\"type\":\"hello\",\"version\":\"1.0\"}");

            // Read commands from the browser until the pipe closes (browser exit).
            try
            {
                var stdin = Console.OpenStandardInput();
                var lenBuf = new byte[4];
                while (ReadExact(stdin, lenBuf, 4))
                {
                    int len = BitConverter.ToInt32(lenBuf, 0); // little-endian on Windows
                    if (len <= 0 || len > 1_000_000) break;
                    var buf = new byte[len];
                    if (!ReadExact(stdin, buf, len)) break;
                    HandleCommand(Encoding.UTF8.GetString(buf));
                }
            }
            catch { /* fall through to exit */ }

            // Browser is gone — tear down and exit.
            if (_hookId != IntPtr.Zero) NativeMethods.UnhookWindowsHookEx(_hookId);
            Environment.Exit(0);
        }

        // ---- Command handling ------------------------------------------------

        private static void HandleCommand(string json)
        {
            // Tiny, dependency-free parse: we only care about the "cmd" value.
            string cmd = ExtractJsonString(json, "cmd");
            if (cmd == "arm") _armed = true;
            else if (cmd == "disarm") _armed = false;
        }

        // ---- Keyboard hook ---------------------------------------------------

        private static void HookThreadMain()
        {
            _hookProc = HookCallback;
            using (var self = System.Diagnostics.Process.GetCurrentProcess())
            using (var module = self.MainModule)
            {
                IntPtr hMod = NativeMethods.GetModuleHandle(module != null ? module.ModuleName : null);
                _hookId = NativeMethods.SetWindowsHookEx(NativeMethods.WH_KEYBOARD_LL, _hookProc, hMod, 0);
            }

            // Message loop — keeps this thread alive and delivers hook callbacks.
            NativeMethods.MSG msg;
            while (NativeMethods.GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { /* no dispatch needed */ }
        }

        private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            try
            {
                if (nCode >= 0 && _armed)
                {
                    int msg = wParam.ToInt32();
                    if (msg == NativeMethods.WM_KEYDOWN || msg == NativeMethods.WM_SYSKEYDOWN)
                    {
                        var data = Marshal.PtrToStructure<NativeMethods.KBDLLHOOKSTRUCT>(lParam);
                        // Ignore anything we synthesized ourselves (we don't inject,
                        // but guard anyway) and only capture while a browser is foreground.
                        if (ForegroundBrowserThread(out uint fgThread))
                        {
                            string key = TranslateKey(data.vkCode, data.scanCode, fgThread);
                            if (key != null && key.Length > 0)
                            {
                                long ms = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                                Send("{\"type\":\"key\",\"key\":" + JsonQuote(key) + ",\"clientTime\":" + ms + "}");
                            }
                        }
                    }
                }
            }
            catch { /* never throw across the native boundary */ }

            return NativeMethods.CallNextHookEx(_hookId, nCode, wParam, lParam);
        }

        // Map a virtual-key to the token vocabulary the extension/backend expect:
        // a single printable character, or a named action key. Returns null for
        // bare modifiers and keys we don't record.
        private static string TranslateKey(uint vk, uint scanCode, uint fgThread)
        {
            switch (vk)
            {
                // Bare modifiers / locks — never a step of their own.
                case 0x10: case 0x11: case 0x12:              // Shift / Control / Alt
                case 0xA0: case 0xA1: case 0xA2: case 0xA3:   // L/R Shift, L/R Control
                case 0xA4: case 0xA5:                         // L/R Alt (Menu)
                case 0x5B: case 0x5C:                         // L/R Win
                case 0x14: case 0x90: case 0x91:              // CapsLock / NumLock / ScrollLock
                    return null;

                case 0x0D: return "Enter";
                case 0x08: return "Backspace";
                case 0x09: return "Tab";
                case 0x1B: return "Escape";
                case 0x2E: return "Delete";
                case 0x25: return "ArrowLeft";
                case 0x26: return "ArrowUp";
                case 0x27: return "ArrowRight";
                case 0x28: return "ArrowDown";
                case 0x24: return "Home";
                case 0x23: return "End";
                case 0x21: return "PageUp";
                case 0x22: return "PageDown";
            }

            // Ctrl held (without AltGr = Ctrl+Alt) means this is a shortcut, not text.
            bool ctrl = (NativeMethods.GetAsyncKeyState(0x11) & 0x8000) != 0;
            bool alt = (NativeMethods.GetAsyncKeyState(0x12) & 0x8000) != 0;
            if (ctrl && !alt) return null;

            // Build the modifier state for translation.
            var keyState = new byte[256];
            if ((NativeMethods.GetAsyncKeyState(0x10) & 0x8000) != 0) keyState[0x10] = 0x80; // Shift
            if (ctrl) keyState[0x11] = 0x80;
            if (alt) keyState[0x12] = 0x80;
            if ((NativeMethods.GetKeyState(0x14) & 0x0001) != 0) keyState[0x14] = 0x01;       // CapsLock toggle

            IntPtr layout = NativeMethods.GetKeyboardLayout(fgThread);
            var sb = new StringBuilder(8);
            // Flag bit 0x04 (Win 10 1607+): translate WITHOUT mutating the kernel
            // keyboard/dead-key state, so we don't corrupt the user's real typing.
            int rc = NativeMethods.ToUnicodeEx(vk, scanCode, keyState, sb, sb.Capacity, 0x04, layout);
            if (rc > 0)
            {
                string s = sb.ToString();
                // Drop control chars (rc can yield \r, \b, etc. for some keys we
                // already named above; keep only real printable text).
                if (s.Length > 0 && !char.IsControl(s[0])) return s;
            }
            return null;
        }

        // True when the foreground window belongs to a known browser; outputs the
        // foreground thread id (used to resolve its keyboard layout).
        private static bool ForegroundBrowserThread(out uint threadId)
        {
            threadId = 0;
            IntPtr hwnd = NativeMethods.GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return false;
            threadId = NativeMethods.GetWindowThreadProcessId(hwnd, out uint pid);
            if (pid == 0) return false;

            string exe = ProcessExeName(pid);
            if (exe == null) return false;
            return BrowserExes.Contains(exe);
        }

        private static string ProcessExeName(uint pid)
        {
            const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
            IntPtr h = NativeMethods.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (h == IntPtr.Zero) return null;
            try
            {
                var sb = new StringBuilder(1024);
                int size = sb.Capacity;
                if (NativeMethods.QueryFullProcessImageName(h, 0, sb, ref size) && size > 0)
                {
                    string full = sb.ToString();
                    int slash = full.LastIndexOfAny(new[] { '\\', '/' });
                    return slash >= 0 ? full.Substring(slash + 1) : full;
                }
            }
            finally { NativeMethods.CloseHandle(h); }
            return null;
        }

        // ---- Native messaging I/O -------------------------------------------

        private static void Send(string json)
        {
            try
            {
                var bytes = Encoding.UTF8.GetBytes(json);
                var len = BitConverter.GetBytes(bytes.Length); // little-endian
                lock (_outLock)
                {
                    _stdout.Write(len, 0, 4);
                    _stdout.Write(bytes, 0, bytes.Length);
                    _stdout.Flush();
                }
            }
            catch { /* browser pipe closed; main loop will exit */ }
        }

        private static bool ReadExact(Stream s, byte[] buf, int count)
        {
            int off = 0;
            while (off < count)
            {
                int n = s.Read(buf, off, count - off);
                if (n <= 0) return false; // EOF
                off += n;
            }
            return true;
        }

        // ---- Minimal JSON helpers (no dependency needed for these tiny messages) --

        private static string JsonQuote(string s)
        {
            var sb = new StringBuilder(s.Length + 2);
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }

        // Extract a top-level string value for `key` from a flat JSON object.
        private static string ExtractJsonString(string json, string key)
        {
            if (json == null) return null;
            string needle = "\"" + key + "\"";
            int i = json.IndexOf(needle, StringComparison.Ordinal);
            if (i < 0) return null;
            i = json.IndexOf(':', i + needle.Length);
            if (i < 0) return null;
            i++;
            while (i < json.Length && char.IsWhiteSpace(json[i])) i++;
            if (i >= json.Length || json[i] != '"') return null;
            i++;
            var sb = new StringBuilder();
            while (i < json.Length && json[i] != '"')
            {
                if (json[i] == '\\' && i + 1 < json.Length) { sb.Append(json[i + 1]); i += 2; }
                else { sb.Append(json[i]); i++; }
            }
            return sb.ToString();
        }
    }

    internal static class NativeMethods
    {
        public const int WH_KEYBOARD_LL = 13;
        public const int WM_KEYDOWN = 0x0100;
        public const int WM_KEYUP = 0x0101;
        public const int WM_SYSKEYDOWN = 0x0104;
        public const int WM_SYSKEYUP = 0x0105;

        public delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        public struct KBDLLHOOKSTRUCT
        {
            public uint vkCode;
            public uint scanCode;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int x; public int y; }

        [StructLayout(LayoutKind.Sequential)]
        public struct MSG
        {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public POINT pt;
        }

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        public static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll")]
        public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        public static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll")]
        public static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll")]
        public static extern short GetKeyState(int nVirtKey);

        [DllImport("user32.dll")]
        public static extern IntPtr GetKeyboardLayout(uint idThread);

        [DllImport("user32.dll")]
        public static extern int ToUnicodeEx(uint wVirtKey, uint wScanCode, byte[] lpKeyState,
            [Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pwszBuff, int cchBuff, uint wFlags, IntPtr dwhkl);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr OpenProcess(uint dwDesiredAccess, [MarshalAs(UnmanagedType.Bool)] bool bInheritHandle, uint dwProcessId);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool QueryFullProcessImageName(IntPtr hProcess, uint dwFlags, StringBuilder lpExeName, ref int lpdwSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool CloseHandle(IntPtr hObject);
    }
}
