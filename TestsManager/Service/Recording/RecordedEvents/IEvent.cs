namespace Service.Recording.RecordedEvents
{
    public interface IEvent
    {
        public Guid Id { get; set; }
        public DateTime Timestamp { get; set; }

        public IEvent Clone();
    }
}
