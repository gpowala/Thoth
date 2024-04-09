//using Microsoft.AspNetCore.SignalR;
//using System.Collections;

//namespace Service.BrowserAgentCommunication;

//public class DataExchangeHub : Hub
//{
//    public async Task SendImage(string sessionGuid, byte[] imageData)
//    {
//        string tempFilePath = CreateTempFilePath();

//        using var stream = File.OpenWrite(tempFilePath);
//        stream.Write(imageData, 0, imageData.Length);

//        await Clients.All.SendAsync("ReceivedImage");
//    }

//    private string CreateTempFilePath()
//    {
//        var filename = $"{Guid.NewGuid()}.png";
//        var directoryPath = "C:/tests/screenshots";

//        if (!Directory.Exists(directoryPath))
//            Directory.CreateDirectory(directoryPath);

//        return Path.Combine(directoryPath, filename);
//    }
//}
