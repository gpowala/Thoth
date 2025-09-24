$(document).ready(() => {
    // Get the current recording state from the background script
    chrome.storage.local.get(['isRecording', 'serverUrl'], function(result) {
        if(result.isRecording === true) {
            $("#startRecordingBtn").prop( "disabled", true );
            $("#recordingStartLabel").show();
            $("#recordingStopLabel").hide();
            $("#startRecordingBtn").hide();
            $("#stopRecordingBtn").prop( "disabled", false );
            $("#stopRecordingBtn").show();
            $("#sessionUrlInput").prop( "disabled", true );
        } else {
            $("#stopRecordingBtn").prop( "disabled", true );
            $("#recordingStopLabel").show();
            $("#recordingStartLabel").hide();
            $("#stopRecordingBtn").hide();
            $("#startRecordingBtn").prop( "disabled", false );
            $("#startRecordingBtn").show();
            $("#sessionUrlInput").prop( "disabled", false );
        }

        $("#sessionUrlInput").val(result.serverUrl || '');
    });
});

$("#startRecordingBtn").click(() => {
    $("#startRecordingBtn").prop( "disabled", true );
    $("#recordingStartLabel").show();

    chrome.runtime.sendMessage({
        action: "tests-recorder-start-recording",
        serverUrl: $("#sessionUrlInput").val()
    });

    $("#recordingStartLabel").hide();
    $("#startRecordingBtn").hide();

    $("#stopRecordingBtn").prop( "disabled", false );
    $("#stopRecordingBtn").show();

    $("#sessionUrlInput").prop( "disabled", true );

    // Store in chrome.storage.local to sync with background script
    chrome.storage.local.set({
        'serverUrl': $("#sessionUrlInput").val(),
        'isRecording': true
    });
});

$("#stopRecordingBtn").click(() => {
    $("#stopRecordingBtn").prop( "disabled", true );
    $("#recordingStopLabel").show();

    chrome.runtime.sendMessage({action: "tests-recorder-stop-recording"});
    
    $("#recordingStopLabel").hide();
    $("#stopRecordingBtn").hide();
    
    $("#startRecordingBtn").prop( "disabled", false );
    $("#startRecordingBtn").show();

    $("#sessionUrlInput").prop( "disabled", false );

    // Store in chrome.storage.local to sync with background script
    chrome.storage.local.set({
        'isRecording': false
    });
});

// Listen for storage changes to update UI state
chrome.storage.onChanged.addListener(function(changes, namespace) {
    if (namespace === 'local') {
        if (changes.isRecording) {
            if (changes.isRecording.newValue === true) {
                $("#startRecordingBtn").prop( "disabled", true );
                $("#recordingStartLabel").show();
                $("#recordingStopLabel").hide();
                $("#startRecordingBtn").hide();
                $("#stopRecordingBtn").prop( "disabled", false );
                $("#stopRecordingBtn").show();
                $("#sessionUrlInput").prop( "disabled", true );
            } else {
                $("#stopRecordingBtn").prop( "disabled", true );
                $("#recordingStopLabel").show();
                $("#recordingStartLabel").hide();
                $("#stopRecordingBtn").hide();
                $("#startRecordingBtn").prop( "disabled", false );
                $("#startRecordingBtn").show();
                $("#sessionUrlInput").prop( "disabled", false );
            }
        }
        
        if (changes.serverUrl) {
            $("#sessionUrlInput").val(changes.serverUrl.newValue || '');
        }
    }
});

// Reset button functionality
$("#resetStateBtn").click(() => {
    chrome.runtime.sendMessage({action: "tests-recorder-reset-state"}, function(response) {
        if (response && response.success) {
            console.log('Recording state reset successfully');
            // Update UI to reflect reset state
            $("#stopRecordingBtn").prop( "disabled", true );
            $("#recordingStopLabel").show();
            $("#recordingStartLabel").hide();
            $("#stopRecordingBtn").hide();
            $("#startRecordingBtn").prop( "disabled", false );
            $("#startRecordingBtn").show();
            $("#sessionUrlInput").prop( "disabled", false );
        }
    });
});

// Test content script button functionality
$("#testContentScriptBtn").click(() => {
    chrome.runtime.sendMessage({action: "tests-recorder-test-content-script"}, function(response) {
        if (response) {
            console.log('Content script test result:', response.message);
            // You could show this message to the user if needed
            alert(response.message);
        }
    });
});

// $("#sessionUrlInput").on("input", function() {
//     localStorage.setItem("tests-recorder-server-url", $("#sessionUrlInput").val());
// });