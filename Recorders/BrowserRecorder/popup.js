$(document).ready(() => {
    if(localStorage.getItem("tests-recorder-is-recording") === "true") {
        $("#startRecordingBtn").prop( "disabled", true );
        $("#recordingStartLabel").show();
        $("#recordingStartLabel").hide();
        $("#startRecordingBtn").hide();
        $("#stopRecordingBtn").prop( "disabled", false );
        $("#stopRecordingBtn").show();
        $("#serverUrlInput").prop( "disabled", true );
        $("#sessionIdInput").prop( "disabled", true );
    } else {
        $("#stopRecordingBtn").prop( "disabled", true );
        $("#recordingStopLabel").show();
        $("#recordingStopLabel").hide();
        $("#stopRecordingBtn").hide();
        $("#startRecordingBtn").prop( "disabled", false );
        $("#startRecordingBtn").show();
        $("#serverUrlInput").prop( "disabled", false );
        $("#sessionIdInput").prop( "disabled", false );
    }

    $("#serverUrlInput").val(localStorage.getItem("tests-recorder-server-url"));
    $("#sessionIdInput").val(localStorage.getItem("tests-recorder-session-id"));
});

$("#startRecordingBtn").click(() => {
    $("#startRecordingBtn").prop( "disabled", true );
    $("#recordingStartLabel").show();

    chrome.runtime.sendMessage({
        action: "tests-recorder-start-recording",
        serverUrl: $("#serverUrlInput").val(),
        sessionId: $("#sessionIdInput").val()
    });

    $("#recordingStartLabel").hide();
    $("#startRecordingBtn").hide();

    $("#stopRecordingBtn").prop( "disabled", false );
    $("#stopRecordingBtn").show();

    $("#serverUrlInput").prop( "disabled", true );
    $("#sessionIdInput").prop( "disabled", true );

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

    $("#serverUrlInput").prop( "disabled", false );
    $("#sessionIdInput").prop( "disabled", false );

    localStorage.setItem("tests-recorder-is-recording", "false");
});

$("#serverUrlInput").on("input", function() {
    localStorage.setItem("tests-recorder-server-url", $("#serverUrlInput").val());
});

$("#sessionIdInput").on("input", function() {
    localStorage.setItem("tests-recorder-session-id", $("#sessionIdInput").val());
 });