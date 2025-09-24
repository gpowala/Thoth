let recordingTabId = -1;

let serverUrl = '';
let sessionId = '';
let isRecording = false;

let isSessionActiveInterval = null;
let lastEventTime = 0;
let eventValidationTimer = null;

// Initialize the extension on startup
chrome.runtime.onStartup.addListener(() => {
    initializeExtension();
});

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        initializeExtension();
    } else if (details.reason === 'update') {
        // Clear any existing alarms when updating
        chrome.alarms.clear('isSessionActive');
        console.log('Extension updated, cleared existing alarms');
    }
});

// Clean up when the extension is unloaded
chrome.runtime.onSuspend.addListener(() => {
    if (recordingTabId >= 0) {
        console.log('Extension unloading, stopping recording');
        //stopRecording();
    }
});

// Clean up when the extension is disabled
// chrome.management.onDisabled.addListener((extensionInfo) => {
//     if (extensionInfo.id === chrome.runtime.id) {
//         console.log('Extension disabled, clearing alarms');
//         chrome.alarms.clear('isSessionActive');
//     }
// });

// Clean up when the extension is uninstalled
// chrome.management.onUninstalled.addListener((extensionInfo) => {
//     if (extensionInfo.id === chrome.runtime.id) {
//         console.log('Extension uninstalled, clearing alarms');
//         chrome.alarms.clear('isSessionActive');
//     }
// });

// Clean up when the extension is reloaded
chrome.runtime.onStartup.addListener(() => {
    // Clear any existing alarms when starting up
    chrome.alarms.clear('isSessionActive');
    console.log('Extension starting up, cleared existing alarms');
});

// Listen for window focus changes to handle minimize/maximize
chrome.windows.onFocusChanged.addListener((windowId) => {
    if (recordingTabId >= 0 && isRecording) {
        // When a window gains focus, validate the recording tab
        validateRecordingTab().catch((error) => {
            console.error('Error validating recording tab on window focus:', error);
        });
        
        // Also check if we need to re-inject the content script
        const now = Date.now();
        if (lastEventTime > 0 && (now - lastEventTime) > 60000) { // 1 minute without events
            console.log('Window restored but no recent events, re-injecting content script');
            chrome.scripting.executeScript({
                target: { tabId: recordingTabId },
                files: ['contentScript.js']
            }).then(() => {
                console.log('Content script re-injected after window restore');
                lastEventTime = now; // Reset the timer
            }).catch((error) => {
                console.log('Failed to re-inject content script after window restore:', error);
            });
        }
    }
});

// Listen for tab updates to handle tab state changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tabId === recordingTabId && changeInfo.status === 'complete') {
        // Tab has finished loading, ensure it's still valid
        validateRecordingTab().catch((error) => {
            console.error('Error validating recording tab on tab update:', error);
        });
    }
});

var initializeExtension = () => {
    // Clear any existing alarms to prevent errors
    chrome.alarms.clear('isSessionActive');
    
    // Restore recording state from storage
    restoreRecordingState();
    
    // Create a periodic health check alarm
    chrome.alarms.create('healthCheck', { periodInMinutes: 5 });
}

var storeRecordingState = (serverUrl, sessionId, recordingTabId, isRecording) => {
    chrome.storage.local.set({
        'serverUrl': serverUrl,
        'sessionId': sessionId,
        'recordingTabId': recordingTabId,
        'isRecording': isRecording
    }, function() {
        console.log('Recording state stored in storage');
    });
}

var restoreRecordingState = () => {
    chrome.storage.local.get(['serverUrl', 'sessionId', 'recordingTabId', 'isRecording'], function(result) {
        serverUrl = result.serverUrl || '';
        sessionId = result.sessionId || '';
        recordingTabId = result.recordingTabId || -1;
        isRecording = result.isRecording || false;
        
        // Validate the restored state
        if (!isRecording || recordingTabId < 0 || !serverUrl || !sessionId) {
            console.log('Invalid recording state restored, clearing state');
            recordingTabId = -1;
            serverUrl = '';
            sessionId = '';
            isRecording = false;
            storeRecordingState('', '', -1, false);
        } else {
            console.log('Restored recording session from storage');
            // Validate the tab still exists
            validateRecordingTab().catch((error) => {
                console.error('Error validating restored recording tab:', error);
            });
        }
    });
}

// New function to validate recording tab
var validateRecordingTab = () => {
    if (recordingTabId < 0 || !isRecording) {
        return Promise.resolve(false);
    }
    
    return new Promise((resolve) => {
        chrome.tabs.get(recordingTabId, (tab) => {
            if (chrome.runtime.lastError || !tab) {
                console.log('Recording tab no longer exists, stopping recording');
                stopRecording();
                resolve(false);
            } else {
                // Check if the tab is accessible (not in a minimized window)
                chrome.windows.get(tab.windowId, (window) => {
                    if (chrome.runtime.lastError || !window) {
                        console.log('Recording window no longer exists, stopping recording');
                        stopRecording();
                        resolve(false);
                    } else {
                        // Additional check: ensure the tab is still accessible
                        try {
                            // Add a timeout to prevent hanging
                            const pingTimeout = setTimeout(() => {
                                console.log('Ping timeout, tab may be inactive - attempting to re-inject content script');
                                // Try to re-inject the content script if ping times out
                                chrome.scripting.executeScript({
                                    target: { tabId: recordingTabId },
                                    files: ['contentScript.js']
                                }).then(() => {
                                    console.log('Content script re-injected successfully');
                                    resolve(true);
                                }).catch((error) => {
                                    console.log('Failed to re-inject content script:', error);
                                    resolve(true); // Continue recording anyway
                                });
                            }, 2000); // 2 second timeout
                            
                            chrome.tabs.sendMessage(recordingTabId, { action: "ping" }, (response) => {
                                clearTimeout(pingTimeout);
                                if (chrome.runtime.lastError) {
                                    console.log('Tab is not responding to messages, attempting to re-inject content script');
                                    // Try to re-inject the content script
                                    chrome.scripting.executeScript({
                                        target: { tabId: recordingTabId },
                                        files: ['contentScript.js']
                                    }).then(() => {
                                        console.log('Content script re-injected successfully after ping failure');
                                        resolve(true);
                                    }).catch((error) => {
                                        console.log('Failed to re-inject content script after ping failure:', error);
                                        resolve(true); // Continue recording anyway
                                    });
                                } else {
                                    console.log('Recording tab is valid and responsive');
                                    resolve(true);
                                }
                            });
                        } catch (error) {
                            console.log('Error checking tab responsiveness:', error);
                            resolve(true); // Assume tab is still valid
                        }
                    }
                });
            }
        });
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) =>
{
    if (message.action === "tests-recorder-start-recording")
    {
        // Clear any existing recording state first
        if (isRecording) {
            console.log('Clearing existing recording state before starting new recording');
            stopRecording();
        }
        
        getActiveTabId().then(tabId => {
            recordingTabId = tabId;
            isRecording = true;
            
            const url = new URL(message.serverUrl);
            serverUrl = `${url.protocol}//${url.host}`;
            sessionId = url.searchParams.get('guid');

            startRecording();
            storeRecordingState(serverUrl, sessionId, recordingTabId, true);
        }).catch(error => {
            console.error('Failed to get active tab ID:', error);
            // Reset state on error
            isRecording = false;
            storeRecordingState('', '', -1, false);
        });
    }

    if (message.action === "tests-recorder-stop-recording")
    {
        stopRecording();
        storeRecordingState('', '', -1, false);
    }

    if (message.action === "tests-recorder-reset-state")
    {
        console.log('Resetting recording state due to user request');
        stopRecording();
        storeRecordingState('', '', -1, false);
        sendResponse({ success: true });
    }

    if (message.action === "tests-recorder-test-content-script")
    {
        if (recordingTabId >= 0 && isRecording) {
            console.log('Testing content script responsiveness');
            chrome.tabs.sendMessage(recordingTabId, { action: "ping" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.log('Content script not responding, re-injecting...');
                    chrome.scripting.executeScript({
                        target: { tabId: recordingTabId },
                        files: ['contentScript.js']
                    }).then(() => {
                        console.log('Content script re-injected for testing');
                        sendResponse({ success: true, message: 'Content script re-injected' });
                    }).catch((error) => {
                        console.log('Failed to re-inject content script for testing:', error);
                        sendResponse({ success: false, message: 'Failed to re-inject content script' });
                    });
                } else {
                    console.log('Content script is responding');
                    sendResponse({ success: true, message: 'Content script is working' });
                }
            });
        } else {
            sendResponse({ success: false, message: 'No active recording session' });
        }
        return true; // Keep the message channel open for async response
    }

    // Check if the current tab is the recording tab
    if (sender.tab && sender.tab.id === recordingTabId)
    {
        if (message.action === "tests-recorder-click-event")
        {    
            recordClickEvent(sender, message.window, message.position, message.scroll);
        }

        if (message.action === "tests-recorder-mousedown-event")
        {
            recordMousedownEvent(sender, message.window, message.position, message.scroll, message.target);
        }
    
        if (message.action === "tests-recorder-area-select-event")
        {    
            recordAreaSelectEvent(sender, message.rect.top, message.rect.bottom, message.rect.left, message.rect.right);
        }
    
        if (message.action === "tests-recorder-keypress-event")
        {
            recordKeypressEvent(message.key);
        }
    }
});

chrome.alarms.onAlarm.addListener((alarm) =>
{
    if (alarm.name === 'isSessionActive') 
    {
        isActive();
    }
    
    if (alarm.name === 'healthCheck')
    {
        performHealthCheck();
    }
});

// Listen for tab removal to stop recording if the recording tab is closed
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (tabId === recordingTabId) {
        console.log('Recording tab was closed, stopping recording');
        stopRecording();
        storeRecordingState('', '', -1, false);
    }
});

// Listen for window removal to stop recording if the recording window is closed
chrome.windows.onRemoved.addListener((windowId) => {
    if (recordingTabId >= 0) {
        chrome.tabs.get(recordingTabId, (tab) => {
            if (chrome.runtime.lastError || tab.windowId === windowId) {
                console.log('Recording window was closed, stopping recording');
                stopRecording();
                storeRecordingState('', '', -1, false);
            }
        });
    }
});

var getActiveTabId = () =>
{
    return new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
        {
            if (tabs.length !== 0)
            {
                console.log('Active tab: ', tabs[0].id);
                resolve(tabs[0].id);
            }
            else
            {
                reject(new Error('No active tab found'));
            }
        });
    });
}

var startRecording = () =>
{
    // Only start recording if we have valid session data
    if (!serverUrl || !sessionId || recordingTabId < 0) {
        console.error('Cannot start recording: missing required session data');
        return;
    }
    
    // Reset event timer
    lastEventTime = Date.now();
    
    fetch(serverUrl + '/recording/session/start?guid=' + sessionId, {method: 'GET'})
    .then(() =>
    {
        // Only create alarm if we have a valid recording tab
        if (recordingTabId >= 0) {
            // Verify the tab still exists before creating the alarm
            chrome.tabs.get(recordingTabId, (tab) => {
                if (chrome.runtime.lastError) {
                    console.error('Recording tab no longer exists, cannot start recording');
                    stopRecording();
                    return;
                }
                
                chrome.alarms.create('isSessionActive', { periodInMinutes: 1 });
                console.log('Recording started!')
            });
        } else {
            console.error('Cannot create alarm: invalid recording tab ID');
        }
    })
    .catch((error) => console.error('Error upon recording start: ', error));
}

var stopRecording = () =>
{
    // Clear the alarms first to prevent further calls
    chrome.alarms.clear('isSessionActive');
    
    // Only make the API call if we have valid session data
    if (serverUrl && sessionId) {
        fetch(serverUrl + '/recording/session/stop?guid=' + sessionId, {method: 'GET'})
        .then(console.log('Recording stopped!'))
        .catch((error) => console.error('Error upon recording stop:', error));
    }

    // Reset recording state
    recordingTabId = -1;
    serverUrl = '';
    sessionId = '';
    isRecording = false;
}

var isActive = () =>
{
    // First validate the recording tab before proceeding
    validateRecordingTab().then((isValid) => {
        if (!isValid) {
            return; // Recording was already stopped by validateRecordingTab
        }
        
        // Try to keep the tab active, but don't fail if it's minimized
        chrome.tabs.update(recordingTabId, { active: true }, (result) => {
            if (chrome.runtime.lastError) {
                // Tab might be in a minimized window, that's okay
                console.log('Could not activate tab (possibly minimized):', chrome.runtime.lastError.message);
            }
            
            // Continue with the session check regardless of tab activation
            fetch(serverUrl + '/recording/session/is-active?guid=' + sessionId, {method: 'GET'})
            .catch((error) =>
            {
                console.error('Error upon recording is-active:', error);
                // Don't stop recording on network errors, only on tab validation failures
            });
        });
        
        // Additional check: if no events for a while, try to re-inject content script
        const now = Date.now();
        if (lastEventTime > 0 && (now - lastEventTime) > 180000) { // 3 minutes without events
            console.log('No events for 3+ minutes during isActive check, attempting to re-inject content script');
            chrome.scripting.executeScript({
                target: { tabId: recordingTabId },
                files: ['contentScript.js']
            }).then(() => {
                console.log('Content script re-injected during isActive check');
                lastEventTime = now; // Reset the timer
            }).catch((error) => {
                console.log('Failed to re-inject content script during isActive check:', error);
            });
        }
    }).catch((error) => {
        console.error('Error in isActive validation:', error);
    });
}

var performHealthCheck = () => {
    if (isRecording && recordingTabId >= 0) {
        console.log('Performing periodic health check');
        validateRecordingTab().then((isValid) => {
            if (!isValid) {
                console.log('Health check failed, recording was stopped');
            } else {
                console.log('Health check passed');
                
                // Check if we're receiving events
                const now = Date.now();
                const timeSinceLastEvent = now - lastEventTime;
                
                if (lastEventTime > 0 && timeSinceLastEvent > 300000) { // 5 minutes without events
                    console.log('No events received for 5+ minutes, attempting to re-inject content script');
                    chrome.scripting.executeScript({
                        target: { tabId: recordingTabId },
                        files: ['contentScript.js']
                    }).then(() => {
                        console.log('Content script re-injected due to inactivity');
                        lastEventTime = now; // Reset the timer
                    }).catch((error) => {
                        console.log('Failed to re-inject content script due to inactivity:', error);
                    });
                }
            }
        }).catch((error) => {
            console.error('Health check error:', error);
        });
    }
}


var viewToBlob = (view) =>
{
    let arr = view.split(','), mime = arr[0].match(/:(.*?);/)[1],
        bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while(n--){
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], {type:mime});
}

var recordClickEvent = (sender, window, position, scroll) =>
{
    // Update last event time
    lastEventTime = Date.now();
    
    var adjustedX = position.x + scroll.x;
    var adjustedY = position.y + scroll.y;
    
    var recordClickEventEndpointUrl = `${serverUrl}/recording/events/click?guid=${sessionId}&x=${adjustedX}&y=${adjustedY}`;

    chrome.tabs.captureVisibleTab(sender.tab.windowId, {format: "png"}, (clickView) =>
    {
        if (chrome.runtime.lastError)
        {
            console.error("Error upon capturing tab on click:", chrome.runtime.lastError.message);
        }
        else
        {
            const formData = new FormData();
            formData.append('clickview', viewToBlob(clickView), 'clickview.png');

            fetch(recordClickEventEndpointUrl, { method: 'POST', body: formData})
            .then(console.log('Click event recorded.'))
            .catch((error) => console.error('Error upon click event recording: ', error));
        }
    });
}

var recordMousedownEvent = (sender, window, position, scroll, target) =>
{
    // Update last event time
    lastEventTime = Date.now();
    
    // Process mousedown events the same way as click events
    var recordMousedownEventEndpointUrl = `${serverUrl}/recording/events/click?guid=${sessionId}&x=${position.x}&y=${position.y}`;

    chrome.tabs.captureVisibleTab(sender.tab.windowId, {format: "png"}, (clickView) =>
    {
        if (chrome.runtime.lastError)
        {
            console.error("Error upon capturing tab on mousedown:", chrome.runtime.lastError.message);
        }
        else
        {
            const formData = new FormData();
            formData.append('clickview', viewToBlob(clickView), 'clickview.png');

            fetch(recordMousedownEventEndpointUrl, { method: 'POST', body: formData})
            .then(console.log('Mousedown event recorded.'))
            .catch((error) => console.error('Error upon mousedown event recording: ', error));
        }
    });
}

var recordAreaSelectEvent = (sender, top, bottom, left, right) =>
{
    // Update last event time
    lastEventTime = Date.now();
    
    var recordClickEventEndpointUrl = `${serverUrl}/recording/events/area-select?guid=${sessionId}&top=${top}&bottom=${bottom}&left=${left}&right=${right}`;

    chrome.tabs.captureVisibleTab(sender.tab.windowId, {format: "png"}, (areaSelectView) =>
    {
        if (chrome.runtime.lastError)
        {
            console.error("Error upon capturing tab on area-select:", chrome.runtime.lastError.message);
        }
        else
        {
            const formData = new FormData();
            formData.append('areaSelectView', viewToBlob(areaSelectView), 'clickview.png');

            fetch(recordClickEventEndpointUrl, { method: 'POST', body: formData})
            .then(console.log('Area-select event recorded.'))
            .catch((error) => console.error('Error upon area-select event recording: ', error));
        }
    });
}

var recordKeypressEvent = (key) =>
{
    // Update last event time
    lastEventTime = Date.now();
    
    var recordKeypressEventEndpointUrl = `${serverUrl}/recording/events/keypress?guid=${sessionId}&key=${key}`;
    
    fetch(recordKeypressEventEndpointUrl, {method: 'GET'})
    .then(console.log('Keypress event recorded.'))
    .catch((error) => console.error('Error upon keypress event recording: ', error));
}

