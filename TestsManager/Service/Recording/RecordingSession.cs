using System.Diagnostics;

using System;
using System.Drawing;
using System.IO;

namespace Service.Recording
{
    public class RecordingSession
    {
        public System.Guid Guid { get; } = System.Guid.NewGuid();

        public bool IsRecording { get; private set; } = false;

        public string SessionDirectory { get; private set; } = "";

        public event EventHandler? SessionStateChanged;

        private List<RecordedEvents.IEvent> _recordedEvents = new();
        private static object _eventsRecordLock = new();

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
            return _recordedEvents.Select(e => e.Clone()).ToList();
        }

        public void RegisterClickEvent(int x, int y, MemoryStream clickViewStream)
        {
            lock (_eventsRecordLock)
            {
                var clickViewFilepath = $"{SessionDirectory}/{_recordedEvents.Count}-full.png";

                using (var fileStream = File.OpenWrite(clickViewFilepath))
                {
                    clickViewStream.Position = 0;
                    clickViewStream.CopyTo(fileStream);

                    _recordedEvents.Add(new RecordedEvents.ClickEvent
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
            lock (_eventsRecordLock)
            {
                var areaSelectViewFilepath = $"{SessionDirectory}/{_recordedEvents.Count}-area-select.png";

                var image = Image.FromStream(areaSelectViewStream);

                using (var fileStream = File.OpenWrite(areaSelectViewFilepath))
                {
                    areaSelectViewStream.Position = 0;
                    areaSelectViewStream.CopyTo(fileStream);

                    _recordedEvents.Add(new RecordedEvents.AreaSelectEvent
                    {
                        Top = top,
                        Bottom = bottom,
                        Left = left,
                        Right = right,
                        AreaSelectViewFilepath = areaSelectViewFilepath
                    });
                }
            }

            InvokeSessionStatusChanged();
        }

        public void RegisterKeypressEvent(string key)
        {
            lock (_eventsRecordLock)
            {
                var lastRecorderEvent = _recordedEvents.Last();

                if (lastRecorderEvent != null && lastRecorderEvent is RecordedEvents.KeypressEvent)
                {
                    var continuedKeypressEvent = lastRecorderEvent as RecordedEvents.KeypressEvent;
                    Debug.Assert(continuedKeypressEvent != null);

                    continuedKeypressEvent.Keys = continuedKeypressEvent.Keys + key;
                }
                else
                {
                    _recordedEvents.Add(new RecordedEvents.KeypressEvent
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
    }
}
