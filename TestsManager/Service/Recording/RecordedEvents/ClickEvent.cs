namespace Service.Recording.RecordedEvents
{
    public class ClickEvent : IEvent
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public DateTime Timestamp { get; set; } = DateTime.Now;

        public required int X { get; set; }
        public required int Y { get; set; }

        public required string ClickViewFilepath { get; set; }

        public IEvent Clone()
        {
            return new ClickEvent { Id = Id, Timestamp = Timestamp, X = X, Y = Y, ClickViewFilepath = ClickViewFilepath };
        }
    }
}
