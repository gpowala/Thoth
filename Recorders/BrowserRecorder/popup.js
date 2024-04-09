document.getElementById('startBtn').addEventListener('click', () => {
    console.log('send start')
    chrome.runtime.sendMessage({action: "startTakingScreenshots"});
});