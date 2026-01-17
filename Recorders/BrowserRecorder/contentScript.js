// Content script for Thoth Tests Recorder
// This script is injected into web pages to capture user interactions

// Use window-level state to persist across re-injections
window.thothRecorder = window.thothRecorder || {
    initialized: false,
    isRecording: false,
    extensionContextValid: true,
    handlers: {},
    retryCount: 0
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
            className: event.target.className
        }
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
            className: event.target.className
        }
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

// Keypress event handler
const keypressHandler = function(event) {
    safeSendMessage({
        action: "tests-recorder-keypress-event",
        key: event.key,
        timestamp: performance.now()
    }, 'Keypress event captured');
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
                }
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
        visibilitychange: visibilityChangeHandler,
        focus: focusHandler,
        pageshow: pageShowHandler
    };
    
    // Add event listeners
    document.addEventListener('click', clickHandler, true);
    document.addEventListener('mousedown', mousedownHandler, true);
    document.addEventListener('keypress', keypressHandler);
    document.addEventListener('keydown', keydownHandler);
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
