namespace PeladaPlay.Domain.Entities;

public class Venue
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public string Address { get; set; } = string.Empty;
    public decimal? DefaultPrice { get; set; } // Null quando for "Sob consulta"
}