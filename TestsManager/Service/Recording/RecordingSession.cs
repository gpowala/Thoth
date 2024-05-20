namespace Service.Recording
{
    public class RecordingSession
    {
        public System.Guid Guid { get; } = System.Guid.NewGuid();

        public bool IsRecording { get; private set; } = false;

        public string SessionDirectory { get; private set; } = "";

        public List<RecordedEvents.IEvent> RecordedEvents { get; } = new();

        public event EventHandler? SessionStateChanged;

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

        public void RegisterClickEvent(int x, int y, MemoryStream clickViewStream)
        {
            var clickViewFilepath = $"{SessionDirectory}/{RecordedEvents.Count}-full.png";

            using (var fileStream = File.OpenWrite(clickViewFilepath))
            {
                clickViewStream.Position = 0;
                clickViewStream.CopyTo(fileStream);

                RecordedEvents.Add(new RecordedEvents.ClickEvent
                {
                    X = x,
                    Y = y,
                    ClickViewFilepath = clickViewFilepath
                });
            }

            InvokeSessionStatusChanged();
        }

        public void RegisterKeypressEvent(string key)
        {
            RecordedEvents.Add(new RecordedEvents.KeypressEvent
            {
                Key = key
            });

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
    }
}
