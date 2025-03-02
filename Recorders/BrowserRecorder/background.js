let recordingTabId = -1;

let serverUrl = '';
let sessionId = '';

let isSessionActiveInterval = null;

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
        serverUrl = result.serverUrl;
        sessionId = result.sessionId;
        recordingTabId = result.recordingTabId;
        isRecording = result.isRecording;
        
        console.log('Restored recording session from storage');
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) =>
{
    if (message.action === "tests-recorder-start-recording")
    {
        recordingTabId = getActiveTabId();

        const url = new URL(message.serverUrl);
        serverUrl = `${url.protocol}//${url.host}`;
        sessionId = url.searchParams.get('guid');

        startRecording();
        storeRecordingState(serverUrl, sessionId, true);
    }

    if (message.action === "tests-recorder-stop-recording")
    {
        stopRecording();
        storeRecordingState('', '', -1, false);

        recordingTabId = -1;

        serverUrl = '';
        sessionId = '';
    }

    if (recordingTabId === getActiveTabId())
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

var getActiveTabId = () =>
{
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
    {
        if (tabs.length !== 0)
        {
            console.log('Active tab: ', tabs[0].windowId);
            return tabs[0].windowId;
        }
        else
        {
            throw Error('No active tab found');
        }
    });
}

var startRecording = () =>
{
    fetch(serverUrl + '/recording/session/start?guid=' + sessionId, {method: 'GET'})
    .then(() =>
    {
        chrome.alarms.create('isSessionActive', { periodInMinutes: 1 });
        console.log('Recording started!')
    })
    .catch((error) => console.error('Error upon recording start: ', error));
}

var stopRecording = () =>
{
    fetch(serverUrl + '/recording/session/stop?guid=' + sessionId, {method: 'GET'})
    .then(console.log('Recording stopped!'))
    .catch((error) => console.error('Error upon recording stop:', error));

    chrome.alarms.clear('isSessionActive');
}

var isActive = () =>
{
    fetch(serverUrl + '/recording/session/is-active?guid=' + sessionId, {method: 'GET'})
    .catch((error) =>
    {
        console.error('Error upon recording is-active:', error);
        stopRecording();
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

