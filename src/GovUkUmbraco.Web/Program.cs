using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
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

WebApplication app = builder.Build();

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
