namespace Service.Recording.RecordedEvents
{
    public class KeypressEvent : IEvent
    {
        public Guid Id {  get; set; } = Guid.NewGuid();
        public DateTime Timestamp { get; set; } = DateTime.Now;

        public required string Keys { get; set; }


        public IEvent Clone()
        {
            return new KeypressEvent { Id = Id, Timestamp = Timestamp, Keys = Keys };
        }
    }
}
