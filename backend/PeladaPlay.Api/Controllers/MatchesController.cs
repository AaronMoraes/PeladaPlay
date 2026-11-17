using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PeladaPlay.Api.DTOs;
using PeladaPlay.Domain.Entities;
using PeladaPlay.Domain.Enums;
using PeladaPlay.Infrastructure.Data;

namespace PeladaPlay.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class MatchesController : ControllerBase
{
    private readonly PeladaPlayDbContext _db;

    public MatchesController(PeladaPlayDbContext db)
    {
        _db = db;
    }

    // Lista partidas de um clube
    [HttpGet("club/{clubId:guid}")]
    public async Task<IActionResult> GetByClub(Guid clubId)
    {
        var userId = GetCurrentUserId();
        var member = await _db.ClubMembers.FirstOrDefaultAsync(m => m.ClubId == clubId && m.UserId == userId);
        if (member is null) return Forbid();

        var matches = await _db.Matches
            .Where(m => m.ClubId == clubId)
            .Include(m => m.Registrations)
            .OrderByDescending(m => m.MatchDateTime)
            .ToListAsync();

        // Verifica abertura automática da janela de Pix (<= 24h antes do jogo)
        var changed = false;
        foreach (var match in matches)
        {
            if (match.Status == MatchStatus.OpenList &&
                match.MatchDateTime <= DateTime.UtcNow.AddHours(24))
            {
                OpenPixWindowInternal(match, await _db.Clubs.FindAsync(clubId));
                changed = true;
            }
        }
        if (changed) await _db.SaveChangesAsync();

        return Ok(matches.Select(m => new
        {
            m.Id,
            m.ClubId,
            m.MatchDateTime,
            m.Status,
            m.CourtCost,
            m.IsSumulaValidated,
            ConfirmedCount = m.Registrations.Count(r => !r.IsWaitlist),
            WaitlistCount = m.Registrations.Count(r => r.IsWaitlist),
            PaidCount = m.Registrations.Count(r => !r.IsWaitlist && r.PaymentStatus == PaymentStatus.Confirmed)
        }));
    }

    // Detalhes completos da partida (Lista, Financeiro, Times e Súmula)
    [HttpGet("{matchId:guid}")]
    public async Task<IActionResult> GetDetails(Guid matchId)
    {
        var userId = GetCurrentUserId();
        var match = await _db.Matches
            .Include(m => m.Club)
            .Include(m => m.Registrations)
            .Include(m => m.Games)
                .ThenInclude(g => g.Goals)
                    .ThenInclude(goal => goal.Scorer)
            .Include(m => m.Games)
                .ThenInclude(g => g.Goals)
                    .ThenInclude(goal => goal.Assist)
            .FirstOrDefaultAsync(m => m.Id == matchId);

        if (match is null) return NotFound();

        var member = await _db.ClubMembers.FirstOrDefaultAsync(cm => cm.ClubId == match.ClubId && cm.UserId == userId);
        if (member is null) return Forbid();

        // Abertura automática da janela de Pix se faltam <= 24h
        if (match.Status == MatchStatus.OpenList &&
            match.MatchDateTime <= DateTime.UtcNow.AddHours(24))
        {
            OpenPixWindowInternal(match, match.Club);
            await _db.SaveChangesAsync();
        }

        var clubRanks = await _db.ClubMembers
            .Where(cm => cm.ClubId == match.ClubId)
            .ToDictionaryAsync(cm => cm.UserId, cm => cm.SkillRank);

        var payingMainCount = match.Registrations.Count(r =>
            !r.IsWaitlist && (match.Club.GoalkeepersPay || !r.IsGoalkeeper));

        var estimatedPerPlayer = payingMainCount > 0
            ? Math.Round(match.CourtCost / payingMainCount, 2)
            : match.CourtCost;

        var totalCollected = match.Registrations
            .Where(r => r.PaymentStatus == PaymentStatus.Confirmed)
            .Sum(r => r.LockedAmount);

        return Ok(new
        {
            match.Id,
            match.ClubId,
            ClubName = match.Club.Name,
            match.Club.ExpectedPlayers,
            match.Club.PlayersPerTeam,
            match.Club.GoalkeepersPay,
            ClubCashReserve = match.Club.CashReserve,
            match.MatchDateTime,
            match.Status,
            match.CourtCost,
            match.PixReceiverName,
            match.PixKey,
            match.IsSumulaValidated,
            MyRole = member.Role,
            FinancialSummary = new
            {
                EstimatedPerPlayer = estimatedPerPlayer,
                TotalCollected = totalCollected,
                SurplusToReserve = Math.Max(0, totalCollected - match.CourtCost),
                RemainingToGoal = Math.Max(0, match.CourtCost - totalCollected)
            },
            Registrations = match.Registrations
                .OrderBy(r => r.IsWaitlist)
                .ThenBy(r => r.RegisteredAt)
                .Select(r => new
                {
                    r.Id,
                    r.UserId,
                    r.DisplayName,
                    IsGuest = r.UserId == null,
                    r.IsGoalkeeper,
                    r.IsWaitlist,
                    SkillRank = r.UserId.HasValue && clubRanks.TryGetValue(r.UserId.Value, out var rank) ? rank : 3,
                    AmountToPay = match.Status == MatchStatus.OpenList
                        ? (!match.Club.GoalkeepersPay && r.IsGoalkeeper ? 0 : estimatedPerPlayer)
                        : r.LockedAmount,
                    r.PaymentStatus,
                    r.TeamAssigned,
                    r.RegisteredAt
                }),
            Games = match.Games.Select(g => new
            {
                g.Id,
                g.Title,
                g.TeamLeft,
                g.TeamRight,
                ScoreLeft = g.Goals.Count(x => x.TeamName == g.TeamLeft),
                ScoreRight = g.Goals.Count(x => x.TeamName == g.TeamRight),
                Goals = g.Goals.Select(x => new
                {
                    x.Id,
                    x.TeamName,
                    x.ScorerRegistrationId,
                    ScorerName = x.Scorer.DisplayName,
                    x.AssistRegistrationId,
                    AssistName = x.Assist?.DisplayName
                })
            })
        });
    }

    // Criar nova partida (Admin ou SubOrg)
    [HttpPost]
    public async Task<IActionResult> CreateMatch(CreateMatchRequest req)
    {
        var userId = GetCurrentUserId();
        var member = await _db.ClubMembers.FirstOrDefaultAsync(m => m.ClubId == req.ClubId && m.UserId == userId);
        if (member is null || member.Role == ClubRole.Player) return Forbid();

        var match = new Match
        {
            ClubId = req.ClubId,
            MatchDateTime = req.MatchDateTime,
            CourtCost = req.CourtCost,
            PixReceiverName = req.PixReceiverName,
            PixKey = req.PixKey,
            Status = MatchStatus.OpenList
        };

        _db.Matches.Add(match);
        await _db.SaveChangesAsync();

        return Ok(new { match.Id, message = "Partida criada e lista aberta!" });
    }

    // Entrar na lista da partida ("Tô Dentro")
    [HttpPost("{matchId:guid}/join")]
    public async Task<IActionResult> JoinMatch(Guid matchId, JoinMatchRequest req)
    {
        var userId = GetCurrentUserId();
        var match = await _db.Matches
            .Include(m => m.Club)
            .Include(m => m.Registrations)
            .FirstOrDefaultAsync(m => m.Id == matchId);

        if (match is null) return NotFound();

        var member = await _db.ClubMembers
            .Include(cm => cm.User)
            .FirstOrDefaultAsync(cm => cm.ClubId == match.ClubId && cm.UserId == userId);
        if (member is null) return Forbid();

        if (match.Registrations.Any(r => r.UserId == userId))
            return BadRequest(new { message = "Você já está inscrito nesta partida." });

        var mainCount = match.Registrations.Count(r => !r.IsWaitlist);
        var isWaitlist = mainCount >= match.Club.ExpectedPlayers;

        decimal lockedAmount = 0;
        if (match.Status != MatchStatus.OpenList && !isWaitlist)
        {
            lockedAmount = CalculateCurrentFrozenRate(match);
        }

        var reg = new MatchRegistration
        {
            MatchId = match.Id,
            UserId = userId,
            DisplayName = member.User.FullName,
            IsGoalkeeper = req.IsGoalkeeper || member.IsGoalkeeper,
            IsWaitlist = isWaitlist,
            LockedAmount = lockedAmount,
            PaymentStatus = (!match.Club.GoalkeepersPay && (req.IsGoalkeeper || member.IsGoalkeeper))
                ? PaymentStatus.Exempt
                : PaymentStatus.Pending
        };

        _db.MatchRegistrations.Add(reg);
        await _db.SaveChangesAsync();

        return Ok(new
        {
            message = isWaitlist ? "Lista cheia! Você entrou na fila de espera." : "Presença confirmada na lista!",
            isWaitlist
        });
    }

    // Adicionar convidado avulso (Admin ou SubOrg)
    [HttpPost("{matchId:guid}/guests")]
    public async Task<IActionResult> AddGuest(Guid matchId, AddGuestRequest req)
    {
        var userId = GetCurrentUserId();
        var match = await _db.Matches
            .Include(m => m.Club)
            .Include(m => m.Registrations)
            .FirstOrDefaultAsync(m => m.Id == matchId);

        if (match is null) return NotFound();

        var member = await _db.ClubMembers.FirstOrDefaultAsync(cm => cm.ClubId == match.ClubId && cm.UserId == userId);
        if (member is null || member.Role == ClubRole.Player) return Forbid();

        var mainCount = match.Registrations.Count(r => !r.IsWaitlist);
        var isWaitlist = mainCount >= match.Club.ExpectedPlayers;

        decimal lockedAmount = 0;
        if (match.Status != MatchStatus.OpenList && !isWaitlist)
        {
            lockedAmount = CalculateCurrentFrozenRate(match);
        }

        var guest = new MatchRegistration
        {
            MatchId = match.Id,
            UserId = null,
            DisplayName = $"{req.GuestName.Trim()} (Convidado)",
            IsGoalkeeper = req.IsGoalkeeper,
            IsWaitlist = isWaitlist,
            LockedAmount = lockedAmount,
            PaymentStatus = (!match.Club.GoalkeepersPay && req.IsGoalkeeper)
                ? PaymentStatus.Exempt
                : PaymentStatus.Pending
        };

        _db.MatchRegistrations.Add(guest);
        await _db.SaveChangesAsync();

        return Ok(new { message = "Convidado adicionado à lista!", isWaitlist });
    }

    // Sair da lista ("Não Vou") — Promove automaticamente o 1º da fila de espera mantendo o valor congelado
    [HttpDelete("{matchId:guid}/leave/{registrationId:guid}")]
    public async Task<IActionResult> RemoveRegistration(Guid matchId, Guid registrationId)
    {
        var userId = GetCurrentUserId();
        var match = await _db.Matches
            .Include(m => m.Club)
            .Include(m => m.Registrations)
            .FirstOrDefaultAsync(m => m.Id == matchId);

        if (match is null) return NotFound();

        var requester = await _db.ClubMembers.FirstOrDefaultAsync(cm => cm.ClubId == match.ClubId && cm.UserId == userId);
        if (requester is null) return Forbid();

        var target = match.Registrations.FirstOrDefault(r => r.Id == registrationId);
        if (target is null) return NotFound();

        // Jogador só remove a si mesmo; Admin/SubOrg remove qualquer um
        if (requester.Role == ClubRole.Player && target.UserId != userId)
            return Forbid();

        var wasMainPlayer = !target.IsWaitlist;
        var inheritedAmount = target.LockedAmount;

        _db.MatchRegistrations.Remove(target);

        // Se saiu um titular, promove o primeiro da fila de espera
        if (wasMainPlayer)
        {
            var nextInLine = match.Registrations
                .Where(r => r.IsWaitlist && r.Id != target.Id)
                .OrderBy(r => r.RegisteredAt)
                .FirstOrDefault();

            if (nextInLine is not null)
            {
                nextInLine.IsWaitlist = false;
                if (match.Status != MatchStatus.OpenList)
                {
                    nextInLine.LockedAmount = (!match.Club.GoalkeepersPay && nextInLine.IsGoalkeeper)
                        ? 0
                        : (inheritedAmount > 0 ? inheritedAmount : CalculateCurrentFrozenRate(match));
                }
            }
        }

        await _db.SaveChangesAsync();
        return Ok(new { message = "Vaga atualizada com sucesso!" });
    }

    // Abrir janela de Pix manualmente antes das 24h (Admin ou SubOrg)
    [HttpPost("{matchId:guid}/open-pix")]
    public async Task<IActionResult> OpenPixNow(Guid matchId)
    {
        var userId = GetCurrentUserId();
        var match = await _db.Matches
            .Include(m => m.Club)
            .Include(m => m.Registrations)
            .FirstOrDefaultAsync(m => m.Id == matchId);

        if (match is null) return NotFound();

        var requester = await _db.ClubMembers.FirstOrDefaultAsync(cm => cm.ClubId == match.ClubId && cm.UserId == userId);
        if (requester is null || requester.Role == ClubRole.Player) return Forbid();

        if (match.Status != MatchStatus.OpenList)
            return BadRequest(new { message = "A janela de Pix já está aberta." });

        OpenPixWindowInternal(match, match.Club);
        await _db.SaveChangesAsync();

        return Ok(new { message = "Janela de Pix aberta e valores congelados!" });
    }

    // Jogador informa que pagou ("Já paguei")
    [HttpPost("{matchId:guid}/registrations/{registrationId:guid}/notify-paid")]
    public async Task<IActionResult> NotifyPaid(Guid matchId, Guid registrationId)
    {
        var userId = GetCurrentUserId();
        var reg = await _db.MatchRegistrations.FirstOrDefaultAsync(r => r.Id == registrationId && r.MatchId == matchId);
        if (reg is null) return NotFound();

        if (reg.UserId != userId) return Forbid();

        reg.PaymentStatus = PaymentStatus.AwaitingConfirmation;
        await _db.SaveChangesAsync();

        return Ok(new { message = "Comprovante sinalizado ao organizador!" });
    }

    // Admin/SubOrg dá baixa no Pix do jogador
    [HttpPatch("{matchId:guid}/registrations/{registrationId:guid}/payment")]
    public async Task<IActionResult> ConfirmPayment(Guid matchId, Guid registrationId, ConfirmPaymentRequest req)
    {
        var userId = GetCurrentUserId();
        var match = await _db.Matches.FirstOrDefaultAsync(m => m.Id == matchId);
        if (match is null) return NotFound();

        var requester = await _db.ClubMembers.FirstOrDefaultAsync(cm => cm.ClubId == match.ClubId && cm.UserId == userId);
        if (requester is null || requester.Role == ClubRole.Player) return Forbid();

        var reg = await _db.MatchRegistrations.FirstOrDefaultAsync(r => r.Id == registrationId && r.MatchId == matchId);
        if (reg is null) return NotFound();

        reg.PaymentStatus = req.Status;
        await _db.SaveChangesAsync();

        return Ok(new { message = "Status de pagamento atualizado!" });
    }

    // Sorteio equilibrado por Estrelas (Admin ou SubOrg)
    [HttpPost("{matchId:guid}/draw-teams")]
    public async Task<IActionResult> DrawTeams(Guid matchId, GenerateTeamsRequest req)
    {
        var userId = GetCurrentUserId();
        var match = await _db.Matches
            .Include(m => m.Club)
            .Include(m => m.Registrations)
            .FirstOrDefaultAsync(m => m.Id == matchId);

        if (match is null) return NotFound();

        var requester = await _db.ClubMembers.FirstOrDefaultAsync(cm => cm.ClubId == match.ClubId && cm.UserId == userId);
        if (requester is null || requester.Role == ClubRole.Player) return Forbid();

        var teamCount = Math.Clamp(req.NumberOfTeams, 2, 6);
        var teamNames = Enumerable.Range(0, teamCount).Select(i => $"Time {(char)('A' + i)}").ToList();

        var clubRanks = await _db.ClubMembers
            .Where(cm => cm.ClubId == match.ClubId)
            .ToDictionaryAsync(cm => cm.UserId, cm => cm.SkillRank);

        var mainPlayers = match.Registrations.Where(r => !r.IsWaitlist).ToList();
        var goalkeepers = mainPlayers.Where(r => r.IsGoalkeeper).OrderBy(_ => Guid.NewGuid()).ToList();
        var fieldPlayers = mainPlayers
            .Where(r => !r.IsGoalkeeper)
            .OrderByDescending(r => r.UserId.HasValue && clubRanks.TryGetValue(r.UserId.Value, out var rk) ? rk : 3)
            .ThenBy(_ => Guid.NewGuid())
            .ToList();

        // Distribui goleiros 1 por time
        for (int i = 0; i < goalkeepers.Count; i++)
        {
            goalkeepers[i].TeamAssigned = teamNames[i % teamCount];
        }

        // Draft Serpente (1-2-3, 3-2-1) para equilibrar as estrelas
        for (int i = 0; i < fieldPlayers.Count; i++)
        {
            int round = i / teamCount;
            int idx = (round % 2 == 0) ? (i % teamCount) : (teamCount - 1 - (i % teamCount));
            fieldPlayers[i].TeamAssigned = teamNames[idx];
        }

        await _db.SaveChangesAsync();
        return Ok(new { message = "Times sorteados com equilíbrio de estrelas!" });
    }

    // Ajuste manual de time (Admin ou SubOrg)
    [HttpPatch("{matchId:guid}/registrations/{registrationId:guid}/team")]
    public async Task<IActionResult> AssignPlayerTeam(Guid matchId, Guid registrationId, AssignPlayerTeamRequest req)
    {
        var userId = GetCurrentUserId();
        var match = await _db.Matches.FirstOrDefaultAsync(m => m.Id == matchId);
        if (match is null) return NotFound();

        var requester = await _db.ClubMembers.FirstOrDefaultAsync(cm => cm.ClubId == match.ClubId && cm.UserId == userId);
        if (requester is null || requester.Role == ClubRole.Player) return Forbid();

        var reg = await _db.MatchRegistrations.FirstOrDefaultAsync(r => r.Id == registrationId && r.MatchId == matchId);
        if (reg is null) return NotFound();

        reg.TeamAssigned = req.TeamAssigned;
        await _db.SaveChangesAsync();

        return Ok(new { message = "Jogador movido de time!" });
    }

    // Criar jogo na Súmula (ex: Jogo 1 - Time A x Time B)
    [HttpPost("{matchId:guid}/games")]
    public async Task<IActionResult> CreateGame(Guid matchId, CreateGameRequest req)
    {
        var userId = GetCurrentUserId();
        var match = await _db.Matches.FirstOrDefaultAsync(m => m.Id == matchId);
        if (match is null) return NotFound();

        var requester = await _db.ClubMembers.FirstOrDefaultAsync(cm => cm.ClubId == match.ClubId && cm.UserId == userId);
        if (requester is null || requester.Role == ClubRole.Player) return Forbid();

        var game = new MatchGame
        {
            MatchId = matchId,
            Title = req.Title,
            TeamLeft = req.TeamLeft,
            TeamRight = req.TeamRight
        };

        _db.MatchGames.Add(game);
        await _db.SaveChangesAsync();

        return Ok(game);
    }

    // Registrar gol e assistência na Súmula
    [HttpPost("{matchId:guid}/games/{gameId:guid}/goals")]
    public async Task<IActionResult> AddGoal(Guid matchId, Guid gameId, AddGoalRequest req)
    {
        var userId = GetCurrentUserId();
        var match = await _db.Matches.FirstOrDefaultAsync(m => m.Id == matchId);
        if (match is null) return NotFound();

        var requester = await _db.ClubMembers.FirstOrDefaultAsync(cm => cm.ClubId == match.ClubId && cm.UserId == userId);
        if (requester is null || requester.Role == ClubRole.Player) return Forbid();

        var goal = new MatchGoal
        {
            MatchGameId = gameId,
            TeamName = req.TeamName,
            ScorerRegistrationId = req.ScorerRegistrationId,
            AssistRegistrationId = req.AssistRegistrationId
        };

        _db.MatchGoals.Add(goal);
        await _db.SaveChangesAsync();

        return Ok(new { message = "Gol registrado na súmula!" });
    }

    // Validar Súmula + Transferir excedente financeiro para a Caixinha do Clube
    [HttpPost("{matchId:guid}/validate-sumula")]
    public async Task<IActionResult> ValidateSumula(Guid matchId)
    {
        var userId = GetCurrentUserId();
        var match = await _db.Matches
            .Include(m => m.Club)
            .Include(m => m.Registrations)
            .FirstOrDefaultAsync(m => m.Id == matchId);

        if (match is null) return NotFound();

        var requester = await _db.ClubMembers.FirstOrDefaultAsync(cm => cm.ClubId == match.ClubId && cm.UserId == userId);
        if (requester is null || requester.Role == ClubRole.Player) return Forbid();

        if (!match.IsSumulaValidated)
        {
            var totalCollected = match.Registrations
                .Where(r => r.PaymentStatus == PaymentStatus.Confirmed)
                .Sum(r => r.LockedAmount);

            var surplus = Math.Max(0, totalCollected - match.CourtCost);
            match.Club.CashReserve += surplus;
            match.IsSumulaValidated = true;
            match.Status = MatchStatus.Finished;

            await _db.SaveChangesAsync();
        }

        return Ok(new
        {
            message = "Súmula oficial validada e estatísticas publicadas no PRO ID!",
            NewCashReserve = match.Club.CashReserve
        });
    }

    // Ranking de Artilharia, Assistências e Participações do Clube (apenas súmulas validadas)
    [HttpGet("club/{clubId:guid}/rankings")]
    public async Task<IActionResult> GetClubRankings(Guid clubId)
    {
        var userId = GetCurrentUserId();
        var member = await _db.ClubMembers.FirstOrDefaultAsync(m => m.ClubId == clubId && m.UserId == userId);
        if (member is null) return Forbid();

        var members = await _db.ClubMembers
            .Where(cm => cm.ClubId == clubId)
            .Include(cm => cm.User)
            .ToListAsync();

        var validatedRegs = await _db.MatchRegistrations
            .Where(r => r.Match.ClubId == clubId && r.Match.IsSumulaValidated && !r.IsWaitlist && r.UserId != null)
            .ToListAsync();

        var validatedGoals = await _db.MatchGoals
            .Include(g => g.Scorer)
            .Include(g => g.Assist)
            .Where(g => g.MatchGame.Match.ClubId == clubId && g.MatchGame.Match.IsSumulaValidated)
            .ToListAsync();

        var ranking = members.Select(m =>
        {
            var matchesPlayed = validatedRegs.Count(r => r.UserId == m.UserId);
            var goals = validatedGoals.Count(g => g.Scorer.UserId == m.UserId);
            var assists = validatedGoals.Count(g => g.Assist != null && g.Assist.UserId == m.UserId);

            return new
            {
                m.UserId,
                m.User.FullName,
                m.User.Position,
                m.User.PhotoUrl,
                m.SkillRank,
                Matches = matchesPlayed,
                Goals = goals,
                Assists = assists,
                TotalContributions = goals + assists
            };
        })
        .OrderByDescending(x => x.Goals)
        .ThenByDescending(x => x.Assists)
        .ThenByDescending(x => x.Matches)
        .ToList();

        return Ok(ranking);
    }

    private static void OpenPixWindowInternal(Match match, Club? club)
    {
        match.Status = MatchStatus.PixOpen;
        var goalkeepersPay = club?.GoalkeepersPay ?? false;

        var payingMain = match.Registrations
            .Where(r => !r.IsWaitlist && (goalkeepersPay || !r.IsGoalkeeper))
            .ToList();

        var perPlayer = payingMain.Count > 0
            ? Math.Round(match.CourtCost / payingMain.Count, 2)
            : match.CourtCost;

        foreach (var reg in match.Registrations.Where(r => !r.IsWaitlist))
        {
            if (!goalkeepersPay && reg.IsGoalkeeper)
            {
                reg.LockedAmount = 0;
                reg.PaymentStatus = PaymentStatus.Exempt;
            }
            else
            {
                reg.LockedAmount = perPlayer;
            }
        }
    }

    private static decimal CalculateCurrentFrozenRate(Match match)
    {
        var existingFrozen = match.Registrations.FirstOrDefault(r => !r.IsWaitlist && r.LockedAmount > 0);
        if (existingFrozen is not null) return existingFrozen.LockedAmount;

        var payingCount = match.Registrations.Count(r => !r.IsWaitlist && (match.Club.GoalkeepersPay || !r.IsGoalkeeper));
        return payingCount > 0 ? Math.Round(match.CourtCost / payingCount, 2) : match.CourtCost;
    }

    private Guid GetCurrentUserId() =>
        Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
}