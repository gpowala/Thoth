namespace Service.Recording.RecordedEvents
{
    public class KeypressEvent : IEvent
    {
        public DateTime Timestamp { get; } = DateTime.Now;

        public required string Key { get; init; }
    }
}
