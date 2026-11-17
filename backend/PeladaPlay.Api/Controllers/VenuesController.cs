using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PeladaPlay.Api.DTOs;
using PeladaPlay.Domain.Entities;
using PeladaPlay.Infrastructure.Data;

namespace PeladaPlay.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class VenuesController : ControllerBase
{
    private readonly PeladaPlayDbContext _db;

    public VenuesController(PeladaPlayDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var venues = await _db.Venues
            .OrderBy(v => v.Name)
            .Select(v => new
            {
                v.Id,
                v.Name,
                v.Address,
                v.DefaultPrice,
                IsPriceOnRequest = v.DefaultPrice == null
            })
            .ToListAsync();

        return Ok(venues);
    }

    [HttpPost]
    public async Task<IActionResult> Create(CreateVenueRequest req)
    {
        var venue = new Venue
        {
            Name = req.Name.Trim(),
            Address = req.Address.Trim(),
            DefaultPrice = req.DefaultPrice
        };

        _db.Venues.Add(venue);
        await _db.SaveChangesAsync();

        return Ok(venue);
    }
}