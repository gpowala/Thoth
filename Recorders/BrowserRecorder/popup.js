$(document).ready(() => {
    // Get the current recording state from the background script
    chrome.storage.local.get(['isRecording', 'serverUrl'], function(result) {
        updateUI(result.isRecording === true);
        $("#sessionUrlInput").val(result.serverUrl || '');
    });
});

function showError(message) {
    $("#errorLabel").text(message || '').prop("hidden", !message);
}

function updateUI(isRecording) {
    if (isRecording) {
        $("#startRecordingBtn").hide();
        $("#stopRecordingBtn").show();
        $("#sessionUrlInput").prop("disabled", true);
        $("#sessionUrlContainer").addClass("disabled");
        $("#statusPill").addClass("recording");
        $("#statusLabel").text("Recording");
    } else {
        $("#stopRecordingBtn").hide();
        $("#startRecordingBtn").show();
        $("#sessionUrlInput").prop("disabled", false);
        $("#sessionUrlContainer").removeClass("disabled");
        $("#statusPill").removeClass("recording");
        $("#statusLabel").text("Idle");
    }
}

$("#startRecordingBtn").click(() => {
    const sessionUrl = $("#sessionUrlInput").val().trim();

    if (!sessionUrl) {
        showError("Please enter a session URL");
        return;
    }

    showError("");

    chrome.runtime.sendMessage({
        action: "tests-recorder-start-recording",
        serverUrl: sessionUrl
    });

    // Store in chrome.storage.local to sync with background script
    chrome.storage.local.set({
        'serverUrl': sessionUrl,
        'isRecording': true
    });

    updateUI(true);
});

$("#stopRecordingBtn").click(() => {
    chrome.runtime.sendMessage({action: "tests-recorder-stop-recording"});

    // Store in chrome.storage.local to sync with background script
    chrome.storage.local.set({
        'isRecording': false
    });

    updateUI(false);
});

// Listen for storage changes to update UI state
chrome.storage.onChanged.addListener(function(changes, namespace) {
    if (namespace === 'local') {
        if (changes.isRecording) {
            updateUI(changes.isRecording.newValue === true);
        }

        if (changes.serverUrl) {
            $("#sessionUrlInput").val(changes.serverUrl.newValue || '');
        }
    }
});
