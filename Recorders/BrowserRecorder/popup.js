const showPopupLoading = () =>
{
    $("#startRecordingBtn").prop( "disabled", true );
    $("#startRecordingBtn").hide();
    $("#stopRecordingBtn").prop( "disabled", true );
    $("#stopRecordingBtn").hide();

    $("#loadingSessionInfoLabel").show();
    $("#recordingLabel").hide();
    $("#recordingStartLabel").hide();
    $("#recordingStopLabel").hide();

    $("#serverUrlInput").prop( "disabled", true );
    $("#sessionIdInput").prop( "disabled", true );
    $("#serverUrlInput").val("");
    $("#sessionIdInput").val("");
};

const showBeforeRecordingStarted = (serverUrl, sessionId) =>
{
    $("#startRecordingBtn").prop( "disabled", true );
    $("#startRecordingBtn").show();
    $("#stopRecordingBtn").prop( "disabled", true );
    $("#stopRecordingBtn").hide();

    $("#loadingSessionInfoLabel").hide();
    $("#recordingLabel").hide();
    $("#recordingStartLabel").show();
    $("#recordingStopLabel").hide();

    $("#serverUrlInput").prop( "disabled", true );
    $("#sessionIdInput").prop( "disabled", true );
    $("#serverUrlInput").val(serverUrl);
    $("#sessionIdInput").val(sessionId);
}

const showPopupRecordingOn = (serverUrl, sessionId) =>
{
    $("#startRecordingBtn").prop( "disabled", true );
    $("#startRecordingBtn").hide();
    $("#stopRecordingBtn").prop( "disabled", false );
    $("#stopRecordingBtn").show();

    $("#loadingSessionInfoLabel").hide();
    $("#recordingLabel").show();
    $("#recordingStartLabel").hide();
    $("#recordingStopLabel").hide();

    $("#serverUrlInput").prop( "disabled", true );
    $("#sessionIdInput").prop( "disabled", true );
    $("#serverUrlInput").val(serverUrl);
    $("#sessionIdInput").val(sessionId);
}

const showBeforeRecordingStopped = (serverUrl, sessionId) =>
{
    $("#startRecordingBtn").prop( "disabled", true );
    $("#startRecordingBtn").hide();
    $("#stopRecordingBtn").prop( "disabled", true );
    $("#stopRecordingBtn").show();

    $("#loadingSessionInfoLabel").hide();
    $("#recordingLabel").hide();
    $("#recordingStartLabel").hide();
    $("#recordingStopLabel").show();

    $("#serverUrlInput").prop( "disabled", true );
    $("#sessionIdInput").prop( "disabled", true );
    $("#serverUrlInput").val(serverUrl);
    $("#sessionIdInput").val(sessionId);
}

const showPopupRecordingOff = (serverUrl, sessionId) =>
{
    $("#startRecordingBtn").prop( "disabled", false );
    $("#startRecordingBtn").show();
    $("#stopRecordingBtn").prop( "disabled", true );
    $("#stopRecordingBtn").hide();

    $("#loadingSessionInfoLabel").hide();
    $("#recordingLabel").hide();
    $("#recordingStartLabel").hide();
    $("#recordingStopLabel").hide();

    $("#serverUrlInput").prop( "disabled", false );
    $("#sessionIdInput").prop( "disabled", false );
    $("#serverUrlInput").val(serverUrl);
    $("#sessionIdInput").val(sessionId);
}

$(document).ready(() =>
{
    showPopupLoading();
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => 
    {
        if (tabs.length !== 0)
        {
            const activeTab = tabs[0];
            chrome.tabs.sendMessage(activeTab.id, { action: "thot-tests-recorder-get-recording-status" }, (response) =>
            {
                if (!chrome.runtime.lastError)
                {
                    response.isRecording === true
                    ? showPopupRecordingOn(response.serverUrl, respone.sessionId)
                    : showPopupRecordingOff(response.serverUrl, respone.sessionId) 
                }
                else
                {
                    showPopupRecordingOff("", "");
                    console.error('Thot[popup.js] >>', chrome.runtime.lastError);
                }
            });
        }
        else
        {
            showPopupRecordingOff("", "");
            console.error('Thot[popup.js] >> No active tab found.');
        }
        
    });

    // $("#serverUrlInput").val(localStorage.getItem("tests-recorder-server-url"));
    // $("#sessionIdInput").val(localStorage.getItem("tests-recorder-session-id"));
});

$("#startRecordingBtn").click(() => {
    let serverUrl = $("#serverUrlInput").val();
    let sessionId = $("#sessionIdInput").val();

    showBeforeRecordingStarted(serverUrl, sessionId);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => 
    {
        if (tabs.length !== 0)
        {
            const activeTab = tabs[0];
            chrome.runtime.sendMessage(
                activeTab.id,
                {
                    action: "thot-tests-recorder-start-recording",
                    serverUrl: $("#serverUrlInput").val(),
                    sessionId: $("#sessionIdInput").val()
                },
                (response) =>
                {
                    if (!chrome.runtime.lastError)
                    {
                        response.isRecording === true
                        ? showPopupRecordingOn(response.serverUrl, respone.sessionId)
                        : showPopupRecordingOff(response.serverUrl, respone.sessionId) 
                    }
                    else
                    {
                        showPopupRecordingOff("", "");
                        console.error('Thot[popup.js] >>', chrome.runtime.lastError);
                    }
                }
            );
        }
        else
        {
            showPopupRecordingOff("", "");
            console.error('Thot[popup.js] >> No active tab found.');
        }
    });
});

$("#stopRecordingBtn").click(() => {
    let serverUrl = $("#serverUrlInput").val();
    let sessionId = $("#sessionIdInput").val();

    showBeforeRecordingStopped(serverUrl, sessionId);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => 
    {
        if (tabs.length !== 0)
        {
            const activeTab = tabs[0];
            chrome.runtime.sendMessage(
                activeTab.id,
                {
                    action: "thot-tests-recorder-stop-recording",
                    serverUrl: $("#serverUrlInput").val(),
                    sessionId: $("#sessionIdInput").val()
                },
                (response) =>
                {
                    if (!chrome.runtime.lastError)
                    {
                        response.isRecording === true
                        ? showPopupRecordingOn(response.serverUrl, respone.sessionId)
                        : showPopupRecordingOff(response.serverUrl, respone.sessionId) 
                    }
                    else
                    {
                        showPopupRecordingOn("", "");
                        console.error('Thot[popup.js] >>', chrome.runtime.lastError);
                    }
                }
            );
        }
        else
        {
            showPopupRecordingOn("", "");
            console.error('Thot[popup.js] >> No active tab found.');
        }
    });
});