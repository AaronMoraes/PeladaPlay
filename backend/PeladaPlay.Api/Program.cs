using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using PeladaPlay.Api.Services;
using PeladaPlay.Infrastructure.Data;

// Garante compatibilidade total de DateTime entre o front-end e o PostgreSQL (Neon)
AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);

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

// Configuração robusta de CORS permitindo qualquer origem, headers e métodos (incluindo preflight OPTIONS)
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

var app = builder.Build();

// Tratamento global de erros para capturar qualquer exceção e retornar JSON com os headers de CORS intactos
app.UseExceptionHandler(errorApp =>
{
    errorApp.Run(async context =>
    {
        context.Response.StatusCode = 500;
        context.Response.ContentType = "application/json";
        
        // Garante que o CORS vai junto mesmo em caso de erro 500
        context.Response.Headers.Append("Access-Control-Allow-Origin", "*");
        context.Response.Headers.Append("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        context.Response.Headers.Append("Access-Control-Allow-Headers", "*");

        await context.Response.WriteAsJsonAsync(new
        {
            message = "Ocorreu um erro interno ao processar sua solicitação. Tente novamente."
        });
    });
});

// CORS DEVE vir antes de roteamentos, autenticação e autorização
app.UseCors("AllowAll");

app.UseHttpsRedirection();

app.UseAuthentication();
app.UseAuthorization();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Seed automático de quadras/campos e execução de migrations no banco Neon
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