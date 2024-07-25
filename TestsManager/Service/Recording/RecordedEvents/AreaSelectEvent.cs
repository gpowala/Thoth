namespace Service.Recording.RecordedEvents
{
    public class AreaSelectEvent : IEvent
    {
        public DateTime Timestamp { get; } = DateTime.Now;

        public required int Top { get; init; }
        public required int Bottom { get; init; }
        public required int Left { get; init; }
        public required int Right { get; init; }
        public required string AreaSelectViewFilepath { get; init; }
    }
}
