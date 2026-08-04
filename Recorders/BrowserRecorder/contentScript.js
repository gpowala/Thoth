// Content script for Thoth Tests Recorder
// This script is injected into web pages to capture user interactions

// Use window-level state to persist across re-injections
window.thothRecorder = window.thothRecorder || {
    initialized: false,
    isRecording: false,
    extensionContextValid: true,
    handlers: {},
    retryCount: 0,
    // Time of the last content keystroke into an editable field. Used to stamp the
    // input/change event just before the key that commits it (e.g. Enter), so the
    // "Text: ..." step orders before the "Keypress: Enter" step.
    lastEditableKeyTime: 0,
    // This frame's cumulative offset within the TOP viewport (CSS px). Resolved via
    // a postMessage handshake with ancestor frames so clicks inside (even
    // cross-origin) iframes translate to top-viewport coordinates.
    frameOffset: { x: 0, y: 0 }
};

// The content script runs in every frame (manifest all_frames). Session
// management, keep-alive and the area-select overlay stay top-only; every frame
// captures its own events and translates coordinates to the top viewport.
const THOTH_IS_TOP = (window === window.top);

const CLICK_PRIORITY_DELAY = 350;
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_DELAY = 500;

let pendingMousedownEvent = null;
let mousedownProcessingTimer = null;

// Check if extension context is valid
const checkExtensionContext = () => {
    try {
        // This will throw if context is invalidated
        const id = chrome.runtime.id;
        return !!id;
    } catch (e) {
        return false;
    }
};

// Wake up the background service worker and check session
const wakeUpAndCheckSession = async () => {
    console.log('[Thoth] Attempting to wake up background script...');
    
    if (!checkExtensionContext()) {
        console.log('[Thoth] Extension context invalid');
        window.thothRecorder.extensionContextValid = false;
        return false;
    }
    
    return new Promise((resolve) => {
        try {
            // Send message to wake up service worker and check session
            chrome.runtime.sendMessage({ action: "tests-recorder-check-session" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.log('[Thoth] Wake up failed:', chrome.runtime.lastError.message);
                    window.thothRecorder.retryCount++;
                    
                    // Retry with backoff
                    if (window.thothRecorder.retryCount < MAX_RETRY_ATTEMPTS) {
                        setTimeout(() => {
                            wakeUpAndCheckSession().then(resolve);
                        }, RETRY_DELAY * window.thothRecorder.retryCount);
                    } else {
                        console.log('[Thoth] Max retries reached');
                        resolve(false);
                    }
                    return;
                }
                
                window.thothRecorder.retryCount = 0;
                window.thothRecorder.extensionContextValid = true;
                
                if (response) {
                    window.thothRecorder.isRecording = response.isRecording;
                    console.log('[Thoth] Session status:', window.thothRecorder.isRecording ? 'RECORDING ACTIVE' : 'NOT RECORDING');
                    if (window.thothRecorder.isRecording) {
                        thothShowKeyboardTrigger();
                    } else {
                        thothHideKeyboardTrigger();
                    }
                    resolve(true);
                } else {
                    console.log('[Thoth] No response from background');
                    resolve(false);
                }
            });
        } catch (e) {
            console.log('[Thoth] Error waking up:', e);
            resolve(false);
        }
    });
};

// Safely send messages to background script with retry
const safeSendMessage = (message, logMessage, retryOnFail = true) => {
    // Never record interaction events on Thoth's own UI (session/lifecycle
    // messaging goes through chrome.runtime directly, so it is unaffected).
    if (window.thothRecorder.ownApp) {
        return false;
    }
    if (!checkExtensionContext()) {
        window.thothRecorder.extensionContextValid = false;
        console.log('[Thoth] Cannot send message - context invalid');
        return false;
    }

    try {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                console.log('[Thoth] Message error:', chrome.runtime.lastError.message);
                
                if (retryOnFail) {
                    // Try to wake up background and retry
                    console.log('[Thoth] Attempting to recover...');
                    wakeUpAndCheckSession().then((success) => {
                        if (success && window.thothRecorder.isRecording) {
                            // Retry sending the message once
                            safeSendMessage(message, logMessage, false);
                        }
                    });
                }
                return;
            }
            
            if (logMessage) {
                console.log('[Thoth]', logMessage);
            }
        });
        return true;
    } catch (error) {
        console.warn('[Thoth] Error sending message:', error);
        window.thothRecorder.extensionContextValid = false;
        return false;
    }
};

// ---------------------------------------------------------------------------
// Target inspection: robust selectors + DOM/visual classification.
// This is additive metadata that rides alongside the (frozen) coordinate data.
// All helpers are defensive: they must never throw inside an event handler.
// ---------------------------------------------------------------------------

const THOTH_STABLE_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-qa', 'name', 'aria-label'];

// Read className safely (SVG elements expose an SVGAnimatedString, not a string).
const thothClassName = (el) => {
    const cn = el && el.className;
    if (typeof cn === 'string') return cn;
    if (cn && typeof cn.baseVal === 'string') return cn.baseVal;
    return '';
};

const thothCssEscape = (value) => {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/([^\w-])/g, '\\$1');
};

// Find the first stable, human-meaningful attribute we can key a selector on.
const thothStableAttr = (el) => {
    for (const attr of THOTH_STABLE_ATTRS) {
        const val = el.getAttribute && el.getAttribute(attr);
        if (val) return { attr, value: val };
    }
    return null;
};

// A compact CSS path: id short-circuits, otherwise tag + :nth-of-type up the tree.
const thothCssPath = (el) => {
    if (!el || el.nodeType !== 1) return '';
    const segments = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
        if (node.id) {
            segments.unshift(`#${thothCssEscape(node.id)}`);
            break;
        }
        let selector = node.tagName.toLowerCase();
        const parent = node.parentElement;
        if (parent) {
            const sameTag = Array.prototype.filter.call(
                parent.children, (c) => c.tagName === node.tagName
            );
            if (sameTag.length > 1) {
                selector += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
            }
        }
        segments.unshift(selector);
        node = node.parentElement;
        depth++;
    }
    return segments.join(' > ');
};

// A positional XPath, capped in depth, id short-circuits.
const thothXPath = (el) => {
    if (!el || el.nodeType !== 1) return '';
    const segments = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 8) {
        if (node.id) {
            segments.unshift(`//*[@id="${node.id}"]`);
            return segments.join('/');
        }
        let index = 1;
        let sibling = node.previousElementSibling;
        while (sibling) {
            if (sibling.tagName === node.tagName) index++;
            sibling = sibling.previousElementSibling;
        }
        segments.unshift(`${node.tagName.toLowerCase()}[${index}]`);
        node = node.parentElement;
        depth++;
    }
    return '/' + segments.join('/');
};

// Decide whether this target plays back as DOM (selectors) or visual (coords + image).
// Rule: canvas or any iframe content => visual; everything else => dom (or dom-weak
// when we could not derive a stable selector).
const thothClassifyTarget = (el) => {
    if (!el || el.nodeType !== 1) return 'visual';
    const tag = el.tagName;
    if (tag === 'CANVAS' || tag === 'IFRAME') return 'visual';
    // Same-origin iframe content bubbles up with a foreign ownerDocument.
    if (el.ownerDocument && el.ownerDocument !== document) return 'visual';
    return (el.id || thothStableAttr(el)) ? 'dom' : 'dom-weak';
};

// Build the additive target envelope. Never throws; returns a best-effort object.
const thothBuildTargetMeta = (el) => {
    try {
        if (!el || el.nodeType !== 1) {
            return { targetKind: 'visual', selectors: {}, tag: null, boundingRect: null, dpr: window.devicePixelRatio || 1 };
        }
        const rect = el.getBoundingClientRect();
        const stable = thothStableAttr(el);
        return {
            targetKind: thothClassifyTarget(el),
            tag: el.tagName,
            selectors: {
                testId: stable ? `${stable.attr}=${stable.value}` : null,
                id: el.id || null,
                css: thothCssPath(el),
                xpath: thothXPath(el)
            },
            attrs: {
                className: thothClassName(el) || null,
                type: el.getAttribute ? el.getAttribute('type') : null,
                role: el.getAttribute ? el.getAttribute('role') : null
            },
            // CSS px, viewport-relative, plus the scroll offset + dpr needed to map
            // this rect into the screenshot's pixel space later (derive-on-demand crops).
            boundingRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
            scroll: { x: window.scrollX, y: window.scrollY },
            dpr: window.devicePixelRatio || 1
        };
    } catch (e) {
        console.warn('[Thoth] Failed to build target meta:', e);
        return { targetKind: 'dom-weak', selectors: {}, tag: null, boundingRect: null, dpr: window.devicePixelRatio || 1 };
    }
};

// Pointer position + scroll for a mouse event, in the coordinate space the
// backend expects (device px). The TOP frame keeps its original, validated math
// (page coords + scroll). Sub-frames translate frame-local viewport coords into
// TOP-viewport coords using the resolved frame offset, and report zero scroll
// (the offset already accounts for it), so the whole-tab screenshot crop lands
// on the right spot.
const thothPointerCoords = (event) => {
    const dpr = window.devicePixelRatio || 1;
    if (THOTH_IS_TOP) {
        return {
            position: { x: parseInt(event.pageX * dpr), y: parseInt(event.pageY * dpr) },
            scroll: { x: parseInt(window.scrollX * dpr), y: parseInt(window.scrollY * dpr) }
        };
    }
    const off = window.thothRecorder.frameOffset || { x: 0, y: 0 };
    return {
        position: { x: parseInt((event.clientX + off.x) * dpr), y: parseInt((event.clientY + off.y) * dpr) },
        scroll: { x: 0, y: 0 }
    };
};

// True when the event landed on a nested frame element. That interaction belongs
// to the child frame's own content script (all_frames) — recording it here too
// would duplicate the step (and the parent gets zeroed coords for cross-origin
// frames, hence the (0,0) ghost click).
const thothIsFrameElement = (el) => !!el && (el.tagName === 'IFRAME' || el.tagName === 'FRAME');

// Clicks on the recorder's own UI (keyboard trigger button / input overlay) must
// not be recorded as steps.
const thothIsOwnUi = (el) => !!el && typeof el.closest === 'function' && !!el.closest('#thoth-key-overlay, #thoth-key-trigger');

// Click event handler
const clickHandler = function(event) {
    if (mousedownProcessingTimer) {
        clearTimeout(mousedownProcessingTimer);
        mousedownProcessingTimer = null;
        pendingMousedownEvent = null;
    }

    if (thothIsFrameElement(event.target)) return;
    if (thothIsOwnUi(event.target)) return;
    // Keyboard-activated (Enter/Space on a focused control) and other synthetic
    // clicks carry no pointer position — the browser reports them at (0,0) with
    // detail===0. The activation is already captured as the key press, so recording
    // the click too would add a spurious (0,0) step. Real pointer clicks always
    // have detail>=1.
    if (event.detail === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const coords = thothPointerCoords(event);

    safeSendMessage({
        action: "tests-recorder-click-event",
        window: {
            width: parseInt(window.innerWidth * dpr),
            height: parseInt(window.innerHeight * dpr)
        },
        position: coords.position,
        scroll: coords.scroll,
        target: {
            tagName: event.target.tagName,
            id: event.target.id,
            className: thothClassName(event.target)
        },
        metadata: thothBuildTargetMeta(event.target),
        clientTime: Date.now()
    }, 'Click event captured');
};

// Mousedown event handler (fallback)
const mousedownHandler = function(event) {
    if (thothIsFrameElement(event.target)) return;
    if (thothIsOwnUi(event.target)) return;

    const dpr = window.devicePixelRatio || 1;
    const coords = thothPointerCoords(event);
    pendingMousedownEvent = {
        action: "tests-recorder-mousedown-event",
        window: {
            width: parseInt(window.innerWidth * dpr),
            height: parseInt(window.innerHeight * dpr)
        },
        position: coords.position,
        scroll: coords.scroll,
        target: {
            tagName: event.target.tagName,
            id: event.target.id,
            className: thothClassName(event.target)
        },
        metadata: thothBuildTargetMeta(event.target),
        clientTime: Date.now()
    };

    if (mousedownProcessingTimer) {
        clearTimeout(mousedownProcessingTimer);
    }
    
    mousedownProcessingTimer = setTimeout(() => {
        if (pendingMousedownEvent) {
            safeSendMessage(pendingMousedownEvent, 'Mousedown event captured (fallback)');
            pendingMousedownEvent = null;
        }
        mousedownProcessingTimer = null;
    }, CLICK_PRIORITY_DELAY);
};

// Is this a value-bearing DOM field whose final value the `change` event will
// capture? For these we suppress printable keystrokes (the input event is
// authoritative) but still record discrete action keys like [Enter]/[Tab].
const thothIsEditableDomField = (el) => {
    if (!el || !el.tagName) return false;
    const tag = el.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') return false;
    return thothClassifyTarget(el) !== 'visual';
};

// Scroll handler — debounced so a burst collapses into one "settled" position.
// Reads the offset from whatever actually scrolled: the window for document
// scrolls, or the specific element for inner scroll containers (where
// window.scrollX/Y stays 0). Capture-phase listener so inner scrolls reach us.
let thothScrollTimer = null;
const scrollHandler = function(event) {
    // Not gated on the local isRecording flag (which is unreliable in sub-frames);
    // the background is the single authority and drops events when not recording.
    const target = event.target;
    if (thothScrollTimer) clearTimeout(thothScrollTimer);
    thothScrollTimer = setTimeout(() => {
        thothScrollTimer = null;
        const dpr = window.devicePixelRatio || 1;

        const isDocumentScroll = !target || target === document ||
            target === document.documentElement || target === document.body;
        const scrollX = isDocumentScroll ? window.scrollX : (target.scrollLeft || 0);
        const scrollY = isDocumentScroll ? window.scrollY : (target.scrollTop || 0);
        const containerEl = (target && target.nodeType === 1) ? target : (document.scrollingElement || document.body);

        safeSendMessage({
            action: "tests-recorder-scroll-event",
            scroll: {
                x: parseInt(scrollX * dpr),
                y: parseInt(scrollY * dpr)
            },
            metadata: thothBuildTargetMeta(containerEl),
            clientTime: Date.now()
        }, 'Scroll event captured');
    }, 250);
};

// Change handler — the committed value of a form control (authoritative for text).
// Not gated on the local isRecording flag (unreliable in sub-frames); the
// background gates and drops events when not recording.
const changeHandler = function(event) {
    const t = event.target;
    if (!t || !t.tagName) return;

    let controlType = 'other';
    let value = '';
    let checked = false;
    let selectedText = '';

    if (t.tagName === 'INPUT') {
        const type = (t.getAttribute('type') || 'text').toLowerCase();
        if (type === 'checkbox' || type === 'radio') {
            controlType = type;
            checked = !!t.checked;
            value = t.value || '';
        } else {
            controlType = 'text';
            value = t.value || '';
        }
    } else if (t.tagName === 'TEXTAREA') {
        controlType = 'text';
        value = t.value || '';
    } else if (t.tagName === 'SELECT') {
        controlType = 'select';
        value = t.value || '';
        const opt = t.options && t.options[t.selectedIndex];
        selectedText = opt ? opt.text : '';
    } else {
        return;
    }

    // For text fields, order this event at the last keystroke (i.e. just before
    // the key that committed it, such as Enter). Other controls use now.
    const isTextField = controlType === 'text';

    // Text typed key-by-key was already recorded live as a keystroke run; don't
    // also emit a value step for it (that would duplicate). Paste/autofill never
    // marked the field, so their committed value DOES record here.
    if (isTextField && thothTypedFields.has(t)) {
        thothTypedFields.delete(t);
        return;
    }

    const clientTime = (isTextField && window.thothRecorder.lastEditableKeyTime)
        ? window.thothRecorder.lastEditableKeyTime
        : Date.now();
    window.thothRecorder.lastEditableKeyTime = 0;

    safeSendMessage({
        action: "tests-recorder-input-event",
        controlType: controlType,
        value: value,
        checked: checked,
        selectedText: selectedText,
        metadata: thothBuildTargetMeta(t),
        clientTime: clientTime
    }, 'Input event captured');
};

// Editable DOM fields whose keystrokes we've already recorded live (like the
// iframe). Used so the field's `change` on blur does NOT additionally emit a value
// step for text that was typed — the per-keystroke run already captured it. Paste
// and autofill never mark the field, so their committed value still records via
// `change`. (Playback collapses "click field + typed run" into one fill; see
// playwright-codegen.) WeakSet so entries clear when the element is gone.
const thothTypedFields = new WeakSet();

// Bare modifier presses we never record as their own step.
const THOTH_MODIFIER_KEYS = new Set([
    'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock',
    'ContextMenu', 'OS', 'AltGraph', 'Dead'
]);

// Keydown handler — the area-select hotkey plus all named (non-printable) keys.
const keydownHandler = function(event) {
    // Hotkeys (top frame only): Alt+Shift+W = keyboard-input overlay (type text into
    // an opaque iframe like Thinfinity); Alt+Shift+C = area-select overlay.
    if (THOTH_IS_TOP && event.altKey && event.shiftKey && event.code === "KeyW") {
        createKeyboardOverlay();
        event.preventDefault();
        return;
    }
    if (THOTH_IS_TOP && event.altKey && event.shiftKey && event.code === "KeyC") {
        createOverlay();
        event.preventDefault();
        return;
    }

    // Not gated on the local isRecording flag (unreliable in sub-frames); the
    // background is the single authority and drops events when not recording.
    // All keys are handled here on keydown (capture phase) — keypress is
    // unreliable because apps that preventDefault() keydown suppress it.
    const key = event.key;
    if (!key) return;
    if (event.target && event.target.id === 'thoth-key-sink') return; // handled by the proxy
    if (THOTH_MODIFIER_KEYS.has(key)) return;    // bare modifier press

    const t = event.target;
    const editable = thothIsEditableDomField(t);

    // viaKeydown marks this as a live physical keydown (vs an overlay-injected key):
    // while the native OS hook owns the keyboard inside an opaque frame it records
    // the same keystroke, so the background drops this copy to avoid doubling.
    const send = () => safeSendMessage({
        action: "tests-recorder-keypress-event",
        key: key,
        viaKeydown: true,
        clientTime: Date.now()
    }, 'Keypress event captured');

    if (key === 'Enter') {
        const isMultiline = !!t && (t.tagName === 'TEXTAREA' || t.isContentEditable === true);
        if (editable && isMultiline && !(event.ctrlKey || event.metaKey)) {
            // Newline inside a DOM multiline field → record as text ("\n") so it
            // folds into the typed run rather than a discrete [Enter] step.
            window.thothRecorder.lastEditableKeyTime = Date.now();
            thothTypedFields.add(t);
            safeSendMessage({ action: "tests-recorder-keypress-event", key: '\n', viaKeydown: true, clientTime: Date.now() }, null);
            return;
        }
        send(); // submit / activate
        return;
    }

    if (editable) {
        // DOM field: keystrokes are recorded LIVE (like the iframe) — the backend
        // groups a consecutive run into one text step; no waiting for blur. Tab/
        // Escape stay discrete; every other key is recorded, and the field is marked
        // so its `change` won't also emit a duplicate value step.
        if (key === 'Tab' || key === 'Escape') {
            send();
        } else {
            window.thothRecorder.lastEditableKeyTime = Date.now();
            thothTypedFields.add(t);
            send();
        }
        return;
    }

    // Visual / non-DOM target: record every named key (Backspace grouped by backend).
    send();
};

// ---------------------------------------------------------------------------
// Keyboard input overlay for opaque visual iframes (e.g. Thinfinity).
// Those iframes own the keyboard and we can't observe it, so instead of fighting
// for focus we give the user an explicit input. They type into it, then confirm
// with "Send" (text only) or "Send + Enter" / the Enter key (text then a submit
// Enter). Each is recorded AND replayed into the iframe via CDP. Top-frame only.
// ---------------------------------------------------------------------------

// Push the typed text (and optionally a trailing Enter) into the app: record each
// key and replay it via CDP. Then clear the field for the next entry.
const thothSendOverlayText = function(withEnter) {
    const input = document.getElementById('thoth-key-sink');
    if (!input) return;
    const text = input.value || '';
    input.value = '';

    // Refocus the target frame BEFORE replaying, so the CDP-dispatched keys land
    // in it (dispatch only reaches the focused frame).
    const target = thothTargetFrame || document.querySelector('iframe, frame');
    if (target) {
        try { target.focus(); } catch (e) { /* ignore */ }
    }

    // Give the focus change a tick to reach the (OOPIF) renderer before we
    // dispatch, otherwise the keys arrive while our overlay is still focused.
    setTimeout(() => {
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            safeSendMessage({ action: "tests-recorder-keypress-event", key: ch, clientTime: Date.now() }, null);
            safeSendMessage({ action: "tests-recorder-replay-key", key: ch, code: '' }, null);
        }
        if (withEnter) {
            safeSendMessage({ action: "tests-recorder-keypress-event", key: 'Enter', clientTime: Date.now() }, null);
            safeSendMessage({ action: "tests-recorder-replay-key", key: 'Enter', code: 'Enter' }, null);
        }
    }, 150);
    // Focus intentionally left on the target frame so the keys land. Click the
    // input again (or the trigger button) to type another entry.
};

const thothOverlayKeydown = function(event) {
    if (event.key === 'Escape') {
        const p = document.getElementById('thoth-key-overlay');
        if (p) p.remove();
        event.preventDefault();
        return;
    }
    if (event.key === 'Enter') {
        // Enter = send the text and a submit Enter.
        event.preventDefault();
        thothSendOverlayText(true);
        return;
    }
    // Everything else types into the field normally; it's captured on Send.
};

// A persistent, always-on-top button shown while recording. Needed because when
// an opaque iframe (Thinfinity) has focus it swallows all keyboard — including
// any hotkey — so the keyboard-input overlay must be reachable by mouse. Clicking
// it also pulls focus out of the iframe onto our own input.
let thothTriggerBtn = null;

// Remember the iframe the user was working in. CDP-replayed keys only reach a
// frame that is focused, so we refocus this before sending (opening our overlay
// moved focus off it).
let thothTargetFrame = null;
const thothTrackFrameFocus = () => {
    setTimeout(() => {
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'IFRAME' || ae.tagName === 'FRAME')) {
            thothTargetFrame = ae;
            return; // focus entered an iframe — native capture stays as the click armed it
        }
        // Focus left the page for browser chrome (e.g. the address bar) or another
        // app. Tell the background to disarm native key capture so we never record
        // keystrokes typed outside the page. (Losing focus to an iframe is handled
        // above; only a true page-focus-loss reaches here.)
        if (!document.hasFocus() && window.thothRecorder.isRecording) {
            safeSendMessage({ action: "tests-recorder-native-disarm" }, null, false);
        }
    }, 0);
};

function thothShowKeyboardTrigger() {
    if (!THOTH_IS_TOP) return;
    if (thothTriggerBtn && thothTriggerBtn.isConnected) return;
    const btn = document.createElement('button');
    btn.id = 'thoth-key-trigger';
    btn.type = 'button';
    btn.textContent = '⌨ Keyboard input';
    btn.title = 'Send keyboard input into the app';
    btn.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#22d3ee;' +
        'color:#08131a;border:none;border-radius:20px;padding:8px 14px;font-family:system-ui,sans-serif;' +
        'font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.35);';
    btn.addEventListener('click', (e) => { e.preventDefault(); createKeyboardOverlay(); }, true);
    (document.body || document.documentElement).appendChild(btn);
    thothTriggerBtn = btn;
}

function thothHideKeyboardTrigger() {
    if (thothTriggerBtn) { thothTriggerBtn.remove(); thothTriggerBtn = null; }
    const ov = document.getElementById('thoth-key-overlay');
    if (ov) ov.remove();
}

function createKeyboardOverlay() {
    const existing = document.getElementById('thoth-key-overlay');
    if (existing) { existing.remove(); return; } // toggle off

    const panel = document.createElement('div');
    panel.id = 'thoth-key-overlay';
    panel.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
        'background:#1e1e2e;color:#fff;padding:10px 12px;border-radius:10px;box-shadow:0 10px 34px rgba(0,0,0,.45);' +
        'font-family:system-ui,sans-serif;font-size:13px;display:flex;gap:10px;align-items:center;';

    const label = document.createElement('span');
    label.textContent = 'Keyboard → app';
    label.style.cssText = 'opacity:.7;white-space:nowrap;';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'thoth-key-sink';
    input.placeholder = 'Type, then Send. (Enter = Send + ⏎, Esc = close)';
    input.style.cssText = 'background:#2a2a3c;color:#fff;border:1px solid #45455a;border-radius:6px;' +
        'padding:7px 10px;font-size:13px;min-width:280px;outline:none;';
    input.addEventListener('keydown', thothOverlayKeydown, true);

    const btnStyle = 'border:none;border-radius:6px;padding:7px 12px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;';
    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.textContent = 'Send';
    sendBtn.style.cssText = btnStyle + 'background:#3a3a52;color:#fff;';
    sendBtn.addEventListener('click', (e) => { e.preventDefault(); thothSendOverlayText(false); }, true);

    const sendEnterBtn = document.createElement('button');
    sendEnterBtn.type = 'button';
    sendEnterBtn.textContent = 'Send + ⏎';
    sendEnterBtn.style.cssText = btnStyle + 'background:#22d3ee;color:#08131a;';
    sendEnterBtn.addEventListener('click', (e) => { e.preventDefault(); thothSendOverlayText(true); }, true);

    panel.appendChild(label);
    panel.appendChild(input);
    panel.appendChild(sendBtn);
    panel.appendChild(sendEnterBtn);
    (document.body || document.documentElement).appendChild(panel);
    input.focus();
}

// Visibility change handler - CRITICAL: wake up background when tab becomes visible
const visibilityChangeHandler = () => {
    if (document.visibilityState === 'visible') {
        console.log('[Thoth] Tab became visible - waking up background...');
        window.thothRecorder.retryCount = 0; // Reset retry count
        wakeUpAndCheckSession();
    }
};

// Focus handler - also try to wake up
const focusHandler = () => {
    console.log('[Thoth] Window focused - waking up background...');
    window.thothRecorder.retryCount = 0;
    wakeUpAndCheckSession();
};

// Page show handler - for when page is restored from bfcache
const pageShowHandler = (event) => {
    if (event.persisted) {
        console.log('[Thoth] Page restored from cache - waking up background...');
        window.thothRecorder.retryCount = 0;
        wakeUpAndCheckSession();
    }
};

// Area selection overlay
let thoth_waitScreenshotInProgress = false;
let thoth_waitScreenshotStartX = null;
let thoth_waitScreenshotStartY = null;

function createOverlay() {
    const overlay = document.createElement('canvas');
    overlay.className = 'thoth-overlay-canvas';
    document.body.appendChild(overlay);
    
    overlay.addEventListener('mousedown', (event) => {
        const canvas = overlay;
        const ctx = canvas.getContext("2d");
        ctx.canvas.width = window.innerWidth;
        ctx.canvas.height = window.innerHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        thoth_waitScreenshotStartX = event.clientX;
        thoth_waitScreenshotStartY = event.clientY;
        thoth_waitScreenshotInProgress = true;
    });
    
    overlay.addEventListener('mousemove', (event) => {
        if (thoth_waitScreenshotInProgress) {
            const canvas = overlay;
            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.beginPath();
            ctx.imageSmoothingEnabled = false;
            ctx.lineWidth = "1";
            ctx.strokeStyle = "red";
            ctx.rect(thoth_waitScreenshotStartX, thoth_waitScreenshotStartY, 
                     event.clientX - thoth_waitScreenshotStartX, 
                     event.clientY - thoth_waitScreenshotStartY);
            ctx.stroke();
        }
    });
    
    overlay.addEventListener('mouseup', (event) => {
        if (thoth_waitScreenshotInProgress) {
            document.body.removeChild(overlay);
            thoth_waitScreenshotInProgress = false;
            safeSendMessage({
                action: "tests-recorder-area-select-event",
                rect: {
                    top: Math.min(thoth_waitScreenshotStartY, event.clientY),
                    bottom: Math.max(thoth_waitScreenshotStartY, event.clientY),
                    left: Math.min(thoth_waitScreenshotStartX, event.clientX),
                    right: Math.max(thoth_waitScreenshotStartX, event.clientX)
                },
                // Overlay rect is CSS px; backend needs dpr to map it onto the
                // device-pixel screenshot when cropping the selected region.
                dpr: window.devicePixelRatio || 1,
                clientTime: Date.now()
            }, 'Area select event captured');
        }
    });
    
    overlay.addEventListener('click', () => {
        if (!thoth_waitScreenshotInProgress) {
            document.body.removeChild(overlay);
        }
    });
}

// ---------------------------------------------------------------------------
// Frame-offset resolution.
// Each frame learns its cumulative offset within the TOP viewport by asking its
// parent (postMessage works cross-origin). The parent replies with its own
// offset plus the child <iframe>'s position; the child then does the same for
// its own children. Offsets are re-pushed on scroll/resize so clicks translate
// accurately as the page moves.
// ---------------------------------------------------------------------------

// Tell each direct child frame its cumulative top-viewport offset.
const thothBroadcastOffsets = () => {
    const frames = document.querySelectorAll('iframe, frame');
    const base = window.thothRecorder.frameOffset || { x: 0, y: 0 };
    frames.forEach((f) => {
        try {
            const rect = f.getBoundingClientRect();
            f.contentWindow.postMessage({
                __thoth: true,
                type: 'thoth-offset',
                offset: { x: base.x + rect.left, y: base.y + rect.top }
            }, '*');
        } catch (e) {
            // Cross-origin contentWindow access for postMessage is allowed; ignore failures.
        }
    });
};

// Ask our parent to (re)send our offset.
const thothRequestOffset = () => {
    if (THOTH_IS_TOP) return;
    try {
        window.parent.postMessage({ __thoth: true, type: 'thoth-offset-request' }, '*');
    } catch (e) { /* ignore */ }
};

const thothSetupFrameOffset = () => {
    if (window.thothRecorder.frameOffsetSet) return;
    window.thothRecorder.frameOffsetSet = true;

    window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || data.__thoth !== true) return;

        if (data.type === 'thoth-offset-request') {
            // A direct child is (re)requesting its offset — find it and reply.
            const frames = document.querySelectorAll('iframe, frame');
            const base = window.thothRecorder.frameOffset || { x: 0, y: 0 };
            for (const f of frames) {
                if (f.contentWindow === event.source) {
                    try {
                        const rect = f.getBoundingClientRect();
                        event.source.postMessage({
                            __thoth: true,
                            type: 'thoth-offset',
                            offset: { x: base.x + rect.left, y: base.y + rect.top }
                        }, '*');
                    } catch (e) { /* ignore */ }
                    break;
                }
            }
        } else if (data.type === 'thoth-offset' && data.offset) {
            // Our offset changed; cache it and propagate to our own children.
            window.thothRecorder.frameOffset = data.offset;
            thothBroadcastOffsets();
        }
    });

    // When this frame's layout moves, children's absolute offsets change.
    window.addEventListener('scroll', thothBroadcastOffsets, true);
    window.addEventListener('resize', thothBroadcastOffsets);

    if (!THOTH_IS_TOP) {
        thothRequestOffset();
        // Retry a few times in case ancestors initialised slightly later.
        let tries = 0;
        const retry = setInterval(() => {
            thothRequestOffset();
            if (++tries >= 5) clearInterval(retry);
        }, 500);
    }
};

// Set up message listener for ping and session notifications
const setupMessageListener = () => {
    if (!checkExtensionContext()) return;
    
    try {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.action === "ping") {
                sendResponse({ 
                    status: "ok", 
                    timestamp: Date.now(), 
                    isRecording: window.thothRecorder.isRecording 
                });
                return true;
            }
            if (message.action === "session-started") {
                window.thothRecorder.isRecording = true;
                window.thothRecorder.extensionContextValid = true;
                console.log('[Thoth] Recording started notification received');
                thothShowKeyboardTrigger();
                sendResponse({ status: "ok" });
                return true;
            }
            if (message.action === "session-stopped") {
                window.thothRecorder.isRecording = false;
                console.log('[Thoth] Recording stopped notification received');
                thothHideKeyboardTrigger();
                sendResponse({ status: "ok" });
                return true;
            }
        });
    } catch (error) {
        console.warn('[Thoth] Error setting up message listener:', error);
    }
};

// True when this page is Thoth's own UI (tagged in index.html). We never record
// the recorder application itself — otherwise the setup/connection clicks show
// up as the first steps of every session.
const thothIsOwnApp = () => {
    try {
        return !!document.querySelector('meta[name="thoth-recorder-app"]');
    } catch (e) {
        return false;
    }
};

// Initialize function
function initialize() {
    console.log('[Thoth] Initializing content script...');

    // On Thoth's own UI we still run session/lifecycle handling (so connecting and
    // keep-alive work), but never SEND interaction events (see safeSendMessage) —
    // that's what keeps the setup/connection clicks out of the recording.
    window.thothRecorder.ownApp = thothIsOwnApp();
    if (window.thothRecorder.ownApp) {
        console.log('[Thoth] Thoth recorder UI detected — event capture suppressed on this page.');
    }

    // Mark this frame as content-script-covered so the CDP reporter defers to us
    // here (CDP only captures frames without this marker, e.g. opaque cross-origin).
    try {
        document.documentElement.setAttribute('data-thoth-cs', '1');
    } catch (e) { /* ignore */ }

    // Remove old handlers if they exist (for clean re-initialization)
    if (window.thothRecorder.handlers.click) {
        document.removeEventListener('click', window.thothRecorder.handlers.click, true);
    }
    if (window.thothRecorder.handlers.mousedown) {
        document.removeEventListener('mousedown', window.thothRecorder.handlers.mousedown, true);
    }
    if (window.thothRecorder.handlers.keydown) {
        document.removeEventListener('keydown', window.thothRecorder.handlers.keydown, true);
    }
    if (window.thothRecorder.handlers.scroll) {
        window.removeEventListener('scroll', window.thothRecorder.handlers.scroll, true);
    }
    if (window.thothRecorder.handlers.change) {
        document.removeEventListener('change', window.thothRecorder.handlers.change, true);
    }
    if (window.thothRecorder.handlers.visibilitychange) {
        document.removeEventListener('visibilitychange', window.thothRecorder.handlers.visibilitychange);
    }
    if (window.thothRecorder.handlers.focus) {
        window.removeEventListener('focus', window.thothRecorder.handlers.focus);
    }
    if (window.thothRecorder.handlers.pageshow) {
        window.removeEventListener('pageshow', window.thothRecorder.handlers.pageshow);
    }
    // Store new handlers
    window.thothRecorder.handlers = {
        click: clickHandler,
        mousedown: mousedownHandler,
        keydown: keydownHandler,
        scroll: scrollHandler,
        change: changeHandler,
        visibilitychange: visibilityChangeHandler,
        focus: focusHandler,
        pageshow: pageShowHandler
    };

    // Event listeners — captured in every frame so iframe interactions are seen.
    document.addEventListener('click', clickHandler, true);
    document.addEventListener('mousedown', mousedownHandler, true);
    document.addEventListener('keydown', keydownHandler, true);
    window.addEventListener('scroll', scrollHandler, true);
    document.addEventListener('change', changeHandler, true);

    // Set up message listener (only if not already set up)
    if (!window.thothRecorder.messageListenerSet) {
        setupMessageListener();
        window.thothRecorder.messageListenerSet = true;
    }

    // Resolve this frame's offset within the top viewport (all frames).
    thothSetupFrameOffset();

    // Check session status immediately - this wakes up the background script.
    // Sub-frames use it to learn isRecording; the tab-level gating lives in the
    // background, so events from any frame are attributed to the recording tab.
    wakeUpAndCheckSession();

    // Session-lifecycle listeners and keep-alive are top-frame responsibilities.
    if (THOTH_IS_TOP) {
        document.addEventListener('visibilitychange', visibilityChangeHandler);
        window.addEventListener('focus', focusHandler);
        window.addEventListener('pageshow', pageShowHandler);
        // Track which iframe the user is in, to refocus it when sending keys.
        if (!window.thothRecorder.frameFocusTrackerSet) {
            window.addEventListener('blur', thothTrackFrameFocus);
            window.thothRecorder.frameFocusTrackerSet = true;
        }

        if (!window.thothRecorder.keepAliveSet) {
            setInterval(() => {
                if (window.thothRecorder.isRecording && checkExtensionContext()) {
                    console.log('[Thoth] Keep-alive check...');
                    wakeUpAndCheckSession();
                }
            }, 30000);
            window.thothRecorder.keepAliveSet = true;
        }
    }

    window.thothRecorder.initialized = true;
    console.log('[Thoth] Content script initialized (top frame: ' + THOTH_IS_TOP + ')');
}

// Always initialize when script runs
console.log('[Thoth] Content script loaded, previous init state:', window.thothRecorder.initialized);
initialize();
