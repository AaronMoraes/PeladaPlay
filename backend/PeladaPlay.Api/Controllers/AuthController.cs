using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PeladaPlay.Api.DTOs;
using PeladaPlay.Api.Services;
using PeladaPlay.Domain.Entities;
using PeladaPlay.Infrastructure.Data;

namespace PeladaPlay.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly PeladaPlayDbContext _db;
    private readonly TokenService _tokenService;

    public AuthController(PeladaPlayDbContext db, TokenService tokenService)
    {
        _db = db;
        _tokenService = tokenService;
    }

    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest req)
    {
        if (await _db.Users.AnyAsync(u => u.Email == req.Email.ToLower().Trim()))
            return BadRequest(new { message = "Este e-mail já está cadastrado." });

        var user = new User
        {
            FullName = req.FullName.Trim(),
            Email = req.Email.ToLower().Trim(),
            PasswordHash = HashPassword(req.Password),
            Position = req.Position,
            PreferredFoot = req.PreferredFoot,
            ShirtNumber = req.ShirtNumber,
            City = req.City,
            Phone = req.Phone
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        var token = _tokenService.GenerateToken(user);
        return Ok(MapToResponse(user, token));
    }

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest req)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == req.Email.ToLower().Trim());
        if (user is null || user.PasswordHash != HashPassword(req.Password))
            return Unauthorized(new { message = "E-mail ou senha inválidos." });

        var token = _tokenService.GenerateToken(user);
        return Ok(MapToResponse(user, token));
    }

    [Authorize]
    [HttpGet("me")]
    public async Task<ActionResult<object>> GetMyProfile()
    {
        var userId = GetCurrentUserId();
        var user = await _db.Users
            .Include(u => u.Memberships)
            .ThenInclude(m => m.Club)
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (user is null) return NotFound();

        // Calcula estatísticas globais apenas de súmulas validadas
        var validatedMatches = await _db.MatchRegistrations
            .CountAsync(r => r.UserId == userId && r.Match.IsSumulaValidated);

        var totalGoals = await _db.MatchGoals
            .CountAsync(g => g.Scorer.UserId == userId && g.MatchGame.Match.IsSumulaValidated);

        var totalAssists = await _db.MatchGoals
            .CountAsync(g => g.Assist != null && g.Assist.UserId == userId && g.MatchGame.Match.IsSumulaValidated);

        return Ok(new
        {
            user.Id,
            user.FullName,
            user.Email,
            user.Position,
            user.PreferredFoot,
            user.ShirtNumber,
            user.City,
            user.Phone,
            user.PhotoUrl,
            user.PixKey,
            Stats = new
            {
                Matches = validatedMatches,
                Goals = totalGoals,
                Assists = totalAssists,
                ContributionsPerGame = validatedMatches > 0
                    ? Math.Round((double)(totalGoals + totalAssists) / validatedMatches, 2)
                    : 0
            },
            Clubs = user.Memberships.Select(m => new
            {
                m.ClubId,
                ClubName = m.Club.Name,
                m.Role,
                m.SkillRank,
                m.IsGoalkeeper
            })
        });
    }

    [Authorize]
    [HttpPut("me")]
    public async Task<IActionResult> UpdateProfile(UpdateProfileRequest req)
    {
        var userId = GetCurrentUserId();
        var user = await _db.Users.FindAsync(userId);
        if (user is null) return NotFound();

        user.FullName = req.FullName.Trim();
        user.Position = req.Position;
        user.PreferredFoot = req.PreferredFoot;
        user.ShirtNumber = req.ShirtNumber;
        user.City = req.City;
        user.Phone = req.Phone;
        user.PhotoUrl = req.PhotoUrl;
        user.PixKey = string.IsNullOrWhiteSpace(req.PixKey) ? null : req.PixKey.Trim();

        await _db.SaveChangesAsync();
        return Ok(new { message = "Perfil atualizado com sucesso!" });
    }

    private Guid GetCurrentUserId() =>
        Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    private static string HashPassword(string password)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(password));
        return Convert.ToBase64String(bytes);
    }

    private static AuthResponse MapToResponse(User u, string token) =>
        new(token, u.Id, u.FullName, u.Email, u.Position, u.PreferredFoot, u.ShirtNumber, u.City, u.Phone, u.PhotoUrl, u.PixKey);
}