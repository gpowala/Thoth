namespace Service.Recording
{
    public interface IRecordingService
    {
        RecordingSession CreateSession();
        void RemoveSession(RecordingSession session);

        void StartSession(System.Guid guid);
        void StopSession(System.Guid guid);

        void RegisterClickEvent(System.Guid guid, int x, int y, MemoryStream clickViewStream);
        void RegisterKeypressEvent(System.Guid guid, string key);
        void RegisterAreaSelectEvent(System.Guid guid, int top, int bottom, int left, int rght, MemoryStream areaSelectViewStream);
    }
}
