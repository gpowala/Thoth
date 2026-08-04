# Recorder — Opaque Cross-Origin Iframe Input (Thinfinity) — Findings

> Working notes from the investigation into capturing (and replaying) **keyboard**
> input inside opaque, cross-origin, pixel-streamed iframes — specifically
> **Thinfinity Remote Desktop**. Clicks are solved; keyboard **capture** is solved;
> keyboard **replay into the app during recording is NOT solved yet.**
>
> Status date: 2026-07-09. Read alongside `RECORDER_PLAN.md`.
>
> **UPDATE 2026-08-03 — SOLVED via a native OS keyboard hook. See §10.** The
> replay problem was the wrong problem: during recording the user types for real
> and Thinfinity already updates live; we only needed to *observe* the keys. A
> native messaging host (`Recorders/NativeHost/`) with a `WH_KEYBOARD_LL` hook
> observes them below Thinfinity's grab. The overlay/CDP-replay path (§4.6, §5) is
> now a fallback, not the primary mechanism.
>
> **UPDATE 2026-08-04 — overlay/CDP-replay path REMOVED.** Native capture (§10) is
> the sole keyboard mechanism for opaque iframes, so the keyboard-input overlay, its
> ⌨ trigger button, and CDP key replay (`cdpReplayKey`) were deleted. **Alt+Shift+W
> is restored to area-select**; there is no longer an Alt+Shift+C.

---

## 1. The target: what Thinfinity actually is

Thinfinity Remote Desktop (Cybele Software, off-the-shelf) is an HTML5 remote-app
product embedded in an `<iframe>`:

- The remote screen is drawn on an **HTML5 `<canvas>`** — the iframe content is
  effectively **just a picture**; there are no real DOM inputs/buttons/fields.
- **JavaScript in the iframe captures all keyboard/mouse input, serializes it, and
  sends it over a WebSocket** to the server. The server runs the real app and
  streams back rendered pixels (again over the WebSocket). AJAX is a fallback if WS
  is unavailable.
- The iframe is **cross-origin** and therefore an **out-of-process iframe (OOPIF)**
  under site isolation.

Consequences that shaped everything below:
- **"No network traffic when I press a key"** is expected — keystrokes go out as
  **WebSocket binary frames** (visible only under the WS connection's *Messages*
  tab, not as requests). The typed char appears because it round-tripped over the
  WS and came back as a **canvas repaint**.
- Thinfinity is an **aggressive input grabber**: it captures `keydown`, suppresses
  `contextmenu` (you can't right-click it), and re-grabs focus.

Sources:
- https://files.cybelesoft.com/manuals/thinfinity/remote-desktop/server/architecture.html
- https://www.cybelesoft.com/thinfinity/remote-desktop/

---

## 2. Current status

| Capability | Status |
|-----------|--------|
| **Clicks** inside the Thinfinity iframe | ✅ Working (captured via CDP; coords via offset handshake) |
| **Keyboard capture** (recording the keystrokes) | ✅ Working via the explicit overlay (see §4) |
| **Keyboard replay into Thinfinity during recording** | ❌ Not working (app does not receive the keys) |
| **Keyboard playback into Thinfinity** (generated Playwright test) | ❓ Untested / likely same problem |

So today: we can **record** what the user typed (the test will contain the
keystrokes), but during recording the Thinfinity app does **not** update, because
we can't deliver the keys back into it.

---

## 3. Hard browser constraints we confirmed

These are not bugs — they're platform boundaries that any approach must respect:

1. **Keyboard goes only to the focused frame.** While the Thinfinity iframe has
   focus, the top frame receives **no** keyboard events — including our trigger
   hotkey. A top-frame listener (capture phase or not) cannot see them.
2. **Cross-origin mouse coords are zeroed for the parent.** A `mousedown` the
   parent sees on the `<iframe>` element reports `(0,0)` (privacy) — so the parent
   cannot read the real click position inside a cross-origin iframe. (This caused
   the earlier "(0,0) ghost click".)
3. **OOPIF isolation.** A debugger attached to the top target does not see a
   cross-origin iframe's execution contexts / `addScriptToEvaluateOnNewDocument`
   unless you `Target.setAutoAttach({flatten:true})` and set up each child session.
4. **A truly non-scriptable document** (a literal image) has no JS realm — nothing
   (content script or CDP) can run in it. (Thinfinity does have JS, so this isn't
   our case, but it bounds the general problem.)
5. **CDP has no "observe user input" event.** `Input.dispatch*` only *injects*;
   there is no event that reports real user keystrokes. Observation requires JS
   listeners in the page.
6. **CDP `Input.dispatchKeyEvent` reaches only the focused frame** (see §5, the
   replay failure). Dispatching to a child session while the frame is unfocused
   does not deliver.

---

## 4. What we tried, and what happened (chronological)

1. **Content script, top frame only** — never saw iframe events at all (events
   don't cross the frame boundary). → added `all_frames: true`.
2. **`all_frames` content script** — captured same-origin/in-process frames, but
   **not the cross-origin Thinfinity OOPIF** keyboard. Clicks in-frame still not
   coordinate-correct.
3. **CDP reporter injected into every frame** (`chrome.debugger` +
   `Page.addScriptToEvaluateOnNewDocument` + `Runtime.addBinding`) — **clicks
   started working** in the iframe (binding + injection confirmed reaching it).
   **Keydown still not captured.**
4. **Inject-first via `Target.setAutoAttach({ waitForDebuggerOnStart: true })`** so
   our capture-phase `keydown` listener registers before Thinfinity's — **still no
   keydown captured.** Conclusion: Thinfinity's key capture can't be observed by a
   listener in that frame (it either stops it before us in a way we can't precede,
   or captures via a path our listeners don't see). Reload-after-start didn't help.
5. **Reactive focus-steal** (on `focusin`/iframe focus, move focus to a hidden
   top-frame sink) — **sink never fired** ("Proxy key captured" never logged).
   Thinfinity re-grabs focus / the steal loses the race. Dead end.
6. **Explicit keyboard overlay (current approach)** — a visible top-frame input the
   user opens deliberately:
   - Trigger had to become a **mouse button** (the ⌨ button), because the
     Alt+Shift+W hotkey can't reach us while the iframe is focused (constraint #1).
   - Typing into our own focused input **works** — keys are captured and recorded
     to the gallery. **This is the capture solution.**
   - **Replay** of those keys into Thinfinity via CDP `Input.dispatchKeyEvent` to
     the child session **does not reach the app.**
7. **Refocus the iframe before replay** (remember last-focused iframe, `.focus()`
   it, then dispatch) — **still didn't work.** So either focus hadn't propagated
   before dispatch (needs a tick), or dispatching to the OOPIF child session simply
   isn't delivering.

---

## 5. Why replay is the remaining wall

To capture keys we must own focus (our overlay input). To deliver keys to
Thinfinity we must either (a) have Thinfinity focused, or (b) dispatch to its frame
in a way that doesn't need focus. We have not achieved either:

- Dispatching CDP `Input.dispatchKeyEvent` to the **child (OOPIF) session** while
  our overlay is focused → **not delivered.**
- `iframe.focus()` then dispatch → **not delivered** (possibly focus change hadn't
  taken effect at dispatch time; possibly OOPIF input routing needs more).

Open question: does CDP OOPIF input dispatch require the frame to be the *renderer-
focused* frame, and does `element.focus()` on the parent actually make the OOPIF
renderer-focused in time? Unverified.

---

## 6. Current implementation (where the code is)

Extension: `Recorders/BrowserRecorder/`
- `manifest.json` — `all_frames: true`; permissions include `webNavigation`,
  `debugger`.
- `contentScript.js`:
  - Runs in all frames; top-frame does session mgmt.
  - Native-capture disarm on true page-focus-loss: `thothTrackFrameFocus`
    (`window` blur) tells the background to disarm when focus leaves the page —
    but not when it enters an iframe (that keeps native capture armed).
- `background.js`:
  - CDP attach/detach on record start/stop; `setupCdpTarget()` with
    `Target.setAutoAttach({ waitForDebuggerOnStart: true, flatten: true })`.
  - Injected reporter `CDP_CAPTURE_SCRIPT` (clicks + offset handshake; keydown was
    left in but is ineffective against Thinfinity).
  - `cdpChildSessions` set tracks attached OOPIF child debugger sessions so CDP
    capture is installed on each. (CDP key *replay* was removed — native capture,
    §10, is the sole keyboard mechanism.)

### Shortcuts
- **Alt+Shift+W** → area-select overlay (spans the tab).

---

## 7. Options to try next (for replay)

Ranked roughly by promise / effort:

1. **Focus + delay before dispatch.** After `iframe.focus()`, wait a tick
   (`requestAnimationFrame` / small timeout) before CDP-dispatching, so the
   renderer focus change propagates. Cheapest thing to try; may be the whole fix.
2. **Dispatch to the top session (not the child) while the iframe is focused.**
   When the iframe is renderer-focused, CDP `Input.dispatchKeyEvent` on the *tab*
   target routes to the focused frame. Try focusing the iframe then dispatching to
   `{tabId}` (no sessionId).
3. **Full input-proxy overlay** (intercept clicks too): a transparent overlay over
   the iframe that owns *all* input; replay both mouse and keys via CDP. Heavier,
   changes working click behavior, but removes the focus tug-of-war entirely.
4. **WebSocket interception** inside the Thinfinity frame (monkeypatch
   `WebSocket.prototype.send`): capture the outgoing input frames directly. Almost
   certainly **not viable** — the payload is Thinfinity's proprietary binary
   protocol; decoding/synthesizing it is out of scope.
5. **Playback-first pragmatism.** Accept that during *recording* the app won't
   update live; still record the intended keystrokes (works today) and solve
   delivery only at **playback** time, where Playwright drives a real focused frame
   (`frame_locator`/`page.keyboard`) and may deliver keys natively. Verify whether
   Playwright typing reaches Thinfinity — if it does, live replay during recording
   becomes "nice to have" rather than required.

---

## 8. Recommendation

- **Keep the capture** (overlay) — it works and is the important half for producing
  tests.
- **Before more replay engineering, verify the playback path**: does a Playwright
  script that clicks the Thinfinity canvas to focus it and then `page.keyboard.type`
  actually get keys into the app? If **yes**, we may not need live replay at all —
  record keystrokes via the overlay, and let playback deliver them. If **no**, the
  same delivery problem exists at playback and we must solve CDP/native key
  delivery into the OOPIF regardless (try options 1–2 first).
- Treat opaque-iframe interaction as **inherently visual**: clicks = `visual_click`
  by coordinate/image; text = recorded keystrokes delivered to the focused canvas;
  assertions = image/`wait_for_visual_state` on the canvas region.

---

## 9. Verified facts vs. hypotheses

**Verified (observed in testing):**
- Clicks in the Thinfinity iframe record via CDP.
- Keyboard is NOT observable inside the Thinfinity frame by any listener we tried
  (content script or CDP-injected), even inject-first.
- Typing into our own top-frame overlay input records correctly.
- CDP key replay to the child session does not reach Thinfinity, with or without
  refocusing the iframe first.
- Thinfinity suppresses `contextmenu` and re-grabs focus.

**Hypotheses (unverified):**
- Focus hadn't propagated to the OOPIF renderer before we dispatched (a delay might
  fix replay).
- Dispatching to the top session (with the iframe focused) might route correctly
  where child-session dispatch didn't.
- Playwright native typing into the focused canvas may deliver keys (would make live
  replay optional).

---

## 10. RESOLUTION (2026-08-03) — native OS keyboard hook for capture

The framing in §2–§8 treated this as a *replay* problem ("we stole focus to
capture, now deliver the keys back"). That was the wrong problem. During recording
the user types on a real keyboard, and those real OS keystrokes **already reach the
focused Thinfinity canvas and update the app live** — that half was never broken.
The only thing broken was that our recorder couldn't *observe* what was typed.

**Solution: observe at the OS layer, below Thinfinity's grab.** A native messaging
host installs a Windows low-level keyboard hook (`WH_KEYBOARD_LL`) which sees every
keystroke before the browser/app, and always `CallNextHookEx`, so the app still
gets the keys. No focus stealing, no overlay, no replay.

### Components (all committed)
- **`Recorders/NativeHost/ThothInputCapture/`** — .NET 8 host. `WH_KEYBOARD_LL`
  hook on a pumped thread; Chrome native-messaging framing over stdio; translates
  VK→token (`ToUnicodeEx` with the foreground layout + Shift/CapsLock, no-side-
  effect flag) or a named key (`Enter`, `Backspace`, `Tab`, arrows, ...).
- **`Recorders/NativeHost/register.ps1`** + `com.thoth.inputcapture.template.json`
  — publish the exe, fill the manifest with exe path + extension id, register under
  `HKCU\...\NativeMessagingHosts` for Edge/Chrome.
- **`background.js`** — `connectNative` (lazy, on first arm), `arm`/`disarm`, records
  incoming keys via `recordKeypressEvent`. Drops the in-page CDP keydown report
  while native is armed+connected (native is the authority; no double).
- **`contentScript.js`** — on top-window blur, if focus left the page (not into an
  iframe) it messages the background to **disarm**, so address-bar typing isn't
  captured.

### Safety contract (clean-web is never affected)
- **Optional**: if the host isn't installed, `connectNative` fails and everything
  behaves exactly as before.
- **Disarmed by default**: armed only when the last click was a CDP/visual click
  (i.e. the user is inside an opaque frame); any DOM click disarms.
- **Foreground-gated**: the host forwards keys only while a known browser is the
  foreground window.

### Protocol
```
extension -> host : {"cmd":"arm"} | {"cmd":"disarm"}
host -> extension : {"type":"hello","version":"1.0"}
                    {"type":"key","key":"<char|Named>","clientTime":<ms>}
```

### Related fix shipped alongside — the "random double click event"
Three producers posted to `/recording/events/click` with no dedup (content-script
click, content-script mousedown fallback, CDP visual). They now funnel through a
single `emitClick()` gate in `background.js`: a short coalesce window keeps the
highest-precedence modality (`cdp` > `click` > `mousedown`) for one gesture, and the
late mousedown fallback is suppressed when a real click already fired. This is also
what arms/disarms native capture (a `cdp` winner ⇒ opaque frame ⇒ arm).

### Playback (unchanged, still headless)
The native host is **recording-time only**. Generated tests stay pure Playwright so
they run headless in CI: visual click = browser screenshot → OpenCV → `mouse.click`;
keyboard into canvas = `page.keyboard.type()` after a focusing click. (The pivotal
"does headless `page.keyboard.type` reach Thinfinity" probe from §8 is still worth
running to confirm the playback half, independent of this recording-side solution.)
