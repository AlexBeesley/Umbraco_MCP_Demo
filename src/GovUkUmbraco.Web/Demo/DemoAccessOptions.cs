namespace GovUkUmbraco.Web.Demo;

/// <summary>
/// Settings for the public demo, where anyone can try AI editing through the hosted MCP server
/// using a shared, drafts-only backoffice account. Bound from the "DemoAccess" configuration section.
/// </summary>
public class DemoAccessOptions
{
    public const string SectionName = "DemoAccess";

    /// <summary>Creates the shared demo editor account and shows how to use it on the home page.</summary>
    public bool Enabled { get; set; }

    public string EditorName { get; set; } = "Demo editor";

    public string EditorEmail { get; set; } = "demo-editor@example.com";

    /// <summary>Deliberately public: it is shown on the home page so anyone can try the demo.</summary>
    public string? EditorPassword { get; set; }

    /// <summary>The hosted MCP server's URL, shown on the home page for people to add to their AI assistant.</summary>
    public string? McpUrl { get; set; }
}
