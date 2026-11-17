using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using PeladaPlay.Api.Services;
using PeladaPlay.Infrastructure.Data;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo { Title = "PeladaPlay API", Version = "v1" });
    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Description = "Cole o token JWT assim: Bearer {seu_token}",
        Name = "Authorization",
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.ApiKey,
        Scheme = "Bearer"
    });
    c.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
            },
            Array.Empty<string>()
        }
    });
});

builder.Services.AddDbContext<PeladaPlayDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddScoped<TokenService>();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Secret"]!))
        };
    });

builder.Services.AddCors(options =>
    {
        options.AddPolicy("AllowFrontend", policy =>
        {
            policy.WithOrigins(
                "http://localhost:5500",
                "http://127.0.0.1:5500",
                "https://peladaplay-kappa.vercel.app"
              )
              .AllowAnyHeader()
              .AllowAnyMethod();
        });
    });

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("AllowFrontend");
app.UseAuthentication();
app.UseAuthorization();
// Seed automático de quadras/campos caso o banco ainda não possua locais cadastrados
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<PeladaPlay.Infrastructure.Data.PeladaPlayDbContext>();
    db.Database.Migrate();
    if (!db.Venues.Any())
    {
        db.Venues.AddRange(
            new PeladaPlay.Domain.Entities.Venue { Name = "Arena Soccer Club Araraquara", Address = "Av. Alberto Benassi, 1500 - Araraquara, SP", DefaultPrice = 320.00m },
            new PeladaPlay.Domain.Entities.Venue { Name = "Boleiros Society & Bar", Address = "Rua Napoleão Selmi Dei, 820 - Vila Harmonia, Araraquara, SP", DefaultPrice = 280.00m },
            new PeladaPlay.Domain.Entities.Venue { Name = "Arena Morada do Sol Society", Address = "Av. Padre Francisco Salles Colturato, 2100 - Araraquara, SP", DefaultPrice = 300.00m },
            new PeladaPlay.Domain.Entities.Venue { Name = "Complexo Esportivo Fonte Luminosa (Quadras)", Address = "Rua Mauro Pinheiro, s/n - Fonte Luminosa, Araraquara, SP", DefaultPrice = null },
            new PeladaPlay.Domain.Entities.Venue { Name = "Arena Gold Ball Futebol Society", Address = "Av. Marginal, 450 - Jardim das Estações, Araraquara, SP", DefaultPrice = 260.00m },
            new PeladaPlay.Domain.Entities.Venue { Name = "Ginásio & Quadra Poliesportiva Central", Address = "Rua São Bento, 1100 - Centro, Araraquara, SP", DefaultPrice = 220.00m }
        );
        db.SaveChanges();
    }
}
app.MapControllers();

app.Run();