using PeladaPlay.Domain.Enums;

namespace PeladaPlay.Domain.Entities;

public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string FullName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string? PhotoUrl { get; set; }
    public string Position { get; set; } = "Meia";
    public PreferredFoot PreferredFoot { get; set; } = PreferredFoot.Right;
    public int ShirtNumber { get; set; } = 10;
    public string? City { get; set; }
    public string? Phone { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<ClubMember> Memberships { get; set; } = new List<ClubMember>();
}