namespace Service.Recording.RecordedEvents
{
    public class ClickEvent : IEvent
    {
        public DateTime Timestamp { get; } = DateTime.Now;

        public required int X { get; init; }
        public required int Y { get; init; }
        public required string ClickViewFilepath { get; init; }
    }
}
