using PeladaPlay.Domain.Enums;

namespace PeladaPlay.Api.DTOs;

public record CreateMatchRequest(
    Guid ClubId,
    DateTime MatchDateTime,
    decimal CourtCost,
    string? PixReceiverName,
    string? PixKey
);

public record UpdateMatchPixRequest(
    string? PixReceiverName,
    string? PixKey
);

public record JoinMatchRequest(
    bool IsGoalkeeper = false
);

public record AddGuestRequest(
    string GuestName,
    bool IsGoalkeeper = false
);

public record ConfirmPaymentRequest(
    PaymentStatus Status
);

public record GenerateTeamsRequest(
    int NumberOfTeams
);

public record AssignPlayerTeamRequest(
    string? TeamAssigned
);

public record CreateGameRequest(
    string Title,
    string TeamLeft,
    string TeamRight
);

public record AddGoalRequest(
    string TeamName,
    Guid ScorerRegistrationId,
    Guid? AssistRegistrationId
);