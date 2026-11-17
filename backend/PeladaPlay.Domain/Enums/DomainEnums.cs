namespace PeladaPlay.Domain.Enums;

public enum PreferredFoot
{
    Right = 0,
    Left = 1,
    Ambidextrous = 2
}

public enum ClubRole
{
    Player = 0,
    SubOrg = 1,
    Admin = 2
}

public enum MatchStatus
{
    Open = 0,
    ListOpen = 0,
    OpenList = 0,     // Alias compatível
    PixOpen = 1,
    InProgress = 2,
    Finished = 3,
    Canceled = 4
}

public enum PaymentStatus
{
    Pending = 0,
    Notified = 1,
    AwaitingConfirmation = 1, // Alias compatível
    Confirmed = 2,
    Exempt = 3
}