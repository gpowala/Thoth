document.addEventListener('click', function(event)
{
    chrome.runtime.sendMessage(
    {
        action: "tests-recorder-click-event",
        position:
        {
            x: event.clientX,
            y: event.clientY
        }
    });

    console.log('tests-recorder-click-event sent to processing script');
});

document.addEventListener('keypress', function(event)
{
    chrome.runtime.sendMessage(
    {
        action: "tests-recorder-keypress-event",
        key: event.key
    });

    console.log('tests-recorder-keypress-event sent to processing script');
});

// add mouse move
// add scroll