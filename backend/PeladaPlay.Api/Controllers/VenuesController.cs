using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PeladaPlay.Domain.Entities;
using PeladaPlay.Infrastructure.Data;

namespace PeladaPlay.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class VenuesController : ControllerBase
{
    private readonly PeladaPlayDbContext _context;

    public VenuesController(PeladaPlayDbContext context)
    {
        _context = context;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var venues = await _context.Venues
            .OrderBy(v => v.Name)
            .ToListAsync();
        return Ok(venues);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateVenueRequest dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Name))
            return BadRequest(new { message = "O nome da quadra/local é obrigatório." });

        var venue = new Venue
        {
            Id = Guid.NewGuid(),
            Name = dto.Name.Trim(),
            Address = dto.Address?.Trim() ?? string.Empty,
            DefaultPrice = dto.DefaultPrice
        };

        _context.Venues.Add(venue);
        await _context.SaveChangesAsync();

        return Ok(new { message = "Quadra cadastrada com sucesso!", id = venue.Id });
    }
}

// DTO interno para evitar qualquer erro de referência ausente
public class CreateVenueRequest
{
    public string Name { get; set; } = string.Empty;
    public string Address { get; set; } = string.Empty;
    public decimal? DefaultPrice { get; set; }
}