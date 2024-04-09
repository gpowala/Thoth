namespace Service.BrowserAgentCommunication
{
    using System;
    using System.Net;
    using System.Net.WebSockets;
    using System.Threading;
    using System.Threading.Tasks;

    public class WebSocketServer
    {
        public bool ServerRunning { get; private set; } = false;

        public async Task StartAsync(WebServerConnectionParameters connectionParameters, CancellationToken cancellationToken)
        {
            using var listener = new HttpListener();

            var prefix = connectionParameters.BuldHttpListenerPrefix();
            listener.Prefixes.Add(prefix);

            listener.Start();

            Console.WriteLine($"WebSocket server started on {prefix}");

            ServerRunning = true;

            while (!cancellationToken.IsCancellationRequested)
            {
                var context = await listener.GetContextAsync();
                if (context.Request.IsWebSocketRequest)
                {
                    await ProcessWebSocketRequestAsync(context);
                }
                else
                {
                    context.Response.StatusCode = 400;
                    context.Response.Close();
                }
            }

            listener.Stop();
            listener.Close();

            ServerRunning = false;
        }

        private async Task ProcessWebSocketRequestAsync(HttpListenerContext context)
        {
            var webSocketContext = await context.AcceptWebSocketAsync(null);
            var webSocket = webSocketContext.WebSocket;

            // Handle WebSocket communication here
        }
    }
}
