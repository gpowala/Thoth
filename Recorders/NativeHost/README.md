# Thoth Native Input Capture

An OS-level keyboard-capture companion for the Thoth browser recorder.

## Why this exists

Opaque remote-app iframes — chiefly **Thinfinity Remote Desktop** — render to a
`<canvas>` and grab the keyboard so deeply that **no in-browser listener can see
what the user types** (verified: neither an `all_frames` content script nor a
CDP-injected capture observes the keys). See `../../RECORDER_IFRAME_INPUT.md`.

This host installs a Windows **low-level keyboard hook (`WH_KEYBOARD_LL`)**, which
sits *below* the app's grab, so it observes the keystrokes the browser can't. It
always calls `CallNextHookEx`, so the app still receives the keys and updates live
— **we only observe; we never inject or block.** The keys are streamed to the
extension and recorded as visual keyboard steps.

## What makes it safe

- **Optional.** If this host isn't installed, `connectNative` simply fails and the
  recorder behaves exactly as before. Nothing about the clean-web flow depends on it.
- **Disarmed by default.** The hook forwards nothing until the extension sends
  `{"cmd":"arm"}`, which it does *only* while the user is inside an opaque iframe
  (the last click was captured via the CDP/visual path). Any normal DOM click
  disarms it again.
- **Foreground-gated.** Even when armed, keys are forwarded **only while a known
  browser is the foreground window** (`msedge`, `chrome`, `brave`, ...). Type into
  Notepad while armed and nothing is captured.

## Protocol

Chrome native messaging: 4-byte little-endian length prefix + UTF-8 JSON, on stdio.

```
extension -> host : {"cmd":"arm"} | {"cmd":"disarm"}
host -> extension : {"type":"hello","version":"1.0"}
                    {"type":"key","key":"<char|Named>","clientTime":<ms>}
```

`key` is a single printable character, or a named action key matching the recorder
vocabulary: `Enter`, `Backspace`, `Tab`, `Escape`, `Delete`, `ArrowLeft/Up/Right/Down`,
`Home`, `End`, `PageUp`, `PageDown`.

## Build & register

Requires the **.NET 8 SDK** to build (`dotnet --version` ≥ 8).

1. Get your unpacked extension ID from `edge://extensions` (enable Developer mode) —
   it's the 32-char id on the "Screenshot Sender" card.

2. From this folder:

   ```powershell
   ./register.ps1 -ExtensionId <your-extension-id>            # Edge (default)
   ./register.ps1 -ExtensionId <your-extension-id> -Browsers Edge,Chrome
   ./register.ps1 -ExtensionId <your-extension-id> -SelfContained   # bundle .NET runtime
   ```

   This publishes `ThothInputCapture.exe`, writes the manifest with the real exe
   path + your extension ID, and registers it under `HKCU` for each browser.

3. Restart the browser, reload the extension, start a recording, click into the
   Thinfinity iframe, and type. The keys are recorded even though the browser
   can't see them.

To remove:

```powershell
./register.ps1 -Browsers Edge,Chrome -Unregister
```

## Notes / limits

- Windows-only (the whole point is Win32 input hooks).
- A global keyboard hook is keylogger-shaped; **AV/EDR may flag it.** It only
  *forwards* while armed + browser-foreground, but the hook itself is always
  installed while the host runs.
- Translation uses the **foreground window's keyboard layout** and current
  Shift/CapsLock state via `ToUnicodeEx` (called with the no-side-effect flag so
  it doesn't disturb dead-key composition in the app).
