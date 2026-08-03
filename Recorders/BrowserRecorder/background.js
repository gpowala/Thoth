// Background service worker for Thoth Tests Recorder
// Note: In MV3, this service worker can be suspended at any time

let recordingTabId = -1;
let serverUrl = '';
let sessionId = '';
let isRecording = false;
let lastEventTime = 0;
let stateRestored = false;

// Restore state from storage - called on every wake-up
const ensureStateRestored = () => {
    return new Promise((resolve) => {
        if (stateRestored) {
            resolve();
            return;
        }
        
        chrome.storage.local.get(['serverUrl', 'sessionId', 'recordingTabId', 'isRecording', 'lastEventTime'], (result) => {
            serverUrl = result.serverUrl || '';
            sessionId = result.sessionId || '';
            recordingTabId = result.recordingTabId || -1;
            isRecording = result.isRecording || false;
            lastEventTime = result.lastEventTime || 0;
            stateRestored = true;
            
            console.log(`[Background] State restored: isRecording=${isRecording}, tabId=${recordingTabId}, sessionId=${sessionId}`);
            
            // Ensure alarm is running if recording
            if (isRecording && recordingTabId >= 0) {
                chrome.alarms.get('keepAlive', (alarm) => {
                    if (!alarm) {
                        chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 }); // Every 30 seconds
                        console.log('[Background] Keep-alive alarm created');
                    }
                });
            }
            
            resolve();
        });
    });
};

// Save state to storage
const saveState = () => {
    chrome.storage.local.set({
        'serverUrl': serverUrl,
        'sessionId': sessionId,
        'recordingTabId': recordingTabId,
        'isRecording': isRecording,
        'lastEventTime': lastEventTime
    }, () => {
        console.log('[Background] State saved');
    });
};

// Initialize on startup
chrome.runtime.onStartup.addListener(() => {
    console.log('[Background] Extension starting up');
    ensureStateRestored();
});

chrome.runtime.onInstalled.addListener((details) => {
    console.log('[Background] Extension installed/updated:', details.reason);
    chrome.alarms.clearAll();
    ensureStateRestored();
});

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
    await ensureStateRestored();
    
    if (alarm.name === 'keepAlive') {
        console.log('[Background] Keep-alive alarm fired');
        
        if (isRecording && recordingTabId >= 0 && serverUrl && sessionId) {
            // Ping the backend to keep session alive
            try {
                await fetch(`${serverUrl}/recording/session/is-active?guid=${sessionId}`, { method: 'GET' });
                console.log('[Background] Backend session kept alive');
            } catch (error) {
                console.log('[Background] Backend keep-alive failed:', error);
            }
            
            // Verify tab still exists
            chrome.tabs.get(recordingTabId, (tab) => {
                if (chrome.runtime.lastError || !tab) {
                    console.log('[Background] Recording tab no longer exists');
                    stopRecording();
                }
            });
        }
    }
});

// Listen for tab activation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    await ensureStateRestored();
    
    if (recordingTabId >= 0 && isRecording && activeInfo.tabId === recordingTabId) {
        console.log('[Background] Recording tab re-activated');
        resumeBackendSession();
    }
});

// Listen for window focus changes
chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    
    await ensureStateRestored();
    
    if (recordingTabId >= 0 && isRecording) {
        chrome.tabs.get(recordingTabId, (tab) => {
            if (!chrome.runtime.lastError && tab && tab.windowId === windowId) {
                console.log('[Background] Recording window focused');
                resumeBackendSession();
            }
        });
    }
});

// Listen for tab updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    await ensureStateRestored();
    
    if (tabId === recordingTabId && isRecording && changeInfo.status === 'complete') {
        console.log('[Background] Recording tab finished loading');
    }
});

// Listen for tab removal
chrome.tabs.onRemoved.addListener(async (tabId) => {
    await ensureStateRestored();
    
    if (tabId === recordingTabId) {
        console.log('[Background] Recording tab closed');
        stopRecording();
    }
});

// Handle messages - CRITICAL: restore state first!
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle async state restoration
    ensureStateRestored().then(() => {
        handleMessage(message, sender, sendResponse);
    });
    
    return true; // Keep message channel open for async response
});

const handleMessage = (message, sender, sendResponse) => {
    console.log(`[Background] Message received: ${message.action} from tab ${sender.tab?.id}`);
    
    // Session check - content script is waking us up
    if (message.action === "tests-recorder-check-session") {
        const isThisTabRecording = sender.tab && sender.tab.id === recordingTabId && isRecording;
        console.log(`[Background] Session check: isRecording=${isRecording}, recordingTabId=${recordingTabId}, senderTab=${sender.tab?.id}, match=${isThisTabRecording}`);
        
        sendResponse({ 
            isRecording: isThisTabRecording,
            sessionId: isThisTabRecording ? sessionId : null
        });
        
        // If this is the recording tab and we're recording, ensure backend session is alive
        if (isThisTabRecording) {
            resumeBackendSession();
        }
        return;
    }
    
    // Start recording
    if (message.action === "tests-recorder-start-recording") {
        if (isRecording) {
            stopRecording();
        }
        
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) {
                console.error('[Background] No active tab found');
                sendResponse({ success: false });
                return;
            }
            
            recordingTabId = tabs[0].id;
            isRecording = true;
            lastEventTime = Date.now();
            const initialUrl = tabs[0].url;
            
            try {
                const url = new URL(message.serverUrl);
                serverUrl = `${url.protocol}//${url.host}`;
                sessionId = url.searchParams.get('guid');
            } catch (e) {
                console.error('[Background] Invalid server URL:', e);
                isRecording = false;
                sendResponse({ success: false });
                return;
            }
            
            console.log(`[Background] Starting recording on tab ${recordingTabId}`);
            
            // Start backend session
            fetch(`${serverUrl}/recording/session/start?guid=${sessionId}`, { method: 'GET' })
                .then(() => {
                    console.log('[Background] Backend session started');
                    
                    // Create keep-alive alarm
                    chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });
                    
                    // Save state
                    saveState();
                    
                    // Notify content script
                    notifyContentScript('session-started');

                    // Attach the debugger so we can capture input inside frames that
                    // content scripts can't reach (cross-origin / opaque surfaces).
                    attachCdp(recordingTabId);

                    // Record the starting URL as the test's opening navigation.
                    if (initialUrl && !initialUrl.startsWith('chrome')) {
                        lastNavigatedUrl = initialUrl;
                        recordNavigation(initialUrl, 'initial');
                    }

                    sendResponse({ success: true });
                })
                .catch((error) => {
                    console.error('[Background] Failed to start backend session:', error);
                    isRecording = false;
                    sendResponse({ success: false });
                });
        });
        return;
    }
    
    // Stop recording
    if (message.action === "tests-recorder-stop-recording") {
        notifyContentScript('session-stopped');
        stopRecording();
        sendResponse({ success: true });
        return;
    }
    
    // Handle events from content script
    if (sender.tab && sender.tab.id === recordingTabId && isRecording) {
        lastEventTime = Date.now();
        saveState(); // Update last event time in storage
        
        if (message.action === "tests-recorder-click-event") {
            recordClickEvent(sender, message.window, message.position, message.scroll, message.metadata, message.clientTime);
            sendResponse({ success: true });
        } else if (message.action === "tests-recorder-mousedown-event") {
            recordMousedownEvent(sender, message.window, message.position, message.scroll, message.metadata, message.clientTime);
            sendResponse({ success: true });
        } else if (message.action === "tests-recorder-area-select-event") {
            recordAreaSelectEvent(sender, message.rect.top, message.rect.bottom, message.rect.left, message.rect.right, message.dpr, message.clientTime);
            sendResponse({ success: true });
        } else if (message.action === "tests-recorder-keypress-event") {
            recordKeypressEvent(message.key, message.clientTime);
            sendResponse({ success: true });
        } else if (message.action === "tests-recorder-scroll-event") {
            recordScrollEvent(sender, message.scroll, message.metadata, message.clientTime);
            sendResponse({ success: true });
        } else if (message.action === "tests-recorder-input-event") {
            recordInputEvent(sender, message);
            sendResponse({ success: true });
        } else if (message.action === "tests-recorder-replay-key") {
            cdpReplayKey(message.key, message.code);
            sendResponse({ success: true });
        } else if (message.action === "tests-recorder-native-disarm") {
            // Page lost focus to browser chrome / another app — stop capturing keys.
            setNativeArmed(false);
            sendResponse({ success: true });
        }
    }
};

// Notify content script about session state changes
const notifyContentScript = (action) => {
    if (recordingTabId < 0) return;
    
    chrome.tabs.sendMessage(recordingTabId, { action: action }, (response) => {
        if (chrome.runtime.lastError) {
            console.log(`[Background] Failed to notify content script: ${chrome.runtime.lastError.message}`);
        } else {
            console.log(`[Background] Content script notified: ${action}`);
        }
    });
};

// Resume backend session
const resumeBackendSession = () => {
    if (!serverUrl || !sessionId || !isRecording) return;
    
    console.log('[Background] Resuming backend session...');
    
    fetch(`${serverUrl}/recording/session/resume?guid=${sessionId}`, { method: 'GET' })
        .then(response => {
            if (response.ok) {
                console.log('[Background] Backend session resumed');
            } else {
                console.log('[Background] Resume failed, trying to restart session');
                // Try to restart
                return fetch(`${serverUrl}/recording/session/start?guid=${sessionId}`, { method: 'GET' });
            }
        })
        .catch((error) => {
            console.log('[Background] Resume/restart failed:', error);
        });
};

// Stop recording
const stopRecording = () => {
    console.log('[Background] Stopping recording');

    // Detach the debugger.
    detachCdp();

    // Disconnect the native input-capture host (if it was connected).
    disconnectNativeHost();

    // Clear alarms
    chrome.alarms.clear('keepAlive');

    // Stop backend session
    if (serverUrl && sessionId) {
        fetch(`${serverUrl}/recording/session/stop?guid=${sessionId}`, { method: 'GET' })
            .then(() => console.log('[Background] Backend session stopped'))
            .catch((error) => console.error('[Background] Stop error:', error));
    }
    
    // Reset state
    recordingTabId = -1;
    serverUrl = '';
    sessionId = '';
    isRecording = false;
    lastEventTime = 0;
    
    // Save cleared state
    saveState();
};

// Helper to convert base64 view to blob
const viewToBlob = (view) => {
    let arr = view.split(','), mime = arr[0].match(/:(.*?);/)[1],
        bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
};

// ---------------------------------------------------------------------------
// Single click-emit gate (dedup).
// Three producers post clicks to the same endpoint: the content-script click
// ("web based"), the content-script mousedown fallback, and the CDP reporter
// ("visual", for opaque/cross-origin frames). Without coordination one physical
// click can record twice — e.g. a leaked mousedown fallback alongside the CDP
// visual — which is the "random double event" on Thinfinity. Everything funnels
// through emitClick so one gesture yields exactly one step:
//   • Coalesce: near-simultaneous candidates (the CS-vs-CDP race) are buffered
//     for a short window; the highest-precedence modality wins and posts once.
//   • Suppress: the mousedown fallback is inherently late (timer-driven); if a
//     real click already posted, drop it — its only job is to fire when NO click
//     came at all.
// Flip THOTH_CLICK_DEBUG to log every candidate with timing deltas (temporary
// instrumentation to confirm the real races on a given site).
const THOTH_CLICK_DEBUG = true;
// Same-gesture dedup windows. DROP-ONLY (nothing is delayed) so a click's POST
// keeps its real-time position in the backend's arrival-ordered timeline and
// arm/disarm is never deferred. CRITICAL: dedup only collapses ONE physical click
// captured twice — i.e. the content-script-vs-CDP race, which shows up as a
// DIFFERENT modality arriving within a few ms. Two SAME-modality clicks are always
// distinct user actions (double-clicks / rapid clicks in a remote-desktop iframe)
// and must both be kept — collapsing them was dropping real clicks.
const CLICK_DEDUP_MS = 120;      // cross-modality race window
const CLICK_SUPPRESS_MS = 600;   // > content-script CLICK_PRIORITY_DELAY (350ms)
let lastClickEmitTime = 0;
let lastClickEmitModality = null;

// One physical click => one recorded step, and it also drives native key capture.
// Arm/disarm is applied IMMEDIATELY from this click's own target (never deferred),
// so a disarm can't lag behind the user and let the OS keyboard hook leak
// keystrokes into a DOM field after they've left the iframe.
const emitClick = (candidate) => {
    const now = Date.now();
    const sinceLast = now - lastClickEmitTime;
    if (THOTH_CLICK_DEBUG) {
        console.log(`[Background][click] candidate=${candidate.modality} targetKind=${candidate.targetKind} visual=${candidate.visual} sinceLastEmit=${sinceLast}ms last=${lastClickEmitModality}`);
    }

    // Visual click (canvas / opaque iframe content — e.g. Thinfinity) → arm native
    // key capture; any DOM click → disarm. Immediate, idempotent.
    setNativeArmed(candidate.visual);

    if (candidate.modality === 'mousedown') {
        // Fallback for when `click` never fires. If a real click already handled
        // this gesture, drop it.
        if (sinceLast < CLICK_SUPPRESS_MS) {
            if (THOTH_CLICK_DEBUG) console.log('[Background][click] DROP mousedown (click already handled)');
            return;
        }
    } else if (lastClickEmitModality && lastClickEmitModality !== 'mousedown'
        && lastClickEmitModality !== candidate.modality && sinceLast < CLICK_DEDUP_MS) {
        // Different capture path fired for the SAME physical click (CS↔CDP race) →
        // keep the first. (Same-modality clicks are never collapsed.)
        if (THOTH_CLICK_DEBUG) console.log(`[Background][click] DROP ${candidate.modality} (${lastClickEmitModality}/${candidate.modality} race duplicate)`);
        return;
    }

    lastClickEmitTime = now;
    lastClickEmitModality = candidate.modality;
    if (THOTH_CLICK_DEBUG) console.log(`[Background][click] EMIT ${candidate.modality} targetKind=${candidate.targetKind}`);
    candidate.post();
};

// Record click event (content script, "web based")
const recordClickEvent = (sender, windowSize, position, scroll, metadata, clientTime) => {
    const adjustedX = position.x + scroll.x;
    const adjustedY = position.y + scroll.y;
    const ct = clientTime || Date.now();
    emitClick({
        modality: 'click',
        clientTime: ct,
        targetKind: metadata && metadata.targetKind,
        visual: !!(metadata && metadata.targetKind === 'visual'),
        post: () => {
            const url = `${serverUrl}/recording/events/click?guid=${sessionId}&x=${adjustedX}&y=${adjustedY}&clientTime=${ct}`;
            chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" }, (clickView) => {
                if (chrome.runtime.lastError) {
                    console.error("[Background] Capture error:", chrome.runtime.lastError.message);
                    return;
                }
                const formData = new FormData();
                formData.append('clickview', viewToBlob(clickView), 'clickview.png');
                // Additive target envelope (selectors + DOM/visual classification).
                if (metadata) formData.append('metadata', JSON.stringify(metadata));
                fetch(url, { method: 'POST', body: formData })
                    .then(() => console.log('[Background] Click event recorded'))
                    .catch((error) => console.error('[Background] Click record error:', error));
            });
        }
    });
};

// Record mousedown event (content script fallback for when `click` never fires)
const recordMousedownEvent = (sender, windowSize, position, scroll, metadata, clientTime) => {
    const ct = clientTime || Date.now();
    emitClick({
        modality: 'mousedown',
        clientTime: ct,
        targetKind: metadata && metadata.targetKind,
        visual: !!(metadata && metadata.targetKind === 'visual'),
        post: () => {
            const url = `${serverUrl}/recording/events/click?guid=${sessionId}&x=${position.x}&y=${position.y}&clientTime=${ct}`;
            chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" }, (clickView) => {
                if (chrome.runtime.lastError) {
                    console.error("[Background] Capture error:", chrome.runtime.lastError.message);
                    return;
                }
                const formData = new FormData();
                formData.append('clickview', viewToBlob(clickView), 'clickview.png');
                if (metadata) formData.append('metadata', JSON.stringify(metadata));
                fetch(url, { method: 'POST', body: formData })
                    .then(() => console.log('[Background] Mousedown event recorded'))
                    .catch((error) => console.error('[Background] Mousedown record error:', error));
            });
        }
    });
};

// Record area select event
const recordAreaSelectEvent = (sender, top, bottom, left, right, dpr, clientTime) => {
    const url = `${serverUrl}/recording/events/area-select?guid=${sessionId}&top=${top}&bottom=${bottom}&left=${left}&right=${right}&dpr=${dpr || 1}&clientTime=${clientTime || Date.now()}`;
    
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" }, (areaSelectView) => {
        if (chrome.runtime.lastError) {
            console.error("[Background] Capture error:", chrome.runtime.lastError.message);
            return;
        }
        
        const formData = new FormData();
        formData.append('areaSelectView', viewToBlob(areaSelectView), 'clickview.png');
        
        fetch(url, { method: 'POST', body: formData })
            .then(() => console.log('[Background] Area select event recorded'))
            .catch((error) => console.error('[Background] Area select record error:', error));
    });
};

// Record keypress event
const recordKeypressEvent = (key, clientTime) => {
    // Encode the key so control chars (\n), spaces and reserved chars (& = ?)
    // survive the query string; the backend decodes it once.
    const url = `${serverUrl}/recording/events/keypress?guid=${sessionId}&key=${encodeURIComponent(key)}&clientTime=${clientTime || Date.now()}`;

    fetch(url, { method: 'GET' })
        .then(() => console.log('[Background] Keypress event recorded'))
        .catch((error) => console.error('[Background] Keypress record error:', error));
};

// Capture the visible tab and POST it as multipart 'view' with extra text fields.
// Shared by the Phase 1 events (scroll/input/navigation) that each keep one
// full-page screenshot.
const captureAndPost = (windowId, url, fields) => {
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (view) => {
        if (chrome.runtime.lastError) {
            console.error("[Background] Capture error:", chrome.runtime.lastError.message);
            return;
        }
        const formData = new FormData();
        formData.append('view', viewToBlob(view), 'view.png');
        for (const key in (fields || {})) {
            const value = fields[key];
            if (value === undefined || value === null) continue;
            formData.append(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
        fetch(url, { method: 'POST', body: formData })
            .then(() => console.log('[Background] Event recorded:', url))
            .catch((error) => console.error('[Background] Record error:', error));
    });
};

// Record scroll event
const recordScrollEvent = (sender, scroll, metadata, clientTime) => {
    const url = `${serverUrl}/recording/events/scroll?guid=${sessionId}`;
    captureAndPost(sender.tab.windowId, url, {
        x: scroll.x,
        y: scroll.y,
        metadata: metadata,
        clientTime: clientTime || Date.now()
    });
};

// Record input/change event
const recordInputEvent = (sender, message) => {
    const url = `${serverUrl}/recording/events/input?guid=${sessionId}`;
    captureAndPost(sender.tab.windowId, url, {
        controlType: message.controlType,
        value: message.value,
        checked: message.checked,
        selectedText: message.selectedText,
        metadata: message.metadata,
        // Supplementary gathered keystroke sequence (captureAndPost JSON-encodes it).
        keys: message.keys,
        clientTime: message.clientTime || Date.now()
    });
};

// Record a navigation event (looks up the recording tab's window for capture).
const recordNavigation = (url, navType) => {
    if (!serverUrl || !sessionId || recordingTabId < 0) return;
    const clientTime = Date.now();
    chrome.tabs.get(recordingTabId, (tab) => {
        if (chrome.runtime.lastError || !tab) return;
        captureAndPost(tab.windowId, `${serverUrl}/recording/events/navigation?guid=${sessionId}`, {
            url: url,
            navType: navType,
            clientTime: clientTime
        });
    });
};

// A navigation is recorded ONLY when the user explicitly demands a URL change —
// address bar, bookmark, reload. Navigations that are a *consequence* of a user
// action (clicking a link/button, submitting a form, redirects, SPA route
// changes) are NOT recorded here: they are already captured as the click/input
// step, and emitting a navigation for them would collapse the real operation.
const EXPLICIT_NAV_TRANSITIONS = new Set([
    'typed', 'auto_bookmark', 'generated', 'keyword', 'keyword_generated', 'reload', 'start_page'
]);

let lastNavigatedUrl = '';
let pendingNav = null; // { url, transitionType } from the latest onCommitted

if (chrome.webNavigation) {
    // onCommitted carries the transitionType; remember it for the matching onCompleted.
    chrome.webNavigation.onCommitted.addListener(async (details) => {
        await ensureStateRestored();
        if (details.frameId !== 0 || details.tabId !== recordingTabId || !isRecording) return;
        pendingNav = { url: details.url, transitionType: details.transitionType };
    });

    // onCompleted fires once the page is painted (good for the screenshot). Only
    // record it if the navigation was user-initiated per its transition type.
    chrome.webNavigation.onCompleted.addListener(async (details) => {
        await ensureStateRestored();
        if (details.frameId !== 0 || details.tabId !== recordingTabId || !isRecording) return;

        const transitionType = (pendingNav && pendingNav.url === details.url) ? pendingNav.transitionType : undefined;
        pendingNav = null;

        if (details.url === lastNavigatedUrl) return;
        if (!EXPLICIT_NAV_TRANSITIONS.has(transitionType)) return; // consequence of a user action → skip

        lastNavigatedUrl = details.url;
        recordNavigation(details.url, 'load');
    });

    // NOTE: onHistoryStateUpdated (SPA route changes) is intentionally NOT handled —
    // those are driven by clicks/JS and are captured as the originating click step.
}

// ---------------------------------------------------------------------------
// CDP (chrome.debugger) capture.
// Injects a reporter into every frame's MAIN world — including cross-origin /
// opaque surfaces that content scripts can't reach — and reports input back
// through a Runtime binding. Frames that already run our content script are left
// to it (deduped via a shared DOM marker set by the content script), so normal
// pages keep their richer selector/final-value capture.
// ---------------------------------------------------------------------------

let cdpTabId = -1;
// Child (frame) debugger sessions, so we can replay keys into opaque OOPIF
// frames like Thinfinity via CDP Input.dispatchKeyEvent.
const cdpChildSessions = new Set();

// Best-effort key -> CDP key-event params. Enough for typing + common edit keys.
const CDP_NAMED_KEYS = {
    Enter: { code: 'Enter', vk: 13, text: '\r' },
    Backspace: { code: 'Backspace', vk: 8 },
    Tab: { code: 'Tab', vk: 9 },
    Escape: { code: 'Escape', vk: 27 },
    Delete: { code: 'Delete', vk: 46 },
    ArrowLeft: { code: 'ArrowLeft', vk: 37 },
    ArrowUp: { code: 'ArrowUp', vk: 38 },
    ArrowRight: { code: 'ArrowRight', vk: 39 },
    ArrowDown: { code: 'ArrowDown', vk: 40 },
    Home: { code: 'Home', vk: 36 },
    End: { code: 'End', vk: 35 }
};

const cdpKeyParams = (key, code) => {
    if (key && key.length === 1) {
        const upper = key.toUpperCase();
        let c = code;
        if (!c) {
            if (/[a-zA-Z]/.test(key)) c = 'Key' + upper;
            else if (/[0-9]/.test(key)) c = 'Digit' + key;
            else c = '';
        }
        const vk = upper.charCodeAt(0);
        return { key: key, code: c, text: key, unmodifiedText: key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    }
    const n = CDP_NAMED_KEYS[key];
    if (n) return { key: key, code: n.code, text: n.text || '', windowsVirtualKeyCode: n.vk, nativeVirtualKeyCode: n.vk };
    return { key: key, code: code || '' };
};

// Replay a key into the opaque frame(s) so the app (e.g. Thinfinity) receives it
// even though we stole focus to the top-frame sink to capture it.
const cdpReplayKey = (key, code) => {
    if (cdpTabId < 0 || !chrome.debugger) return;
    const p = cdpKeyParams(key, code);
    const ignore = () => { void chrome.runtime.lastError; };
    const printable = !!key && key.length === 1;
    // Dispatch to the TOP (tab) session, NOT a child session. When the iframe has
    // been refocused (see the overlay send), the top session routes input to the
    // focused frame — including cross-origin OOPIFs. Dispatching straight to the
    // child session (previous attempt) did not deliver.
    const dbg = { tabId: cdpTabId };
    if (printable) {
        // Canonical char sequence: rawKeyDown (fires keydown) → char (character) → keyUp.
        chrome.debugger.sendCommand(dbg, "Input.dispatchKeyEvent", { type: 'rawKeyDown', key: p.key, code: p.code, windowsVirtualKeyCode: p.windowsVirtualKeyCode, nativeVirtualKeyCode: p.nativeVirtualKeyCode }, ignore);
        chrome.debugger.sendCommand(dbg, "Input.dispatchKeyEvent", { type: 'char', key: p.key, text: p.text, unmodifiedText: p.unmodifiedText }, ignore);
        chrome.debugger.sendCommand(dbg, "Input.dispatchKeyEvent", { type: 'keyUp', key: p.key, code: p.code, windowsVirtualKeyCode: p.windowsVirtualKeyCode, nativeVirtualKeyCode: p.nativeVirtualKeyCode }, ignore);
    } else {
        chrome.debugger.sendCommand(dbg, "Input.dispatchKeyEvent", Object.assign({ type: 'keyDown' }, p), ignore);
        chrome.debugger.sendCommand(dbg, "Input.dispatchKeyEvent", Object.assign({ type: 'keyUp' }, p), ignore);
    }
};

// Runs in each frame's main world. Reports input only when this frame has NO
// content script (no data-thoth-cs marker), so it fills the gaps content scripts
// leave. Translates coordinates into top-viewport device px via a postMessage
// offset handshake (works cross-origin).
const CDP_CAPTURE_SCRIPT = `(function(){
  if (typeof document === 'undefined' || !document.addEventListener) return; // skip worker contexts
  if (window.__thothCdp) return; window.__thothCdp = true;
  var isTop = (window === window.top);
  var frameOffset = { x: 0, y: 0 };
  function hasContentScript(){ try { return !!document.documentElement.getAttribute('data-thoth-cs'); } catch(e){ return false; } }
  function report(p){ try { if (window.__thothReport) window.__thothReport(JSON.stringify(p)); } catch(e){} }
  function broadcast(){ var f=document.querySelectorAll('iframe, frame'); for(var i=0;i<f.length;i++){ try{ var r=f[i].getBoundingClientRect(); f[i].contentWindow.postMessage({__thothCdp:true,type:'offset',offset:{x:frameOffset.x+r.left,y:frameOffset.y+r.top}}, '*'); }catch(e){} } }
  window.addEventListener('message', function(ev){ var d=ev.data; if(!d||d.__thothCdp!==true) return;
    if(d.type==='offset-request'){ var f=document.querySelectorAll('iframe, frame'); for(var i=0;i<f.length;i++){ if(f[i].contentWindow===ev.source){ try{ var r=f[i].getBoundingClientRect(); ev.source.postMessage({__thothCdp:true,type:'offset',offset:{x:frameOffset.x+r.left,y:frameOffset.y+r.top}}, '*'); }catch(e){} break; } } }
    else if(d.type==='offset'&&d.offset){ frameOffset=d.offset; broadcast(); }
  });
  window.addEventListener('scroll', broadcast, true);
  window.addEventListener('resize', broadcast);
  if(!isTop){ try{ window.parent.postMessage({__thothCdp:true,type:'offset-request'}, '*'); }catch(e){} }
  function classify(el){ if(!el||el.nodeType!==1) return 'visual'; var t=el.tagName; if(t==='CANVAS'||t==='IFRAME'||t==='FRAME') return 'visual'; if(el.ownerDocument&&el.ownerDocument!==document) return 'visual'; return el.id ? 'dom' : 'dom-weak'; }
  function pt(e){ var dpr=window.devicePixelRatio||1; return { x: Math.round((e.clientX+frameOffset.x)*dpr), y: Math.round((e.clientY+frameOffset.y)*dpr) }; }
  var MOD = ['Shift','Control','Alt','Meta','CapsLock','NumLock','ScrollLock','ContextMenu','OS','AltGraph','Dead'];
  document.addEventListener('click', function(e){ if(hasContentScript()) return; if(e.target&&(e.target.tagName==='IFRAME'||e.target.tagName==='FRAME')) return; var p=pt(e); report({kind:'click', x:p.x, y:p.y, targetKind:classify(e.target), tag:e.target?e.target.tagName:null, id:(e.target&&e.target.id)||null, clientTime:Date.now()}); }, true);
  // All keys on keydown (printable + named): streaming apps often preventDefault
  // keydown, which would suppress keypress. window+capture to fire as early as possible.
  window.addEventListener('keydown', function(e){ if(hasContentScript()) return; var k=e.key; if(!k) return; if(MOD.indexOf(k)>=0) return; report({kind:'key', key:k, clientTime:Date.now()}); }, true);
})();`;

// Set up one target (the top page or an auto-attached child frame session) to
// report input. `dbg` is {tabId} for the top or {tabId, sessionId} for a child.
// `waitingForDebugger` is true when the frame is paused at start (see setAutoAttach
// with waitForDebuggerOnStart) — that's the case that lets us inject BEFORE the
// page's own scripts so our capture-phase keydown listener registers first and
// sees the key before apps like Thinfinity stopImmediatePropagation() it.
const setupCdpTarget = (dbg, waitingForDebugger) => {
    const ignore = () => { void chrome.runtime.lastError; };
    chrome.debugger.sendCommand(dbg, "Runtime.enable", {}, ignore);
    chrome.debugger.sendCommand(dbg, "Page.enable", {}, ignore);
    chrome.debugger.sendCommand(dbg, "Runtime.addBinding", { name: "__thothReport" }, ignore);
    // Runs at document-start on every future document in this target — before the
    // page's scripts, so we are the first capture-phase listener.
    chrome.debugger.sendCommand(dbg, "Page.addScriptToEvaluateOnNewDocument", { source: CDP_CAPTURE_SCRIPT }, ignore);
    // Pause out-of-process child frames at start so we can inject before their
    // scripts too (recurses into nested OOPIFs).
    chrome.debugger.sendCommand(dbg, "Target.setAutoAttach", {
        autoAttach: true, waitForDebuggerOnStart: true, flatten: true
    }, ignore);
    if (waitingForDebugger) {
        // Frame paused before running any script: our document-start injection is
        // now registered, so resume — the app's listeners will register after ours.
        chrome.debugger.sendCommand(dbg, "Runtime.runIfWaitingForDebugger", {}, ignore);
    } else {
        // Already-loaded frame (e.g. the page as it was when recording started):
        // best-effort late inject. Reload the page to get first-registration.
        chrome.debugger.sendCommand(dbg, "Runtime.evaluate", { expression: CDP_CAPTURE_SCRIPT }, ignore);
    }
};

const attachCdp = (tabId) => {
    if (!chrome.debugger) {
        console.log('[Background] chrome.debugger unavailable');
        return;
    }
    chrome.debugger.attach({ tabId }, "1.3", () => {
        if (chrome.runtime.lastError) {
            console.error('[Background] CDP attach failed:', chrome.runtime.lastError.message);
            return;
        }
        cdpTabId = tabId;
        console.log('[Background] CDP attached to tab', tabId);
        setupCdpTarget({ tabId }, false);
    });
};

const detachCdp = () => {
    if (cdpTabId < 0 || !chrome.debugger) return;
    const tabId = cdpTabId;
    cdpTabId = -1;
    cdpChildSessions.clear();
    chrome.debugger.detach({ tabId }, () => { void chrome.runtime.lastError; });
    console.log('[Background] CDP detached from tab', tabId);
};

const handleCdpReport = (payload) => {
    if (!isRecording || cdpTabId !== recordingTabId) return;
    if (payload.kind === 'click') {
        cdpRecordClick(payload);
    } else if (payload.kind === 'key') {
        // While the native OS hook is armed and connected it is the authority for
        // keys in opaque frames (it sees keystrokes apps like Thinfinity swallow),
        // so drop the in-page CDP keydown report to avoid double-recording. When
        // no native host is present this stays the (best-effort) capture path.
        if (nativeArmed && nativePort) {
            if (THOTH_CLICK_DEBUG) console.log('[Background][native] drop CDP key (native owns it):', payload.key);
            return;
        }
        recordKeypressEvent(payload.key, payload.clientTime);
    }
};

// Screenshot + POST a CDP-captured click. Coordinates are already top-viewport
// device px, so scroll is zero (mirrors the sub-frame content-script path).
// Routed through the shared click gate as the 'cdp' (visual) modality.
const cdpRecordClick = (payload) => {
    if (!serverUrl || !sessionId || cdpTabId < 0) return;
    const ct = payload.clientTime || Date.now();
    emitClick({
        modality: 'cdp',
        clientTime: ct,
        targetKind: payload.targetKind,
        visual: payload.targetKind === 'visual',
        post: () => {
            chrome.tabs.get(cdpTabId, (tab) => {
                if (chrome.runtime.lastError || !tab) return;
                chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }, (view) => {
                    if (chrome.runtime.lastError) {
                        console.error('[Background] CDP capture error:', chrome.runtime.lastError.message);
                        return;
                    }
                    const formData = new FormData();
                    formData.append('clickview', viewToBlob(view), 'clickview.png');
                    formData.append('metadata', JSON.stringify({
                        targetKind: payload.targetKind,
                        tag: payload.tag,
                        selectors: { id: payload.id || null }
                    }));
                    const url = `${serverUrl}/recording/events/click?guid=${sessionId}&x=${payload.x}&y=${payload.y}&clientTime=${ct}`;
                    fetch(url, { method: 'POST', body: formData })
                        .then(() => console.log('[Background] CDP click recorded'))
                        .catch((error) => console.error('[Background] CDP click error:', error));
                });
            });
        }
    });
};

if (chrome.debugger) {
    chrome.debugger.onEvent.addListener((source, method, params) => {
        if (source.tabId !== cdpTabId) return;
        if (method === "Target.attachedToTarget") {
            // A child frame (often a cross-origin OOPIF) attached — set it up on its
            // own session. If it's paused at start (waitingForDebugger) we inject
            // before its scripts and then resume it. Remember frame sessions so we
            // can replay keys into them.
            const t = params.targetInfo && params.targetInfo.type;
            if (t === 'iframe' || t === 'page') {
                cdpChildSessions.add(params.sessionId);
            }
            setupCdpTarget({ tabId: cdpTabId, sessionId: params.sessionId }, params.waitingForDebugger);
        } else if (method === "Target.detachedFromTarget") {
            cdpChildSessions.delete(params.sessionId);
        } else if (method === "Runtime.bindingCalled" && params.name === "__thothReport") {
            try {
                handleCdpReport(JSON.parse(params.payload));
            } catch (e) {
                console.warn('[Background] Bad CDP payload:', e);
            }
        }
    });

    // If the user or the browser detaches the debugger, clear our state.
    chrome.debugger.onDetach.addListener((source) => {
        if (source.tabId === cdpTabId) {
            console.log('[Background] CDP detached externally');
            cdpTabId = -1;
            cdpChildSessions.clear();
        }
    });
}

// ---------------------------------------------------------------------------
// Native input-capture host (Windows).
// Opaque remote-app iframes (e.g. Thinfinity) grab the keyboard so deeply that no
// in-page listener — content script or CDP — can observe what the user types. A
// small native host installs an OS-level low-level keyboard hook (WH_KEYBOARD_LL)
// and reports the keystrokes back here. It is OPTIONAL: if the host isn't
// installed, connectNative fails and the rest of the recorder works exactly as
// before (clean-web flow is never affected).
// Capture is ARMED only while the user is inside an opaque frame (the last click
// arrived via the CDP path) AND the host self-gates on the browser being the
// foreground app, so it never records keystrokes for normal pages or other apps.
// ---------------------------------------------------------------------------
const NATIVE_HOST = 'com.thoth.inputcapture';
let nativePort = null;
let nativeArmed = false;

const connectNativeHost = () => {
    if (nativePort || !chrome.runtime.connectNative) return;
    try {
        const port = chrome.runtime.connectNative(NATIVE_HOST);
        port.onMessage.addListener((msg) => {
            if (!msg) return;
            if (msg.type === 'key') {
                // Record only while recording AND armed; the host also foreground-gates.
                if (isRecording && nativeArmed && msg.key) {
                    if (THOTH_CLICK_DEBUG) console.log('[Background][native] key', JSON.stringify(msg.key));
                    recordKeypressEvent(msg.key, msg.clientTime);
                }
            } else if (msg.type === 'hello') {
                console.log('[Background][native] host connected:', msg.version || '');
            }
        });
        port.onDisconnect.addListener(() => {
            const err = chrome.runtime.lastError;
            console.log('[Background][native] host disconnected:', err ? err.message : '(clean)');
            nativePort = null;
            nativeArmed = false;
        });
        nativePort = port;
        console.log('[Background][native] connectNative issued');
    } catch (e) {
        console.log('[Background][native] connectNative failed:', e && e.message);
        nativePort = null;
    }
};

const disconnectNativeHost = () => {
    if (!nativePort) return;
    try { nativePort.postMessage({ cmd: 'disarm' }); } catch (e) { /* ignore */ }
    try { nativePort.disconnect(); } catch (e) { /* ignore */ }
    nativePort = null;
    nativeArmed = false;
};

// Arm/disarm the native key capture. Driven by the click gate: a visual (opaque
// frame) click arms it; any DOM click disarms it. Lazily connects the host the
// first time capture is actually needed, so pure clean-web sessions never spawn it.
const setNativeArmed = (armed) => {
    if (armed === nativeArmed) return;
    nativeArmed = armed;
    if (armed && !nativePort) connectNativeHost();
    if (nativePort) {
        try { nativePort.postMessage({ cmd: armed ? 'arm' : 'disarm' }); } catch (e) { /* ignore */ }
    }
    if (THOTH_CLICK_DEBUG) console.log('[Background][native] armed =', armed);
};

// Initial state restore
console.log('[Background] Service worker started');
ensureStateRestored();
