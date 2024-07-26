namespace Service.Recording.RecordedEvents
{
    public class AreaSelectEvent : IEvent
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public DateTime Timestamp { get; set; } = DateTime.Now;

        public required int Top { get; set; }
        public required int Bottom { get; set; }
        public required int Left { get; set; }
        public required int Right { get; set; }

        public required string AreaSelectViewFilepath { get; set; }

        public IEvent Clone()
        {
            return new AreaSelectEvent { Id = Id, Timestamp = Timestamp, Top = Top, Bottom = Bottom, Left = Left, Right = Right, AreaSelectViewFilepath = AreaSelectViewFilepath };
        }
    }
}
