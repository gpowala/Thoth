using System.Diagnostics;

namespace Service.BrowserAgentCommunication
{
    public class WebSocketService
    {
        private WebSocketServer? _webSocketServer = null;
        private CancellationTokenSource? _cancellationTokenSource = null;

        public async Task StartWebSocketServerAsync(WebServerConnectionParameters connectionParameters)
        {
            RecreateCancellationTokenSource(ref _cancellationTokenSource);
            RecreateWebSocketServer(ref _webSocketServer);

            Debug.Assert(_cancellationTokenSource != null);
            Debug.Assert(_webSocketServer != null);

            await _webSocketServer.StartAsync(connectionParameters, _cancellationTokenSource.Token);
        }

        public void StopWebSocketServer()
        {
            _cancellationTokenSource?.Cancel();
        }

        public bool IsServerRunning()
        {
            return _webSocketServer?.ServerRunning ?? false;
        }

        private void RecreateCancellationTokenSource(ref CancellationTokenSource? cancellationTokenSource)
        {
            if (cancellationTokenSource?.IsCancellationRequested ?? false)
            {
                cancellationTokenSource.Dispose();
            }

            cancellationTokenSource = new CancellationTokenSource();
        }

        private void RecreateWebSocketServer(ref WebSocketServer? webSocketServer)
        {
            webSocketServer = new WebSocketServer();
        }
    }
}
