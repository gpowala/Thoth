let takingScreenshotsEnabled = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "startTakingScreenshots") {
        takingScreenshotsEnabled = true;
    }

    if (message.action === "takeScreenshot" && takingScreenshotsEnabled) {
        chrome.tabs.captureVisibleTab(sender.tab.windowId, {format: "png"}, (dataUrl) => {
            if (chrome.runtime.lastError) {
                console.error("Error capturing tab:", chrome.runtime.lastError.message);
                return;
            }
            
            sendScreenshot(dataUrl);
        });
    }
});

function sendToServer(formData) {
    fetch('http://localhost:5072/upload-screenshot', {
        method: 'POST',
        body: formData,
        // Add any headers your API requires. Usually, Content-Type is multipart/form-data,
        // but when using FormData, you should omit it so the browser sets it automatically,
        // along with the correct boundary.
        // headers: {
        //     'Content-Type': 'multipart/form-data' // Do not set this when using FormData
        // },
    })
    .then(response => response.json())
    .then(data => console.log('Success:', data))
    .catch((error) => console.error('Error:', error));
}

function dataURLtoBlob(dataurl) {
    let arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
        bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while(n--){
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], {type:mime});
}

function sendScreenshot(dataUrl) {
    const blob = dataURLtoBlob(dataUrl);
    const formData = new FormData();
    formData.append('file', blob, 'screenshot.png');

    // Now formData is ready to be sent to the server
    sendToServer(formData);
}

