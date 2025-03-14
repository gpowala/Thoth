let pendingMousedownEvent = null;
let mousedownProcessingTimer = null;
const CLICK_PRIORITY_DELAY = 350;

// Click event listener - has priority
document.addEventListener('click', function(event)
{
    // Clear any pending mousedown event
    if (mousedownProcessingTimer) {
        clearTimeout(mousedownProcessingTimer);
        mousedownProcessingTimer = null;
        pendingMousedownEvent = null;
    }
    
    const dpr = window.devicePixelRatio || 1; // Device Pixel Ratio

    chrome.runtime.sendMessage(
    {
        action: "tests-recorder-click-event",
        window:
        {
            width: parseInt(window.innerWidth * dpr),
            height: parseInt(window.innerHeight * dpr)
        },
        position:
        {
            x: parseInt(event.pageX * dpr),
            y: parseInt(event.pageY * dpr)
        },
        scroll:
        {
            x: parseInt(window.scrollX * dpr),
            y: parseInt(window.scrollY * dpr)
        },
        target: {
            tagName: event.target.tagName,
            id: event.target.id,
            className: event.target.className
        }
    });

    console.log('tests-recorder-click-event sent to processing script', event.target);
}, true);

// Mousedown event listener - used as fallback
document.addEventListener('mousedown', function(event)
{
    // Store the event data
    const dpr = window.devicePixelRatio || 1;
    pendingMousedownEvent = {
        action: "tests-recorder-mousedown-event",
        window:
        {
            width: parseInt(window.innerWidth * dpr),
            height: parseInt(window.innerHeight * dpr)
        },
        position:
        {
            x: parseInt(event.pageX * dpr),
            y: parseInt(event.pageY * dpr)
        },
        scroll:
        {
            x: parseInt(window.scrollX * dpr),
            y: parseInt(window.scrollY * dpr)
        },
        target: {
            tagName: event.target.tagName,
            id: event.target.id,
            className: event.target.className
        }
    };
    
    // Set a timer to process the mousedown event only if no click event occurs
    if (mousedownProcessingTimer) {
        clearTimeout(mousedownProcessingTimer);
    }
    
    mousedownProcessingTimer = setTimeout(() => {
        if (pendingMousedownEvent) {
            chrome.runtime.sendMessage(pendingMousedownEvent);
            console.log('tests-recorder-mousedown-event sent to processing script (as fallback)', event.target);
            pendingMousedownEvent = null;
        }
        mousedownProcessingTimer = null;
    }, CLICK_PRIORITY_DELAY);
}, true);

document.addEventListener('keypress', function(event)
{
    chrome.runtime.sendMessage(
    {
        action: "tests-recorder-keypress-event",
        key: event.key,
        timestamp: performance.now()
    });

    console.log('tests-recorder-keypress-event sent to processing script');
});

document.addEventListener('keydown', function(event)
{
    if (event.altKey && event.shiftKey && event.code === "KeyW")
    {
        createOverlay();

        event.preventDefault();
    }
});

var thoth_waitScreenshotInProgress = false;
var thoth_waitScreenshotStartX = null;
var thoth_waitScreenshotStartY = null;

function createOverlay()
{
    const overlay = document.createElement('canvas');
    overlay.className = 'thoth-overlay-canvas';

    document.body.appendChild(overlay);

    overlay.addEventListener('mousedown', (event) =>
    {
        var canvas = document.getElementsByTagName('canvas')[0];

        var ctx = canvas.getContext("2d");

        ctx.canvas.width = window.innerWidth;
        ctx.canvas.height = window.innerHeight;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        thoth_waitScreenshotStartX = event.clientX;
        thoth_waitScreenshotStartY = event.clientY;

        thoth_waitScreenshotInProgress = true;
    });

    overlay.addEventListener('mousemove', (event) =>
    {
        if (thoth_waitScreenshotInProgress)
        {
            var canvas = document.getElementsByTagName('canvas')[0];
    
            var ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            ctx.beginPath();
            ctx.imageSmoothingEnabled = false;
            ctx.lineWidth = "1";
            ctx.strokeStyle = "red";
            
            ctx.rect(thoth_waitScreenshotStartX, thoth_waitScreenshotStartY, event.clientX - thoth_waitScreenshotStartX, event.clientY - thoth_waitScreenshotStartY);
            ctx.stroke();
        }
    });

    overlay.addEventListener('mouseup', (event) =>
    {
        if (thoth_waitScreenshotInProgress)
        {
            document.body.removeChild(overlay);
            thoth_waitScreenshotInProgress = false;

            chrome.runtime.sendMessage(
            {
                action: "tests-recorder-area-select-event",
                rect:
                {
                    top: Math.min(thoth_waitScreenshotStartY, event.clientY),
                    bottom: Math.max(thoth_waitScreenshotStartY, event.clientY),
                    left: Math.min(thoth_waitScreenshotStartX, event.clientX),
                    right: Math.max(thoth_waitScreenshotStartX, event.clientX)
                }
            });
        
            console.log('tests-recorder-area-select-event sent to processing script');
        }
    });

    overlay.addEventListener('click', () =>
    {
        if (!thoth_waitScreenshotInProgress)
        {
            document.body.removeChild(overlay);
        }
    });
}

// add mouse move
// add scroll