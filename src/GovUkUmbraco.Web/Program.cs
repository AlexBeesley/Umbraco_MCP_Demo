using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using OpenIddict.Server.AspNetCore;
using ThePensionsRegulator.GovUk.Frontend.Umbraco;
using Umbraco.Cms.Core.Models.PublishedContent;
using Umbraco.Cms.Core.Web;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

#if DEBUG
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true);
#endif

// GOV.UK Design System tag helpers (GovUk.Frontend.AspNetCore) plus the Umbraco block/validation
// support from ThePensionsRegulator.GovUk.Frontend.Umbraco. Must be registered before Umbraco.
builder.Services.AddTprGovUkFrontendUmbraco();

builder.CreateUmbracoBuilder()
    .AddBackOffice()
    .AddWebsite()
    .AddComposers()
    .Build();

// Local hosted-MCP testing only: the Cloudflare Workers runtime (wrangler dev) can't verify the
// self-signed dev certificate, so it exchanges OAuth tokens with the site over plain HTTP.
if (builder.Environment.IsDevelopment())
{
    builder.Services.AddOpenIddict()
        .AddServer(options => options.UseAspNetCore().DisableTransportSecurityRequirement());
}

WebApplication app = builder.Build();

// Public deployments use neutral branding: the GOV.UK crown, logotype and GDS Transport typeface are
// reserved for services on GOV.UK. Refusing these assets makes the stylesheet fall back to Arial.
if (!app.Configuration.GetValue("Site:GovUkBranding", true))
{
    app.Use(async (context, next) =>
    {
        var path = context.Request.Path;
        if (path.StartsWithSegments("/assets/fonts") || path.StartsWithSegments("/assets/images/govuk-crest.svg"))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        await next();
    });
}

// Serves the GOV.UK Frontend JS/CSS/fonts and maps Umbraco-configured validation messages
// onto DataAnnotations attributes. Must run before Umbraco's own middleware.
var mvcOptions = app.Services.GetRequiredService<IOptions<MvcOptions>>();
var umbracoContextAccessor = app.Services.GetRequiredService<IUmbracoContextAccessor>();
var publishedValueFallback = app.Services.GetRequiredService<IPublishedValueFallback>();
app.UseTprGovUkFrontendUmbraco(mvcOptions, umbracoContextAccessor, publishedValueFallback);

await app.BootUmbracoAsync();

app.UseUmbraco()
    .WithMiddleware(u =>
    {
        u.UseBackOffice();
        u.UseWebsite();
    })
    .WithEndpoints(u =>
    {
        u.UseBackOfficeEndpoints();
        u.UseWebsiteEndpoints();
    });

await app.RunAsync();
