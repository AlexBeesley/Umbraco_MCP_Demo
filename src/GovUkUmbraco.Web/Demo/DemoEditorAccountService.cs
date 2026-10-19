using Microsoft.Extensions.Options;
using Umbraco.Cms.Core;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Core.Security;
using Umbraco.Cms.Core.Services;
using Umbraco.Cms.Core.Strings;

namespace GovUkUmbraco.Web.Demo;

/// <summary>
/// Keeps the shared public demo account in place: a backoffice user in a group that can create and edit
/// pages under Home but not publish them, so nothing a member of the public writes goes live without review.
/// Because the account is shared, it also puts the published password back if someone changes it, and deletes
/// pages the account created that are over a day old and were never published.
/// </summary>
public class DemoEditorAccountService(
    IServiceScopeFactory scopeFactory,
    IRuntimeState runtimeState,
    IOptions<DemoAccessOptions> options,
    ILogger<DemoEditorAccountService> logger) : BackgroundService
{
    public const string GroupAlias = "aiDemoEditors";

    // Check often until the account exists (a fresh install imports Home a little after boot), then less often.
    private static readonly TimeSpan SetupInterval = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan CheckInterval = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan DraftLifetime = TimeSpan.FromHours(24);

    // Read, create and edit pages; deliberately no Publish, Unpublish, Delete, Move or Sort.
    private static readonly string[] DocumentPermissions =
    [
        "Umb.Document.Read",
        "Umb.Document.Create",
        "Umb.Document.Update",
        "Umb.Document.PropertyValue.Read",
        "Umb.Document.PropertyValue.Write",
    ];

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (string.IsNullOrWhiteSpace(options.Value.EditorPassword))
        {
            logger.LogWarning("DemoAccess is enabled but DemoAccess:EditorPassword is not set, so no demo account was created");
            return;
        }

        using var timer = new PeriodicTimer(SetupInterval);
        do
        {
            // On a fresh install the site content (and so the Home start node) arrives via uSync after boot.
            if (runtimeState.Level != RuntimeLevel.Run)
            {
                continue;
            }

            try
            {
                if (await EnsureAccountAsync())
                {
                    timer.Period = CheckInterval;
                    DeleteExpiredDrafts();
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Could not ensure the demo editor account");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    /// <returns>Whether the account is in place.</returns>
    private async Task<bool> EnsureAccountAsync()
    {
        using var scope = scopeFactory.CreateScope();
        var services = scope.ServiceProvider;
        var contentService = services.GetRequiredService<IContentService>();
        var userGroupService = services.GetRequiredService<IUserGroupService>();
        var userService = services.GetRequiredService<IUserService>();
        var languageService = services.GetRequiredService<ILanguageService>();
        var shortStringHelper = services.GetRequiredService<IShortStringHelper>();
        var userManager = services.GetRequiredService<IBackOfficeUserManager>();
        var settings = options.Value;

        var home = contentService.GetRootContent().FirstOrDefault(x => x.ContentType.Alias == "home");
        if (home is null)
        {
            logger.LogInformation("Demo editor account not created yet: the Home page doesn't exist");
            return false;
        }

        var group = await userGroupService.GetAsync(GroupAlias);
        if (group is null)
        {
            group = new UserGroup(shortStringHelper, 0, GroupAlias, "AI demo editors", "icon-wand")
            {
                Description = "Public demo: can create and edit pages under Home, but not publish them.",
                StartContentId = home.Id,
                StartMediaId = -1,
                HasAccessToAllLanguages = false,
                Permissions = new HashSet<string>(DocumentPermissions),
            };
            group.AddAllowedSection(Constants.Applications.Content);
            var english = await languageService.GetAsync("en-GB");
            if (english is not null)
            {
                group.AddAllowedLanguage(english.Id);
            }

            var created = await userGroupService.CreateAsync(group, Constants.Security.SuperUserKey);
            if (!created.Success)
            {
                logger.LogError("Could not create the demo editor group: {Status}", created.Status);
                return false;
            }

            group = created.Result;
            logger.LogInformation("Created the {Group} user group", group.Name);
        }

        var user = userService.GetByEmail(settings.EditorEmail);
        if (user is null)
        {
            var created = await userService.CreateAsync(
                Constants.Security.SuperUserKey,
                new UserCreateModel
                {
                    Email = settings.EditorEmail,
                    UserName = settings.EditorEmail,
                    Name = settings.EditorName,
                    Kind = UserKind.Default,
                    UserGroupKeys = new HashSet<Guid> { group.Key },
                },
                approveUser: true);
            if (!created.Success || created.Result.CreatedUser is null)
            {
                logger.LogError("Could not create the demo editor user: {Status}", created.Status);
                return false;
            }

            user = created.Result.CreatedUser;
            logger.LogInformation("Created the demo editor user {Email}", settings.EditorEmail);
        }

        // Only reset when the password no longer matches: saving the user revokes its sessions,
        // including any connected AI assistants.
        var identity = await userManager.FindByEmailAsync(settings.EditorEmail);
        if (identity is not null && !await userManager.CheckPasswordAsync(identity, settings.EditorPassword))
        {
            var changed = await userService.ChangePasswordAsync(
                Constants.Security.SuperUserKey,
                new ChangeUserPasswordModel { UserKey = user.Key, NewPassword = settings.EditorPassword! });
            if (changed.Success)
            {
                logger.LogInformation("Reset the demo editor password to the published one");
            }
            else
            {
                logger.LogError("Could not reset the demo editor password: {Status}", changed.Status);
            }
        }

        return true;
    }

    private void DeleteExpiredDrafts()
    {
        using var scope = scopeFactory.CreateScope();
        var contentService = scope.ServiceProvider.GetRequiredService<IContentService>();
        var userService = scope.ServiceProvider.GetRequiredService<IUserService>();

        var demoUser = userService.GetByEmail(options.Value.EditorEmail);
        var home = contentService.GetRootContent().FirstOrDefault(x => x.ContentType.Alias == "home");
        if (demoUser is null || home is null)
        {
            return;
        }

        // Compare on the same clock the date was stored with (Umbraco 17 stores UTC).
        static DateTime Now(DateTime value) => value.Kind == DateTimeKind.Utc ? DateTime.UtcNow : DateTime.Now;
        var expired = contentService.GetPagedDescendants(home.Id, 0, int.MaxValue, out _)
            .Where(x => x.CreatorId == demoUser.Id && x.PublishDate is null && !x.Published
                && Now(x.CreateDate) - x.CreateDate > DraftLifetime)
            .ToList();
        foreach (var page in expired)
        {
            contentService.Delete(page);
            logger.LogInformation("Deleted expired demo draft {Name} ({Key})", page.Name, page.Key);
        }
    }
}
