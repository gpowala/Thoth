let recordingTabId = -1;

let serverUrl = '';
let sessionId = '';

let isSessionActiveInterval = null;

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
        stopRecording();
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

// Clean up when the extension is reloaded
// chrome.runtime.onSuspend.addListener(() => {
//     if (recordingTabId >= 0) {
//         console.log('Extension unloading, stopping recording');
//         stopRecording();
//     }
// });

var initializeExtension = () => {
    // Clear any existing alarms to prevent errors
    chrome.alarms.clear('isSessionActive');
    
    // Restore recording state from storage
    restoreRecordingState();
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
        }
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) =>
{
    if (message.action === "tests-recorder-start-recording")
    {
        getActiveTabId().then(tabId => {
            recordingTabId = tabId;
            
            const url = new URL(message.serverUrl);
            serverUrl = `${url.protocol}//${url.host}`;
            sessionId = url.searchParams.get('guid');

            startRecording();
            storeRecordingState(serverUrl, sessionId, recordingTabId, true);
        }).catch(error => {
            console.error('Failed to get active tab ID:', error);
        });
    }

    if (message.action === "tests-recorder-stop-recording")
    {
        stopRecording();
        storeRecordingState('', '', -1, false);
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
    // Clear the alarm first to prevent further calls to isActive
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
}

var isActive = () =>
{
    // Check if recordingTabId is valid before proceeding
    if (recordingTabId < 0) {
        console.log('Recording tab ID is invalid, stopping recording');
        stopRecording();
        return;
    }
    
    // Check if the tab still exists before trying to update it
    chrome.tabs.get(recordingTabId, (tab) => {
        if (chrome.runtime.lastError) {
            console.log('Recording tab no longer exists, stopping recording');
            stopRecording();
            return;
        }
        
        // Prevent tab from sleeping
        chrome.tabs.update(recordingTabId, { active: true });
        
        fetch(serverUrl + '/recording/session/is-active?guid=' + sessionId, {method: 'GET'})
        .catch((error) =>
        {
            console.error('Error upon recording is-active:', error);
            stopRecording();
        });
    });
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
    var recordKeypressEventEndpointUrl = `${serverUrl}/recording/events/keypress?guid=${sessionId}&key=${key}`;
    
    fetch(recordKeypressEventEndpointUrl, {method: 'GET'})
    .then(console.log('Keypress event recorded.'))
    .catch((error) => console.error('Error upon keypress event recording: ', error));
}

