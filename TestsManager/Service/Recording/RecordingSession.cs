using System.Diagnostics;

using System.Drawing;

namespace Service.Recording
{
    public class RecordingSession
    {
        public System.Guid Guid { get; } = System.Guid.NewGuid();

        public bool IsRecording { get; private set; } = false;

        public string SessionDirectory { get; private set; } = "";

        public event EventHandler? SessionStateChanged;

        private List<RecordedEvents.IEvent> recordedEvents_ = new();
        private static object eventsRecordLock_ = new();

        private readonly IHttpContextAccessor httpContextAccessor_;

        public RecordingSession(IHttpContextAccessor httpContextAccessor)
        {
            httpContextAccessor_ = httpContextAccessor;
        }

        public string GetConnectionString()
        {
            var httpContext = httpContextAccessor_.HttpContext;

            if (httpContext != null)
            {
                var request = httpContext.Request;
                var host = request.Host;
                var scheme = request.Scheme;

                string address = $"{scheme}://{host.Host}";
                string port = host.Port.HasValue ? host.Port.Value.ToString() : "";

                return $"{address}:{port}/recording/start/{Guid}";
            }
            else
            {
                throw new Exception("Failed to access http context.");
            }
        }

        public void Start()
        {
            SessionDirectory = CreateSessionDirectoryIfNotExists();
            IsRecording = true;

            InvokeSessionStatusChanged();
        }

        public void Stop()
        {
            IsRecording = false;

            InvokeSessionStatusChanged();
        }

        public List<RecordedEvents.IEvent> GetRecordedEvents()
        {
            return recordedEvents_.Select(e => e.Clone()).ToList();
        }

        public void RegisterClickEvent(int x, int y, MemoryStream clickViewStream)
        {
            lock (eventsRecordLock_)
            {
                var clickViewFilepath = $"{SessionDirectory}/{recordedEvents_.Count}-full.png";

                using (var fileStream = File.OpenWrite(clickViewFilepath))
                {
                    clickViewStream.Position = 0;
                    clickViewStream.CopyTo(fileStream);

                    recordedEvents_.Add(new RecordedEvents.ClickEvent
                    {
                        X = x,
                        Y = y,
                        ClickViewFilepath = clickViewFilepath
                    });
                }
            }

            InvokeSessionStatusChanged();
        }

        public void RegisterAreaSelectEvent(int top, int bottom, int left, int right, MemoryStream areaSelectViewStream)
        {
            lock (eventsRecordLock_)
            {
                var areaSelectViewFilepath = $"{SessionDirectory}/{recordedEvents_.Count}-area-select.png";

                TrimViewStream(areaSelectViewStream, new Rectangle(top, left, right - left, bottom - top)).Save(areaSelectViewFilepath);

                recordedEvents_.Add(new RecordedEvents.AreaSelectEvent
                {
                    Top = top,
                    Bottom = bottom,
                    Left = left,
                    Right = right,
                    AreaSelectViewFilepath = areaSelectViewFilepath
                });
            }

            InvokeSessionStatusChanged();
        }

        public void RegisterKeypressEvent(string key)
        {
            lock (eventsRecordLock_)
            {
                var lastRecorderEvent = recordedEvents_.Last();

                if (lastRecorderEvent != null && lastRecorderEvent is RecordedEvents.KeypressEvent)
                {
                    var continuedKeypressEvent = lastRecorderEvent as RecordedEvents.KeypressEvent;
                    Debug.Assert(continuedKeypressEvent != null);

                    continuedKeypressEvent.Keys = continuedKeypressEvent.Keys + key;
                }
                else
                {
                    recordedEvents_.Add(new RecordedEvents.KeypressEvent
                    {
                        Keys = key
                    });
                }
            }

            InvokeSessionStatusChanged();
        }

        private void InvokeSessionStatusChanged()
        {
            SessionStateChanged?.Invoke(this, EventArgs.Empty);
        }

        private string CreateSessionDirectoryIfNotExists()
        {
            var sessionDirectory = $"C:/tests/screenshots/{Guid}";

            if (!Directory.Exists(sessionDirectory))
            {
                Directory.CreateDirectory(sessionDirectory);
            }

            return sessionDirectory;
        }

        private Bitmap TrimViewStream(MemoryStream viewStream, Rectangle trimmingRect)
        {
            var sourceImage = Image.FromStream(viewStream);
            var destImage = new Bitmap(trimmingRect.Width, trimmingRect.Height);

            using (Graphics g = Graphics.FromImage(destImage))
            {
                g.DrawImage(sourceImage, new Rectangle(0, 0, destImage.Width, destImage.Height), trimmingRect, GraphicsUnit.Pixel);
            }

            return destImage;
        }
    }
}
