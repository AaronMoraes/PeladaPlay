using Microsoft.EntityFrameworkCore;
using PeladaPlay.Domain.Entities;

namespace PeladaPlay.Infrastructure.Data;

public class PeladaPlayDbContext : DbContext
{
    public PeladaPlayDbContext(DbContextOptions<PeladaPlayDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<Venue> Venues => Set<Venue>();
    public DbSet<Club> Clubs => Set<Club>();
    public DbSet<ClubMember> ClubMembers => Set<ClubMember>();
    public DbSet<Match> Matches => Set<Match>();
    public DbSet<MatchRegistration> MatchRegistrations => Set<MatchRegistration>();
    public DbSet<MatchGame> MatchGames => Set<MatchGame>();
    public DbSet<MatchGoal> MatchGoals => Set<MatchGoal>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // User
        modelBuilder.Entity<User>(e =>
        {
            e.HasIndex(x => x.Email).IsUnique();
            e.Property(x => x.FullName).HasMaxLength(150).IsRequired();
            e.Property(x => x.Email).HasMaxLength(150).IsRequired();
        });

        // Venue
        modelBuilder.Entity<Venue>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(150).IsRequired();
            e.Property(x => x.DefaultPrice).HasPrecision(10, 2);
        });

        // Club
        modelBuilder.Entity<Club>(e =>
        {
            e.HasIndex(x => x.InviteCode).IsUnique();
            e.Property(x => x.Name).HasMaxLength(150).IsRequired();
            e.Property(x => x.CashReserve).HasPrecision(10, 2);
        });

        // ClubMember (1 vínculo por usuário em cada clube)
        modelBuilder.Entity<ClubMember>(e =>
        {
            e.HasIndex(x => new { x.ClubId, x.UserId }).IsUnique();
        });

        // Match
        modelBuilder.Entity<Match>(e =>
        {
            e.Property(x => x.CourtCost).HasPrecision(10, 2);
        });

        // MatchRegistration
        modelBuilder.Entity<MatchRegistration>(e =>
        {
            e.Property(x => x.LockedAmount).HasPrecision(10, 2);
            e.HasOne(x => x.User)
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        // MatchGoal (Evita múltiplos caminhos em cascata no SQL Server)
        modelBuilder.Entity<MatchGoal>(e =>
        {
            e.HasOne(x => x.Scorer)
                .WithMany()
                .HasForeignKey(x => x.ScorerRegistrationId)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasOne(x => x.Assist)
                .WithMany()
                .HasForeignKey(x => x.AssistRegistrationId)
                .OnDelete(DeleteBehavior.Restrict);
        });
    }
}