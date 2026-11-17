using PeladaPlay.Domain.Enums;

namespace PeladaPlay.Api.DTOs;

public record CreateVenueRequest(string Name, string Address, decimal? DefaultPrice);

public record CreateClubRequest(
    string Name,
    DayOfWeek DayOfWeek,
    string StartTime,        // Ex: "20:00"
    int DurationMinutes,     // Ex: 90
    int ExpectedPlayers,     // Ex: 15
    int PlayersPerTeam,      // Ex: 5
    bool GoalkeepersPay,
    Guid? DefaultVenueId,
    bool CreatorIsGoalkeeper = false
);

public record UpdateMemberRoleRequest(ClubRole Role);

public record UpdateMemberRankRequest(int SkillRank, bool IsGoalkeeper);