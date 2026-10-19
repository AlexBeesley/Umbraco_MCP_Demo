using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.DependencyInjection;

namespace GovUkUmbraco.Web.Demo;

public class DemoComposer : IComposer
{
    public void Compose(IUmbracoBuilder builder)
    {
        var section = builder.Config.GetSection(DemoAccessOptions.SectionName);
        builder.Services.Configure<DemoAccessOptions>(section);

        if (section.GetValue<bool>(nameof(DemoAccessOptions.Enabled)))
        {
            builder.Services.AddHostedService<DemoEditorAccountService>();
        }
    }
}
