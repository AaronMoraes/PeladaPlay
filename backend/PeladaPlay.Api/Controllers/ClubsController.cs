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
public class ClubsController : ControllerBase
{
    private readonly PeladaPlayDbContext _db;

    public ClubsController(PeladaPlayDbContext db)
    {
        _db = db;
    }

    // Lista todos os clubes do usuário logado com seu papel contextual em cada um
    [HttpGet("my")]
    public async Task<IActionResult> GetMyClubs()
    {
        var userId = GetCurrentUserId();

        var clubs = await _db.ClubMembers
            .Where(cm => cm.UserId == userId)
            .Include(cm => cm.Club)
                .ThenInclude(c => c.DefaultVenue)
            .Select(cm => new
            {
                cm.Club.Id,
                cm.Club.Name,
                cm.Club.InviteCode,
                cm.Club.DayOfWeek,
                StartTime = cm.Club.StartTime.ToString(@"hh\:mm"),
                Duration = cm.Club.Duration.ToString(@"hh\:mm"),
                cm.Club.ExpectedPlayers,
                cm.Club.PlayersPerTeam,
                NumberOfTeams = Math.Max(2, cm.Club.ExpectedPlayers / Math.Max(1, cm.Club.PlayersPerTeam)),
                cm.Club.GoalkeepersPay,
                cm.Club.CashReserve,
                DefaultVenue = cm.Club.DefaultVenue == null ? null : new
                {
                    cm.Club.DefaultVenue.Id,
                    cm.Club.DefaultVenue.Name,
                    cm.Club.DefaultVenue.DefaultPrice
                },
                MyRole = cm.Role,
                MySkillRank = cm.SkillRank,
                MyIsGoalkeeper = cm.IsGoalkeeper
            })
            .ToListAsync();

        return Ok(clubs);
    }

    // Detalhes completos de um clube + elenco + permissão do usuário atual
    [HttpGet("{clubId:guid}")]
    public async Task<IActionResult> GetClubDetails(Guid clubId)
    {
        var userId = GetCurrentUserId();

        var club = await _db.Clubs
            .Include(c => c.DefaultVenue)
            .Include(c => c.Members)
                .ThenInclude(m => m.User)
            .FirstOrDefaultAsync(c => c.Id == clubId);

        if (club is null) return NotFound(new { message = "Clube não encontrado." });

        var myMembership = club.Members.FirstOrDefault(m => m.UserId == userId);
        if (myMembership is null) return Forbid();

        return Ok(new
        {
            club.Id,
            club.Name,
            club.InviteCode,
            club.DayOfWeek,
            StartTime = club.StartTime.ToString(@"hh\:mm"),
            Duration = club.Duration.ToString(@"hh\:mm"),
            club.ExpectedPlayers,
            club.PlayersPerTeam,
            NumberOfTeams = Math.Max(2, club.ExpectedPlayers / Math.Max(1, club.PlayersPerTeam)),
            club.GoalkeepersPay,
            club.CashReserve,
            DefaultVenue = club.DefaultVenue,
            MyRole = myMembership.Role,
            Members = club.Members
                .OrderByDescending(m => m.Role)
                .ThenBy(m => m.User.FullName)
                .Select(m => new
                {
                    MemberId = m.Id,
                    m.UserId,
                    m.User.FullName,
                    m.User.Position,
                    m.User.PhotoUrl,
                    m.Role,
                    m.SkillRank,
                    m.IsGoalkeeper
                })
        });
    }

    // Criar novo clube (o criador nasce como Admin neste clube)
    [HttpPost]
    public async Task<IActionResult> CreateClub(CreateClubRequest req)
    {
        var userId = GetCurrentUserId();

        if (!TimeSpan.TryParse(req.StartTime, out var parsedStartTime))
            return BadRequest(new { message = "Horário inválido. Use o formato HH:mm (ex: 20:00)." });

        var club = new Club
        {
            Name = req.Name.Trim(),
            DayOfWeek = req.DayOfWeek,
            StartTime = parsedStartTime,
            Duration = TimeSpan.FromMinutes(req.DurationMinutes > 0 ? req.DurationMinutes : 90),
            ExpectedPlayers = req.ExpectedPlayers > 0 ? req.ExpectedPlayers : 15,
            PlayersPerTeam = req.PlayersPerTeam > 0 ? req.PlayersPerTeam : 5,
            GoalkeepersPay = req.GoalkeepersPay,
            DefaultVenueId = req.DefaultVenueId
        };

        var adminMember = new ClubMember
        {
            Club = club,
            UserId = userId,
            Role = ClubRole.Admin,
            SkillRank = 3,
            IsGoalkeeper = req.CreatorIsGoalkeeper
        };

        _db.Clubs.Add(club);
        _db.ClubMembers.Add(adminMember);
        await _db.SaveChangesAsync();

        return Ok(new { club.Id, club.Name, club.InviteCode, MyRole = ClubRole.Admin });
    }

    // Entrar em um clube pelo código de convite (nasce como Player)
    [HttpPost("join/{inviteCode}")]
    public async Task<IActionResult> JoinByInvite(string inviteCode)
    {
        var userId = GetCurrentUserId();
        var club = await _db.Clubs.FirstOrDefaultAsync(c => c.InviteCode == inviteCode.ToUpper().Trim());

        if (club is null)
            return NotFound(new { message = "Código de convite inválido." });

        if (await _db.ClubMembers.AnyAsync(m => m.ClubId == club.Id && m.UserId == userId))
            return BadRequest(new { message = "Você já participa deste clube." });

        var member = new ClubMember
        {
            ClubId = club.Id,
            UserId = userId,
            Role = ClubRole.Player,
            SkillRank = 3
        };

        _db.ClubMembers.Add(member);
        await _db.SaveChangesAsync();

        return Ok(new { message = $"Bem-vindo ao {club.Name}!", club.Id, club.Name });
    }

    // Atualizar configurações e regras do clube (Exclusivo Admin)
    [HttpPut("{clubId:guid}")]
    public async Task<IActionResult> UpdateClub(Guid clubId, [FromBody] UpdateClubRequest req)
    {
        var userId = GetCurrentUserId();
        var requester = await _db.ClubMembers.FirstOrDefaultAsync(m => m.ClubId == clubId && m.UserId == userId);

        if (requester is null || requester.Role != ClubRole.Admin)
            return Forbid();

        var club = await _db.Clubs.FindAsync(clubId);
        if (club is null) return NotFound(new { message = "Clube não encontrado." });

        if (!TimeSpan.TryParse(req.StartTime, out var parsedStartTime))
            return BadRequest(new { message = "Horário inválido. Use o formato HH:mm (ex: 20:00)." });

        club.Name = req.Name.Trim();
        club.DayOfWeek = req.DayOfWeek;
        club.StartTime = parsedStartTime;
        club.ExpectedPlayers = req.ExpectedPlayers > 0 ? req.ExpectedPlayers : club.ExpectedPlayers;
        club.PlayersPerTeam = req.PlayersPerTeam > 0 ? req.PlayersPerTeam : club.PlayersPerTeam;
        club.GoalkeepersPay = req.GoalkeepersPay;

        await _db.SaveChangesAsync();
        return Ok(new { message = "Regras do clube atualizadas com sucesso!" });
    }

    // Movimentar Caixinha do Clube (Exclusivo Admin)
    [HttpPatch("{clubId:guid}/cash-reserve")]
    public async Task<IActionResult> AdjustCashReserve(Guid clubId, [FromBody] AdjustCashReserveRequest req)
    {
        var userId = GetCurrentUserId();
        var requester = await _db.ClubMembers.FirstOrDefaultAsync(m => m.ClubId == clubId && m.UserId == userId);

        if (requester is null || requester.Role != ClubRole.Admin)
            return Forbid();

        var club = await _db.Clubs.FindAsync(clubId);
        if (club is null) return NotFound(new { message = "Clube não encontrado." });

        if (club.CashReserve + req.Delta < 0)
            return BadRequest(new { message = "Saldo insuficiente na Caixinha para realizar essa retirada." });

        club.CashReserve += req.Delta;
        await _db.SaveChangesAsync();

        var actionLabel = req.Delta >= 0 ? "adicionado à" : "retirado da";
        return Ok(new
        {
            message = $"R$ {Math.Abs(req.Delta):F2} {actionLabel} Caixinha! Novo saldo: R$ {club.CashReserve:F2}.",
            cashReserve = club.CashReserve
        });
    }

    // Promover ou remover Sub-Organizador (Exclusivo do Admin deste clube)
    [HttpPatch("{clubId:guid}/members/{memberId:guid}/role")]
    public async Task<IActionResult> UpdateMemberRole(Guid clubId, Guid memberId, UpdateMemberRoleRequest req)
    {
        var userId = GetCurrentUserId();
        var requester = await _db.ClubMembers.FirstOrDefaultAsync(m => m.ClubId == clubId && m.UserId == userId);

        if (requester is null || requester.Role != ClubRole.Admin)
            return Forbid();

        var target = await _db.ClubMembers.FirstOrDefaultAsync(m => m.Id == memberId && m.ClubId == clubId);
        if (target is null) return NotFound();

        if (target.Role == ClubRole.Admin)
            return BadRequest(new { message = "Não é possível alterar o cargo do Organizador principal." });

        if (req.Role == ClubRole.Admin)
            return BadRequest(new { message = "Use apenas Player ou SubOrg." });

        target.Role = req.Role;
        await _db.SaveChangesAsync();

        return Ok(new { message = "Permissão atualizada com sucesso!" });
    }

    // Atualizar Rank (1 a 5 estrelas) e Goleiro dentro do clube (Admin ou SubOrg)
    [HttpPatch("{clubId:guid}/members/{memberId:guid}/stats")]
    public async Task<IActionResult> UpdateMemberRank(Guid clubId, Guid memberId, UpdateMemberRankRequest req)
    {
        var userId = GetCurrentUserId();
        var requester = await _db.ClubMembers.FirstOrDefaultAsync(m => m.ClubId == clubId && m.UserId == userId);

        if (requester is null || requester.Role == ClubRole.Player)
            return Forbid();

        var target = await _db.ClubMembers.FirstOrDefaultAsync(m => m.Id == memberId && m.ClubId == clubId);
        if (target is null) return NotFound();

        target.SkillRank = Math.Clamp(req.SkillRank, 1, 5);
        target.IsGoalkeeper = req.IsGoalkeeper;
        await _db.SaveChangesAsync();

        return Ok(new { message = "Rank e posição atualizados no clube!" });
    }

    private Guid GetCurrentUserId() =>
        Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
}

public record UpdateClubRequest(
    string Name,
    DayOfWeek DayOfWeek,
    string StartTime,
    int ExpectedPlayers,
    int PlayersPerTeam,
    bool GoalkeepersPay
);

public record AdjustCashReserveRequest(decimal Delta);