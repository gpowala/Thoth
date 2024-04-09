namespace Service.BrowserAgentCommunication
{
    public class WebServerConnectionParameters
    {
        public string Server { get; set; } = "localhost";
        public string Port { get; set; } = "4444";

        public string BuldHttpListenerPrefix()
        {
            return $"http://{Server}:{Port}/";
        }
    }
}
