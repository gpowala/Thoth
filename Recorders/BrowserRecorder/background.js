let recordingTabId = -1;

let serverUrl = '';
let sessionId = '';

let isSessionActiveInterval = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) =>
{
    if (message.action === "tests-recorder-start-recording")
    {
        recordingTabId = getActiveTabId();

        serverUrl = message.serverUrl;
        sessionId = message.sessionId;

        startRecording();
    }

    if (message.action === "tests-recorder-stop-recording")
    {
        stopRecording();

        recordingTabId = -1;

        serverUrl = '';
        sessionId = '';
    }

    if (recordingTabId === getActiveTabId())
    {
        if (message.action === "tests-recorder-click-event")
        {    
            recordClickEvent(sender, message.position.x, message.position.y);
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
    fetch(serverUrl + '/recording/start/' + sessionId, {method: 'GET'})
    .then(() =>
    {
        chrome.alarms.create('isSessionActive', { periodInMinutes: 1 });
        console.log('Recording started!')
    })
    .catch((error) => console.error('Error upon recording start: ', error));
}

var stopRecording = () =>
{
    fetch(serverUrl + '/recording/stop/' + sessionId, {method: 'GET'})
    .then(console.log('Recording stopped!'))
    .catch((error) => console.error('Error upon recording stop:', error));

    chrome.alarms.clear('isSessionActive');
}

var isActive = () =>
{
    fetch(serverUrl + '/recording/is-active/' + sessionId, {method: 'GET'})
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

var recordClickEvent = (sender, x, y) =>
{
    var recordClickEventEndpointUrl = `${serverUrl}/recording/events/click/${sessionId}/${x}/${y}`;

    chrome.tabs.captureVisibleTab(sender.tab.windowId, {format: "png"}, (clickView) =>
    {
        if (chrome.runtime.lastError)
        {
            console.error("Error upon capturing tab on click:", chrome.runtime.lastError.message);
        }
        else
        {
            const formData = new FormData();
            formData.append('clickView', viewToBlob(clickView), 'clickview.png');

            fetch(recordClickEventEndpointUrl, { method: 'POST', body: formData})
            .then(console.log('Click event recorded.'))
            .catch((error) => console.error('Error upon click event recording: ', error));
        }
    });
}

var recordAreaSelectEvent = (sender, top, bottom, left, right) =>
{
    var recordClickEventEndpointUrl = `${serverUrl}/recording/events/area-select/${sessionId}/${top}/${bottom}/${left}/${right}`;

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
    var recordKeypressEventEndpointUrl = serverUrl + '/recording/events/keypress/' + sessionId + '/' + key;
    
    fetch(recordKeypressEventEndpointUrl, {method: 'GET'})
    .then(console.log('Keypress event recorded.'))
    .catch((error) => console.error('Error upon keypress event recording: ', error));
}
