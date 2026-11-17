using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PeladaPlay.Api.DTOs;
using PeladaPlay.Domain.Entities;
using PeladaPlay.Domain.Enums;
using PeladaPlay.Infrastructure.Data;
using System.Security.Claims;

namespace PeladaPlay.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class ClubsController : ControllerBase
{
    private readonly PeladaPlayDbContext _context;

    public ClubsController(PeladaPlayDbContext context)
    {
        _context = context;
    }

    [HttpPost]
    public async Task<IActionResult> CreateClub([FromBody] CreateClubDto dto)
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (userIdClaim == null || !Guid.TryParse(userIdClaim, out var userId))
            return Unauthorized(new { message = "Usuário não autenticado." });

        if (string.IsNullOrWhiteSpace(dto.Name))
            return BadRequest(new { message = "O nome do clube é obrigatório." });

        string inviteCode;
        do
        {
            inviteCode = Guid.NewGuid().ToString("N").Substring(0, 6).ToUpper();
        } while (await _context.Clubs.AnyAsync(c => c.InviteCode == inviteCode));

        var club = new Club
        {
            Id = Guid.NewGuid(),
            Name = dto.Name.Trim(),
            InviteCode = inviteCode,
            DefaultVenueId = dto.DefaultVenueId,
            ExpectedPlayers = dto.ExpectedPlayers > 0 ? dto.ExpectedPlayers : 14,
            PlayersPerTeam = dto.PlayersPerTeam > 0 ? dto.PlayersPerTeam : 5,
            GoalkeepersPay = dto.GoalkeepersPay,
            CashReserve = 0
        };

        _context.Clubs.Add(club);

        var member = new ClubMember
        {
            Id = Guid.NewGuid(),
            ClubId = club.Id,
            UserId = userId,
            Role = ClubRole.Admin,
            SkillRank = 3,
            IsGoalkeeper = false
        };

        _context.ClubMembers.Add(member);
        await _context.SaveChangesAsync();

        return Ok(new { message = "Clube criado com sucesso!", id = club.Id, inviteCode = club.InviteCode });
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetClub(Guid id)
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (userIdClaim == null || !Guid.TryParse(userIdClaim, out var userId))
            return Unauthorized();

        var club = await _context.Clubs
            .Include(c => c.DefaultVenue)
            .Include(c => c.Members)
                .ThenInclude(m => m.User)
            .FirstOrDefaultAsync(c => c.Id == id);

        if (club == null) return NotFound(new { message = "Clube não encontrado." });

        var myMembership = club.Members.FirstOrDefault(m => m.UserId == userId);
        if (myMembership == null) return Forbid();

        var membersList = club.Members.Select(m => new
        {
            userId = m.UserId,
            fullName = m.User.FullName,
            email = m.User.Email,
            shirtNumber = m.User.ShirtNumber,
            position = m.User.Position,
            skillRank = m.SkillRank,
            isGoalkeeper = m.IsGoalkeeper,
            role = m.Role
        }).ToList();

        return Ok(new
        {
            id = club.Id,
            name = club.Name,
            inviteCode = club.InviteCode,
            defaultVenue = club.DefaultVenue == null ? null : new { id = club.DefaultVenue.Id, name = club.DefaultVenue.Name, defaultPrice = club.DefaultVenue.DefaultPrice },
            expectedPlayers = club.ExpectedPlayers,
            playersPerTeam = club.PlayersPerTeam,
            goalkeepersPay = club.GoalkeepersPay,
            cashReserve = club.CashReserve,
            myRole = myMembership.Role,
            members = membersList
        });
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> UpdateClub(Guid id, [FromBody] UpdateClubDto dto)
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (userIdClaim == null || !Guid.TryParse(userIdClaim, out var userId))
            return Unauthorized();

        var club = await _context.Clubs
            .Include(c => c.Members)
            .FirstOrDefaultAsync(c => c.Id == id);

        if (club == null) return NotFound(new { message = "Clube não encontrado." });

        var membership = club.Members.FirstOrDefault(m => m.UserId == userId);
        if (membership == null || membership.Role == ClubRole.Player)
            return Forbid();

        club.Name = dto.Name.Trim();
        club.DefaultVenueId = dto.DefaultVenueId;
        club.ExpectedPlayers = dto.ExpectedPlayers > 0 ? dto.ExpectedPlayers : 14;
        club.PlayersPerTeam = dto.PlayersPerTeam > 0 ? dto.PlayersPerTeam : 5;
        club.GoalkeepersPay = dto.GoalkeepersPay;

        await _context.SaveChangesAsync();
        return Ok(new { message = "Configurações do clube atualizadas com sucesso!" });
    }

    [HttpPost("join")]
    public async Task<IActionResult> JoinClub([FromBody] JoinClubDto dto)
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (userIdClaim == null || !Guid.TryParse(userIdClaim, out var userId))
            return Unauthorized();

        if (string.IsNullOrWhiteSpace(dto.InviteCode))
            return BadRequest(new { message = "Código de convite inválido." });

        var club = await _context.Clubs.FirstOrDefaultAsync(c => c.InviteCode == dto.InviteCode.Trim().ToUpper());
        if (club == null) return NotFound(new { message = "Clube não encontrado com este código." });

        var existing = await _context.ClubMembers.FirstOrDefaultAsync(m => m.ClubId == club.Id && m.UserId == userId);
        if (existing != null)
            return BadRequest(new { message = "Você já faz parte deste clube!" });

        var member = new ClubMember
        {
            Id = Guid.NewGuid(),
            ClubId = club.Id,
            UserId = userId,
            Role = ClubRole.Player,
            SkillRank = 3,
            IsGoalkeeper = false
        };

        _context.ClubMembers.Add(member);
        await _context.SaveChangesAsync();

        return Ok(new { message = "Você entrou no clube com sucesso!", clubId = club.Id });
    }

    [HttpPatch("{clubId}/members/{userId}/rank")]
    public async Task<IActionResult> UpdateMemberRank(Guid clubId, Guid userId, [FromBody] UpdateRankDto dto)
    {
        var currentUserIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (currentUserIdClaim == null || !Guid.TryParse(currentUserIdClaim, out var currentUserId))
            return Unauthorized();

        var club = await _context.Clubs
            .Include(c => c.Members)
            .FirstOrDefaultAsync(c => c.Id == clubId);

        if (club == null) return NotFound(new { message = "Clube não encontrado." });

        // Verifica se quem está alterando é Admin/Organizador do clube
        var currentMembership = club.Members.FirstOrDefault(m => m.UserId == currentUserId);
        if (currentMembership == null || currentMembership.Role == ClubRole.Player)
            return Forbid();

        var targetMembership = club.Members.FirstOrDefault(m => m.UserId == userId);
        if (targetMembership == null) return NotFound(new { message = "Membro não encontrado no clube." });

        targetMembership.SkillRank = dto.SkillRank;
        await _context.SaveChangesAsync();

        return Ok(new { message = "Rank atualizado com sucesso!" });
    }
}