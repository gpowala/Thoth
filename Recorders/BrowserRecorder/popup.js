$(document).ready(() => {
    if(localStorage.getItem("tests-recorder-is-recording") === "true") {
        $("#startRecordingBtn").prop( "disabled", true );
        $("#recordingStartLabel").show();
        $("#recordingStartLabel").hide();
        $("#startRecordingBtn").hide();
        $("#stopRecordingBtn").prop( "disabled", false );
        $("#stopRecordingBtn").show();
        $("#sessionUrlInput").prop( "disabled", true );
    } else {
        $("#stopRecordingBtn").prop( "disabled", true );
        $("#recordingStopLabel").show();
        $("#recordingStopLabel").hide();
        $("#stopRecordingBtn").hide();
        $("#startRecordingBtn").prop( "disabled", false );
        $("#startRecordingBtn").show();
        $("#sessionUrlInput").prop( "disabled", false );
    }

    $("#sessionUrlInput").val(localStorage.getItem("tests-recorder-server-url"));
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

    localStorage.setItem("tests-recorder-server-url", $("#sessionUrlInput").val());
    localStorage.setItem("tests-recorder-is-recording", "true");
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

    localStorage.setItem("tests-recorder-is-recording", "false");
});

// $("#sessionUrlInput").on("input", function() {
//     localStorage.setItem("tests-recorder-server-url", $("#sessionUrlInput").val());
// });