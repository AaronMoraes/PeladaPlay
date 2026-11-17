using PeladaPlay.Domain.Enums;

namespace PeladaPlay.Domain.Entities;

public class Club
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public string InviteCode { get; set; } = Guid.NewGuid().ToString("N")[..8].ToUpper();
    public DayOfWeek DayOfWeek { get; set; }
    public TimeSpan StartTime { get; set; }
    public TimeSpan Duration { get; set; } = TimeSpan.FromMinutes(90);
    public int ExpectedPlayers { get; set; } = 15;
    public int PlayersPerTeam { get; set; } = 5;
    public bool GoalkeepersPay { get; set; } = true;
    public decimal CashReserve { get; set; } = 0m; // Caixa do clube (excedentes de vagas extras)

    public Guid? DefaultVenueId { get; set; }
    public Venue? DefaultVenue { get; set; }

    public ICollection<ClubMember> Members { get; set; } = new List<ClubMember>();
    public ICollection<Match> Matches { get; set; } = new List<Match>();
}

public class ClubMember
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ClubId { get; set; }
    public Club Club { get; set; } = null!;

    public Guid UserId { get; set; }
    public User User { get; set; } = null!;

    // Papel e Rank isolados exclusivamente dentro deste clube
    public ClubRole Role { get; set; } = ClubRole.Player;
    public int SkillRank { get; set; } = 3; // 1 a 5 estrelas
    public bool IsGoalkeeper { get; set; } = false;
    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
}