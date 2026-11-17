using PeladaPlay.Domain.Enums;

namespace PeladaPlay.Api.DTOs;

public record RegisterRequest(
    string FullName,
    string Email,
    string Password,
    string Position,
    PreferredFoot PreferredFoot,
    int ShirtNumber,
    string? City,
    string? Phone
);

public record LoginRequest(string Email, string Password);

public record AuthResponse(
    string Token,
    Guid UserId,
    string FullName,
    string Email,
    string Position,
    PreferredFoot PreferredFoot,
    int ShirtNumber,
    string? City,
    string? Phone,
    string? PhotoUrl,
    string? PixKey
);

public record UpdateProfileRequest(
    string FullName,
    string Position,
    PreferredFoot PreferredFoot,
    int ShirtNumber,
    string? City,
    string? Phone,
    string? PhotoUrl,
    string? PixKey
);