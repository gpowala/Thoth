console.log('content script started');

document.addEventListener('click', function() {
    console.log('sending takeScreenshot event');
    chrome.runtime.sendMessage({action: "takeScreenshot"});
    console.log('sent takeScreenshot event');
});