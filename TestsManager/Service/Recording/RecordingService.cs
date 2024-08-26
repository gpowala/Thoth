namespace Service.Recording
{
    public class RecordingService : IRecordingService
    {
        public RecordingService(IHttpContextAccessor httpContextAccessor)
        {
            httpContextAccessor_ = httpContextAccessor;
        }

        public RecordingSession CreateSession()
        {
            var session = new RecordingSession(httpContextAccessor_);

            sessions_.Add(session.Guid, session);

            return session;
        }

        public void RemoveSession(RecordingSession session)
        {
            sessions_.Remove(session.Guid);
        }

        public void StartSession(System.Guid guid)
        {
            sessions_[guid].Start();
        }

        public void StopSession(System.Guid guid)
        {
            sessions_[guid].Stop();
        }

        public bool IsActive(Guid guid)
        {
            return sessions_.ContainsKey(guid);
        }

        public void RegisterClickEvent(System.Guid guid, int x, int y, MemoryStream clickViewStream)
        {
            sessions_[guid].RegisterClickEvent(x, y, clickViewStream);
        }

        public void RegisterKeypressEvent(System.Guid guid, string key)
        {
            sessions_[guid].RegisterKeypressEvent(key);
        }

        public void RegisterAreaSelectEvent(Guid guid, int top, int bottom, int left, int right, MemoryStream areaSelectViewStream)
        {
            sessions_[guid].RegisterAreaSelectEvent(top, bottom, left, right, areaSelectViewStream);
        }

        private Dictionary<System.Guid, RecordingSession> sessions_ = new();
        private readonly IHttpContextAccessor httpContextAccessor_;
    }
}
