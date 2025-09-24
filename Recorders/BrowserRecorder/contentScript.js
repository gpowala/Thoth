// Prevent duplicate script execution
if (window.thothRecorderInitialized) {
    console.log('Thoth recorder already initialized, skipping duplicate script');
} else {
    window.thothRecorderInitialized = true;

    const CLICK_PRIORITY_DELAY = 350;

    let pendingMousedownEvent = null;
    let mousedownProcessingTimer = null;
    
    let extensionContextValid = true;

    // Helper function to safely send messages
    const safeSendMessage = (message, logMessage) => {
        if (!extensionContextValid) {
            return false;
        }
        
        // Check if chrome runtime is available
        if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
            if (extensionContextValid) {
                console.warn('Extension context invalidated - recording disabled');
                extensionContextValid = false;
            }
            return false;
        }
        
        try {
            chrome.runtime.sendMessage(message);
            if (logMessage) {
                console.log(logMessage);
            }
            return true;
        } catch (error) {
            if (extensionContextValid) {
                console.warn('Extension context invalidated - recording disabled');
                extensionContextValid = false;
            }
            return false;
        }
    };

    // Clean up any existing event listeners
    const cleanup = () => {
        if (mousedownProcessingTimer) {
            clearTimeout(mousedownProcessingTimer);
            mousedownProcessingTimer = null;
        }
        pendingMousedownEvent = null;
        extensionContextValid = false;
    };

    // Clean up on page unload
    window.addEventListener('beforeunload', cleanup);

    // Click event listener - has priority
    const clickHandler = function(event)
    {
        // Clear any pending mousedown event
        if (mousedownProcessingTimer) {
            clearTimeout(mousedownProcessingTimer);
            mousedownProcessingTimer = null;
            pendingMousedownEvent = null;
        }
        
        const dpr = window.devicePixelRatio || 1; // Device Pixel Ratio

        safeSendMessage({
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
        }, 'tests-recorder-click-event sent to processing script ' + event.target);
    };

    document.addEventListener('click', clickHandler, true);

    // Mousedown event listener - used as fallback
    const mousedownHandler = function(event)
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
                safeSendMessage(pendingMousedownEvent, 'tests-recorder-mousedown-event sent to processing script (as fallback) ' + event.target);
                pendingMousedownEvent = null;
            }
            mousedownProcessingTimer = null;
        }, CLICK_PRIORITY_DELAY);
    };

    document.addEventListener('mousedown', mousedownHandler, true);

    const keypressHandler = function(event)
    {
        safeSendMessage({
            action: "tests-recorder-keypress-event",
            key: event.key,
            timestamp: performance.now()
        }, 'tests-recorder-keypress-event sent to processing script');
    };

    document.addEventListener('keypress', keypressHandler);

    // Listen for ping messages from background script to check if tab is responsive
    try {
        if (chrome.runtime && chrome.runtime.onMessage) {
            chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                if (message.action === "ping") {
                    sendResponse({ status: "ok" });
                }
            });
        }
    } catch (error) {
        console.warn('Extension context invalidated, message listener not registered:', error);
    }

    const keydownHandler = function(event)
    {
        if (event.altKey && event.shiftKey && event.code === "KeyW")
        {
            createOverlay();

            event.preventDefault();
        }
    };

    document.addEventListener('keydown', keydownHandler);

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

                safeSendMessage({
                    action: "tests-recorder-area-select-event",
                    rect:
                    {
                        top: Math.min(thoth_waitScreenshotStartY, event.clientY),
                        bottom: Math.max(thoth_waitScreenshotStartY, event.clientY),
                        left: Math.min(thoth_waitScreenshotStartX, event.clientX),
                        right: Math.max(thoth_waitScreenshotStartX, event.clientX)
                    }
                }, 'tests-recorder-area-select-event sent to processing script');
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

} // End of duplicate script prevention