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
    lastEditableKeyTime: 0
};

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

// Click event handler
const clickHandler = function(event) {
    if (mousedownProcessingTimer) {
        clearTimeout(mousedownProcessingTimer);
        mousedownProcessingTimer = null;
        pendingMousedownEvent = null;
    }
    
    const dpr = window.devicePixelRatio || 1;
    
    safeSendMessage({
        action: "tests-recorder-click-event",
        window: {
            width: parseInt(window.innerWidth * dpr),
            height: parseInt(window.innerHeight * dpr)
        },
        position: {
            x: parseInt(event.pageX * dpr),
            y: parseInt(event.pageY * dpr)
        },
        scroll: {
            x: parseInt(window.scrollX * dpr),
            y: parseInt(window.scrollY * dpr)
        },
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
    const dpr = window.devicePixelRatio || 1;
    pendingMousedownEvent = {
        action: "tests-recorder-mousedown-event",
        window: {
            width: parseInt(window.innerWidth * dpr),
            height: parseInt(window.innerHeight * dpr)
        },
        position: {
            x: parseInt(event.pageX * dpr),
            y: parseInt(event.pageY * dpr)
        },
        scroll: {
            x: parseInt(window.scrollX * dpr),
            y: parseInt(window.scrollY * dpr)
        },
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

// Keypress event handler
const keypressHandler = function(event) {
    let key = event.key;

    // Enter is ambiguous: a newline inside a multi-line field vs. a submit/action
    // everywhere else. Inside a textarea/contenteditable (without a submit
    // modifier) we treat it as text (\n, folded into the typing group); otherwise
    // it stays "Enter" and the backend records it as a discrete [Enter] step.
    if (key === 'Enter') {
        const t = event.target;
        const isMultiline = !!t && (t.tagName === 'TEXTAREA' || t.isContentEditable === true);
        const hasSubmitModifier = event.ctrlKey || event.metaKey;
        if (isMultiline && !hasSubmitModifier) {
            key = '\n';
        }
    }

    // For DOM text fields the `change` event records the authoritative final
    // value, so drop printable keystrokes (incl. the translated newline) to avoid
    // double-recording. Action keys (multi-char names like Enter/Tab) still fire.
    const isActionKey = key.length > 1;
    if (!isActionKey && thothIsEditableDomField(event.target)) {
        // Remember when the field was last edited so the input/change event can be
        // ordered just before whatever key eventually commits it.
        window.thothRecorder.lastEditableKeyTime = Date.now();
        return;
    }

    safeSendMessage({
        action: "tests-recorder-keypress-event",
        key: key,
        clientTime: Date.now()
    }, 'Keypress event captured');
};

// Scroll handler — debounced so a burst collapses into one "settled" position.
// Reads the offset from whatever actually scrolled: the window for document
// scrolls, or the specific element for inner scroll containers (where
// window.scrollX/Y stays 0). Capture-phase listener so inner scrolls reach us.
let thothScrollTimer = null;
const scrollHandler = function(event) {
    if (!window.thothRecorder.isRecording) return;
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
const changeHandler = function(event) {
    if (!window.thothRecorder.isRecording) return;
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

// Keydown handler for hotkeys
const keydownHandler = function(event) {
    if (event.altKey && event.shiftKey && event.code === "KeyW") {
        createOverlay();
        event.preventDefault();
    }
};

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
                sendResponse({ status: "ok" });
                return true;
            }
            if (message.action === "session-stopped") {
                window.thothRecorder.isRecording = false;
                console.log('[Thoth] Recording stopped notification received');
                sendResponse({ status: "ok" });
                return true;
            }
        });
    } catch (error) {
        console.warn('[Thoth] Error setting up message listener:', error);
    }
};

// Initialize function
function initialize() {
    console.log('[Thoth] Initializing content script...');
    
    // Remove old handlers if they exist (for clean re-initialization)
    if (window.thothRecorder.handlers.click) {
        document.removeEventListener('click', window.thothRecorder.handlers.click, true);
    }
    if (window.thothRecorder.handlers.mousedown) {
        document.removeEventListener('mousedown', window.thothRecorder.handlers.mousedown, true);
    }
    if (window.thothRecorder.handlers.keypress) {
        document.removeEventListener('keypress', window.thothRecorder.handlers.keypress);
    }
    if (window.thothRecorder.handlers.keydown) {
        document.removeEventListener('keydown', window.thothRecorder.handlers.keydown);
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
        keypress: keypressHandler,
        keydown: keydownHandler,
        scroll: scrollHandler,
        change: changeHandler,
        visibilitychange: visibilityChangeHandler,
        focus: focusHandler,
        pageshow: pageShowHandler
    };

    // Add event listeners
    document.addEventListener('click', clickHandler, true);
    document.addEventListener('mousedown', mousedownHandler, true);
    document.addEventListener('keypress', keypressHandler);
    document.addEventListener('keydown', keydownHandler);
    window.addEventListener('scroll', scrollHandler, true);
    document.addEventListener('change', changeHandler, true);
    document.addEventListener('visibilitychange', visibilityChangeHandler);
    window.addEventListener('focus', focusHandler);
    window.addEventListener('pageshow', pageShowHandler);
    
    // Set up message listener (only if not already set up)
    if (!window.thothRecorder.messageListenerSet) {
        setupMessageListener();
        window.thothRecorder.messageListenerSet = true;
    }
    
    // Check session status immediately - this wakes up the background script
    wakeUpAndCheckSession();
    
    // Set up periodic keep-alive check (every 30 seconds)
    if (!window.thothRecorder.keepAliveSet) {
        setInterval(() => {
            // Only do keep-alive if we think we're recording
            if (window.thothRecorder.isRecording && checkExtensionContext()) {
                console.log('[Thoth] Keep-alive check...');
                wakeUpAndCheckSession();
            }
        }, 30000);
        window.thothRecorder.keepAliveSet = true;
    }
    
    window.thothRecorder.initialized = true;
    console.log('[Thoth] Content script initialized');
}

// Always initialize when script runs
console.log('[Thoth] Content script loaded, previous init state:', window.thothRecorder.initialized);
initialize();
