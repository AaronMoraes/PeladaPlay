using PeladaPlay.Domain.Enums;

namespace PeladaPlay.Domain.Entities;

public class Match
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ClubId { get; set; }
    public Club Club { get; set; } = null!;

    public DateTime MatchDateTime { get; set; }
    public MatchStatus Status { get; set; } = MatchStatus.Open;
    public decimal CourtCost { get; set; }

    // Pix configurado exclusivamente na partida (editável por Org/Sub-Org)
    public string? PixReceiverName { get; set; }
    public string? PixKey { get; set; }

    public bool IsSumulaValidated { get; set; } = false;

    public ICollection<MatchRegistration> Registrations { get; set; } = new List<MatchRegistration>();
    public ICollection<MatchGame> Games { get; set; } = new List<MatchGame>();

    // Regra automática da janela de 24h (ou abertura manual antecipada)
    public bool IsPixReleased(DateTime nowUtc) =>
        Status == MatchStatus.PixOpen || nowUtc >= MatchDateTime.AddHours(-24);
}

public class MatchRegistration
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid MatchId { get; set; }
    public Match Match { get; set; } = null!;

    public Guid? UserId { get; set; }
    public User? User { get; set; }
    public string DisplayName { get; set; } = string.Empty; // Nome do atleta ou convidado avulso
    public bool IsGoalkeeper { get; set; }
    public bool IsWaitlist { get; set; } = false;

    public decimal LockedAmount { get; set; } // Congelado quando o Pix abre
    public PaymentStatus PaymentStatus { get; set; } = PaymentStatus.Pending;
    public string? TeamAssigned { get; set; } // Ex: "Time A", "Time B", "Time C"
    public DateTime RegisteredAt { get; set; } = DateTime.UtcNow;
}

public class MatchGame
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid MatchId { get; set; }
    public Match Match { get; set; } = null!;

    public string Title { get; set; } = "Jogo 1";
    public string TeamLeft { get; set; } = string.Empty;
    public string TeamRight { get; set; } = string.Empty;

    public ICollection<MatchGoal> Goals { get; set; } = new List<MatchGoal>();
}

public class MatchGoal
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid MatchGameId { get; set; }
    public MatchGame MatchGame { get; set; } = null!;

    public string TeamName { get; set; } = string.Empty;
    public Guid ScorerRegistrationId { get; set; }
    public MatchRegistration Scorer { get; set; } = null!;

    public Guid? AssistRegistrationId { get; set; }
    public MatchRegistration? Assist { get; set; }
}