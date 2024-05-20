let isRecording = false;

let serverUrl = '';
let sessionId = '';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) =>
{
    if (message.action === "tests-recorder-start-recording")
    {
        isRecording = true;

        serverUrl = message.serverUrl;
        sessionId = message.sessionId;

        startRecording();
    }

    if (message.action === "tests-recorder-stop-recording")
    {
        stopRecording();

        isRecording = false;

        serverUrl = '';
        sessionId = '';
    }

    if (message.action === "tests-recorder-click-event" && isRecording)
    {    
        recordClickEvent(sender, message.position.x, message.position.y);
    }

    if (message.action === "tests-recorder-keypress-event" && isRecording)
    {
        recordKeypressEvent(message.key);
    }
});

var startRecording = () =>
{
    fetch(serverUrl + '/recording/start/' + sessionId, {method: 'GET'})
    .then(console.log('Recording started!'))
    .catch((error) => console.error('Error upon recording start: ', error));
}

var stopRecording = () =>
{
    fetch(serverUrl + '/recording/stop/' + sessionId, {method: 'GET'})
    .then(console.log('Recording stopped!'))
    .catch((error) => console.error('Error upon recording stop:', error));
}

function clickViewToBlob(clickView)
{
    let arr = clickView.split(','), mime = arr[0].match(/:(.*?);/)[1],
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
            console.error("Error upon capturing tab:", chrome.runtime.lastError.message);
        }
        else
        {
            const formData = new FormData();
            formData.append('clickView', clickViewToBlob(clickView), 'clickview.png');

            fetch(recordClickEventEndpointUrl, { method: 'POST', body: formData})
            .then(console.log('Click event recorded.'))
            .catch((error) => console.error('Error upon click event recording: ', error));
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
