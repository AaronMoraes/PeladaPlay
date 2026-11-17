namespace PeladaPlay.Api.DTOs;

public class CreateClubDto
{
    public string Name { get; set; } = string.Empty;
    public Guid? DefaultVenueId { get; set; }
    public int DefaultDayOfWeek { get; set; }
    public string DefaultTime { get; set; } = "20:00:00";
    public int ExpectedPlayers { get; set; } = 14;
    public int PlayersPerTeam { get; set; } = 5;
    public bool GoalkeepersPay { get; set; } = true;
}

public class UpdateClubDto : CreateClubDto { }

public class JoinClubDto
{
    public string InviteCode { get; set; } = string.Empty;
}

public class CashReserveDto
{
    public decimal Amount { get; set; }
    public string Reason { get; set; } = string.Empty;
}