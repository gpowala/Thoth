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

// Record click event
const recordClickEvent = (sender, windowSize, position, scroll, metadata, clientTime) => {
    const adjustedX = position.x + scroll.x;
    const adjustedY = position.y + scroll.y;
    const url = `${serverUrl}/recording/events/click?guid=${sessionId}&x=${adjustedX}&y=${adjustedY}&clientTime=${clientTime || Date.now()}`;

    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" }, (clickView) => {
        if (chrome.runtime.lastError) {
            console.error("[Background] Capture error:", chrome.runtime.lastError.message);
            return;
        }

        const formData = new FormData();
        formData.append('clickview', viewToBlob(clickView), 'clickview.png');
        // Additive target envelope (selectors + DOM/visual classification). The
        // coordinate params above are unchanged; this is extra context only.
        if (metadata) {
            formData.append('metadata', JSON.stringify(metadata));
        }

        fetch(url, { method: 'POST', body: formData })
            .then(() => console.log('[Background] Click event recorded'))
            .catch((error) => console.error('[Background] Click record error:', error));
    });
};

// Record mousedown event
const recordMousedownEvent = (sender, windowSize, position, scroll, metadata, clientTime) => {
    const url = `${serverUrl}/recording/events/click?guid=${sessionId}&x=${position.x}&y=${position.y}&clientTime=${clientTime || Date.now()}`;

    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" }, (clickView) => {
        if (chrome.runtime.lastError) {
            console.error("[Background] Capture error:", chrome.runtime.lastError.message);
            return;
        }

        const formData = new FormData();
        formData.append('clickview', viewToBlob(clickView), 'clickview.png');
        if (metadata) {
            formData.append('metadata', JSON.stringify(metadata));
        }

        fetch(url, { method: 'POST', body: formData })
            .then(() => console.log('[Background] Mousedown event recorded'))
            .catch((error) => console.error('[Background] Mousedown record error:', error));
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

// Initial state restore
console.log('[Background] Service worker started');
ensureStateRestored();
