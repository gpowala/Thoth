# Thoth Recorder — Architecture & Implementation Plan

> Status: **design agreed, pre-implementation**
> Scope: the browser extension (`Recorders/BrowserRecorder`), the TestsManager backend (`TestsManager/Backend`), the Angular frontend (`TestsManager/Frontend`), and a new Playwright-Python code generator.

---

## 1. Purpose & context

The Thoth recorder captures a user's interactions with a web application and turns them into automated tests. The target output is **Playwright tests written in Python**.

The applications under test have a **dual nature**, and the recorder must serve both:

- **Canvas / iframe-rendered product content** — large parts of the company's products render their UI into `<canvas>` or into embedded iframes. This content has no addressable DOM, so it can only be tested **visually** (coordinates + screenshots + image-state assertions).
- **Ordinary DOM** — the rest of the page (navigation, forms, buttons outside the product frames) is normal HTML and should be tested by **stable selectors** (XPath / CSS / `data-testid`).

Two cross-cutting requirements apply to **every** recorded step regardless of modality:

1. **Screenshots are always kept**, to build confidence for non-technical stakeholders (functional analysts) about *what* is being tested, and to later power **self-healing** and **documentation generation**.
2. Output must be **Playwright Python**, where visual (iframe/canvas) operations are **enriched with visual search** — e.g. "wait until the canvas reaches this image state" instead of relying on DOM readiness.

---

## 2. Core concept: one gesture, two modalities

Every interaction is captured in **both** representations, then **classified** so codegen knows which to trust at playback:

- **DOM modality** — robust selector candidates (`data-testid` → `id` → CSS path → XPath) + element metadata. Trusted for ordinary top-document, non-canvas elements.
- **Visual modality** — top-document viewport coordinate + screenshot (full frame + a crop around the target). Trusted for canvas and iframe-rendered content, and **retained for all steps** as the confidence / documentation / self-heal layer.

The screenshot is never optional — even DOM steps keep one. The selector is captured whenever derivable. A per-step **`targetKind`** flag decides which representation *drives* playback.

---

## 3. Classification rules (`targetKind`)

Decided at capture time by read-only inspection of `event.target` (does not read or alter coordinates):

| Signal | `targetKind` | Playback strategy |
|--------|--------------|-------------------|
| `target.tagName === 'CANVAS'` | `visual` | coordinate / image-anchored |
| Click lands on an `<iframe>` element (cross-origin) | `visual` | coordinate / image-anchored |
| `target.ownerDocument !== document` (same-origin iframe) | `visual` | coordinate / image-anchored |
| Ordinary top-document element with a derivable stable selector | `dom` | `page.locator(...)` |
| Ordinary element, no stable selector found | `dom-weak` (flag for review) | selector + visual fallback |

**Default rule: canvas or iframe ⇒ visual; everything else ⇒ DOM.** The user (or a reviewing analyst) can override a step's modality in the review UI.

---

## 4. Coordinate model — **PRESERVE CURRENT IMPLEMENTATION**

The existing coordinate pipeline works and was validated through extensive testing. **It is not being rewritten.**

Current, working flow (kept as-is):
- Content script listens on the **top document, capture phase** (`document.addEventListener('click', handler, true)`).
- Sends `position = { x: pageX * dpr, y: pageY * dpr }`, `scroll = { x: scrollX * dpr, y: scrollY * dpr }`, plus window size.
- Background computes `adjusted = position + scroll` and posts to the backend.

This already produces **top-document coordinates "as the user sees it."** No pointer-tracker, no `all_frames` injection, no cross-origin coordinate translation — all of that was considered and **rejected as unnecessary**.

**New events that need a coordinate reuse the exact same `pageX/pageY * dpr` (+ scroll) pattern** — no competing mechanism is introduced.

> Note: the background adds `scroll` on top of `pageX` (which already includes the scroll offset). This is preserved exactly as written since it is validated against real screenshots. Revisit only if explicitly requested.

---

## 5. Screenshot policy

`captureVisibleTab` is the expensive operation, so *when* to capture is an explicit, per-event policy. Grouped events **debounce-flush and capture once at the boundary** (the client is the only place that knows a burst ended).

| Event | Screenshot | Coordinate source |
|-------|-----------|-------------------|
| Click / double-click / right-click | 1, at the event | pointer position |
| **Typing group** | **1 only, at group flush** (idle debounce); earlier ones discarded | last field position |
| **Scroll group** | 1, after scroll settles | — (scroll offset) |
| **Mouse move** | **none** | tracked continuously; feeds other events only |
| **Drag & drop** | **2 — start + end** | start & end positions |
| Navigation | 1, after load settles | — |
| Input / select / checkbox commit | 1, at commit | element position |
| Area-select assertion | 1 | selection rectangle |

Raw key/scroll streams still flow to the backend for grouping; only the **screenshot** is throttled to the flush boundary (a 40-keystroke burst → one image, not forty).

---

## 6. Storage model — full screenshot is the source of truth

- The **full viewport PNG is immutable and always retained** — it is what the app re-edits from.
- Stored alongside: **target bounding rect + click point** (the geometry needed to crop).
- Crops (today's min-trim / max-trim) become **derived, regenerable views** computed from `full + rect`, not primary data. The app can re-trim, re-center, or crop a different target later **without re-recording**.

This replaces the current "full + two hard-coded trims baked at capture" with **"full + geometry → crops on demand."**

---

## 7. Unified event envelope

Every event (click, input, scroll, drag, …) carries:

```jsonc
{
  "type": "click | keypress | scroll | drag | navigate | ...",
  "timestamp": "...",
  "targetKind": "dom | visual | dom-weak",
  "dom": {                       // present when derivable
    "selectors": ["testid?", "id?", "css", "xpath"],
    "boundingRect": { "x": 0, "y": 0, "w": 0, "h": 0 },
    "tag": "BUTTON",
    "attrs": { "...": "..." }
  },
  "visual": {
    "point": { "x": 0, "y": 0 },   // CSS px (top-document viewport)
    "dpr": 1,
    "fullScreenshot": "<ref>",     // immutable source
    "targetCrop": "<derived>"      // regenerated from full + rect
  },
  "data": { /* event-specific: value, scrollXY, dragEnd, key, ... */ }
}
```

DOM fields sit **alongside** the coordinate/screenshot data already captured — additive, not a rewrite.

---

## 8. Current state (baseline)

### Supported today
| Event | Status | Notes |
|-------|--------|-------|
| Click | ✅ Working | DPR-scaled, scroll-adjusted; full + 2 trimmed crops. |
| Mousedown | ⚠️ Fallback | Buffered 350 ms, routed to the **same** `/click` endpoint. |
| Keypress | ✅ Working | One event per key; **grouped into text on the frontend** (`mergeKeypressEvents`). |
| Area-select | ❌ Broken | See bugs below. |

### Known bugs to fix (Phase 0)
1. `registerAreaSelectEvent` is **commented out** in `recording-service.ts`.
2. **No `/recording/events/area-select` route** exists in `server.ts` (background posts to it anyway).
3. **Type-name mismatch**: backend emits `'areaSelect'`, frontend switch expects `'area-select'`.
4. Keyboard grouping lives in the **frontend**; it should move to the backend for consistency and reuse.

---

## 9. Event catalog (current + proposed)

### Tier 1 — high value, low risk
| Event | Captures | Grouping |
|-------|----------|----------|
| Scroll | final scroll x/y, container (window vs element) | debounce; one "scroll to (x,y)" after ~150 ms idle; 1 screenshot after settle |
| Input / change | final field value on `change`/`blur` | robust vs. reconstructing from keystrokes; catches paste, autofill, `<select>` |
| Navigation | **User-initiated** URL changes only — address bar / bookmark / reload / initial page (`webNavigation` transition types `typed`/`auto_bookmark`/`generated`/`keyword`/`reload`/`start_page`). URL changes caused by a click/form-submit/redirect/SPA-route are NOT navigation events — they are the originating click/input step. | one event per user-initiated URL |
| Select / dropdown | chosen option value/text | on `change` |
| Checkbox / radio | final checked state | on `change` |

### Tier 2 — valuable, moderate effort
| Event | Captures | Notes |
|-------|----------|-------|
| Drag & drop | start element+point, end element+point, start/end screenshots | shared pointer state machine (conflicts with mousedown-as-click fallback + area-select overlay) |
| Mouse move | sampled path or settle point | **no screenshots**; sample ~50–100 ms, flush one event on trigger; only record moves that matter (hover reveals menu, path into drag) |
| Hover | element hovered long enough | subset of mouse-move handling |
| Double-click | position + target | distinct step |
| Right-click / context menu | position + target | `contextmenu` |
| Key combo / shortcut | modifier-aware combos (Ctrl+C…) | distinct from text entry |

### Tier 3 — nice to have / test-specific
| Event | Captures |
|-------|----------|
| File upload | filename(s) from `<input type=file>` |
| Copy / paste / cut | clipboard action + text |
| Form submit | `submit` on a form |
| Window resize | new viewport size |
| Dialog handling | `alert` / `confirm` / `prompt` + response |
| Tab / window switch | focus moved to another tab |
| Assertion / verification | text-exists / element-exists (generalizes area-select visual assertion) |
| Explicit wait | manual "wait N ms" + auto-derived delays from timestamps |

---

## 10. Architecture layers — where changes land

| Layer | File(s) | Change |
|-------|---------|--------|
| Capture | `Recorders/BrowserRecorder/contentScript.js` | selector generation; `targetKind` classifier; debounce-flush groups; capture screenshots per policy; emit envelope. **Coordinate math untouched.** |
| Transport | `Recorders/BrowserRecorder/background.js` | pass through new fields; keep `captureVisibleTab`; capture-timing signals for grouped events |
| Endpoints | `TestsManager/Backend/src/server.ts` | fix/complete `area-select`; new event routes carrying the envelope |
| Model | `TestsManager/Backend/src/recording/recording-session.ts`, `events/*` | store full PNG + geometry; derive crops on request; **move grouping to backend** (keyboard, scroll, mouse-move) |
| Serialize | `TestsManager/Backend/src/recording/recording-service.ts` | fix `areaSelect`→`area-select`; emit envelope |
| Review UI | `TestsManager/Frontend/.../create-test/*` | show screenshot + modality badge per step; re-crop from full image; DOM/visual override |
| Codegen (new) | new backend module (see §11) | event stream → Python Playwright + visual baselines + helper lib |

---

## 11. Playwright Python code generation

The event stream compiles to a Python Playwright script + a sidecar of visual baselines + a small helper module.

| Recorded step | DOM emit | Visual emit |
|---------------|----------|-------------|
| Click | `page.locator("xpath=…").click()` | `visual_click(page, "step_03.png")` — locate crop → click coords |
| Input | `.fill(value)` | type at focused point |
| Navigation | `page.goto(url)` | same |
| Scroll | `locator.scroll_into_view_if_needed()` / `mouse.wheel` | `mouse.wheel` to recorded offset |
| Area-select / assertion | `expect(locator).to_have_screenshot()` | `wait_for_visual_state(page, clip, "expected.png")` |

**Iframe/canvas enrichment** = generated helpers:
- `visual_click(page, baseline, threshold)` — image-anchored click (template-match the recorded crop in the live screenshot, then click the match).
- `wait_for_visual_state(page, clip, baseline, threshold)` — poll a screenshot region and compare until the canvas reaches the expected state, then proceed (replaces DOM-readiness waits inside product frames).

Each visual step carries a **threshold / tolerance** value (how close counts as "matched"), eventually exposed in the review UI. This is a Phase-2 concern.

### Open decision — codegen home
- **(A) Node backend, template strings** — simpler, one process, no new runtime. *(Leaning A to start.)*
- **(B) Separate Python generator service** — closer to the Playwright runtime, but adds a process/boundary.

### Deferred decision — visual matching engine (decided at codegen time)
The storage model (full screenshot + rect + point) is **forward-compatible with both**, so this is safely deferred to Phase 2:
- **OpenCV template-matching** — enables image-anchored click *and* self-heal in one stack. *(Leaning this.)*
- **Playwright native `to_have_screenshot`** — assertion-only.

No recording-time data depends on this choice.

---

## 12. Phased roadmap

### Phase 0 — Foundations *(everything rides on this)*
- Capture robust selectors (`data-testid` → `id` → CSS → XPath) as candidate list.
- Add `targetKind` classifier (canvas / iframe / dom).
- Introduce the unified event envelope (new fields alongside existing x/y).
- Storage model: retain immutable full PNG + geometry; derive crops on demand.
- Move keyboard grouping to the backend.
- Fix the dead area-select path + `areaSelect`/`area-select` type mismatch.
- **Coordinate pipeline frozen — no changes.**

### Phase 1 — DOM path complete
- Tier-1 events: scroll, input/change, navigation, select, checkbox (with selectors + screenshot policy).
- Playwright-Python codegen for **DOM steps** (locator-based actions, `goto`, `fill`).
- Review UI shows steps with screenshots + modality badge.
- **Text editing is authoritative via the field's final value** (`input`/`change`),
  so every edit — Backspace, Delete, select-and-retype, paste, autofill, IME —
  nets into a single `fill(finalValue)` with no keystroke reconstruction.
  Backspace is therefore NOT reconstructed for DOM fields (optionally retained
  for the documentation/confidence layer only).

### Phase 2 — Visual path
- Visual baselines pipeline; area-select as a visual assertion.
- `visual_click` + `wait_for_visual_state` helper library.
- Pick the visual matching engine (OpenCV vs. Playwright native).
- Per-step threshold/tolerance in codegen + review UI.
- **Keystroke-level text entry for canvas/iframe fields** (no readable DOM value):
  capture raw keys via the `keydown` path, including **grouped text removal** —
  consecutive Backspace/Delete presses collapse into one `[Backspace ×N]` step
  (size = count), mirroring the typed-text grouping. Records literal
  "typed / deleted N / typed" steps rather than attempting net-editor fidelity.
  (Also brings named keys `Tab`/`Escape`/arrows into capture, which `keypress`
  cannot see — today only `Enter` reaches the handler.)

### Phase 3 — Robustness / UX
- Drag & drop + mouse-move (shared pointer state machine).
- Image-anchored replay (robust `visual_click`).
- Review-UI modality overrides + re-cropping from full image.
- Documentation export (screenshots + steps → human-readable test doc).

### Phase 4 — Self-heal
- Use stored crops to relocate elements when selectors fail at playback.

### Phase 5 — User-defined selector attributes
- Let the user configure which attribute(s) the classifier should prefer when
  building selectors (e.g. a project-specific `data-test-id`, `data-automation`,
  or `qa-hook`), instead of the hard-coded `THOTH_STABLE_ATTRS` list.
- Ordered priority list, editable in the app (recording/session settings), pushed
  to the content script so `thothStableAttr` / `thothClassifyTarget` honour it.
- Directly reduces `dom-weak` classifications for teams that use a house
  convention the default list doesn't know about.

### Phase 6 — AI-assisted selector inference
- After a few interactions, use AI to infer more robust selectors automatically —
  e.g. propose a stable selector for a `dom-weak` element by reasoning over the
  captured DOM context, surrounding text, and the element crop, or by learning
  the app's naming conventions from earlier confirmed steps.
- Candidate uses: upgrade brittle positional CSS/XPath into a semantic locator;
  suggest the best selector among candidates; disambiguate when multiple elements
  match. Complements (does not replace) the Phase 4 visual self-heal.

---

## 13. Decisions log

| Decision | Status | Choice |
|----------|--------|--------|
| Coordinate model | **Locked** | Preserve current top-document `pageX*dpr + scroll` pipeline; no pointer tracker; no `all_frames`. |
| Iframe coordinates | **Locked** | Not needed — top-most viewport coordinates + whole-page screenshot only. |
| Screenshot timing | **Locked** | Per-event policy (§5); grouped events capture once at flush; no screenshots for mouse-move. |
| Storage | **Locked** | Full PNG immutable source of truth; crops derived from full + geometry. |
| Grouping location | **Locked** | Move to backend. |
| Navigation semantics | **Locked** | Navigation events represent only user-initiated URL changes (address bar / bookmark / reload / initial page), filtered by `webNavigation` transition type. Consequential navigations (click/link/form-submit/redirect/SPA route) are NOT recorded — they are the originating click/input step. Derived/technical events must never collapse or replace real user operations. |
| Text editing / Backspace | **Locked (modality-aware)** | DOM fields: rely on final value (`input`/`change`) — no keystroke reconstruction, Backspace not replayed. Visual/canvas fields: keystroke capture via `keydown` with grouped `[Backspace ×N]` (size = count). |
| Visual matching engine | **Deferred to Phase 2** | OpenCV (leaning) vs. Playwright native; storage is forward-compatible with both. |
| Codegen home | **Open** | Node backend (leaning) vs. separate Python service. |
