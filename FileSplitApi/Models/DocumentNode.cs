namespace FileSplitApi.Models;

/// <summary>
/// Represents a hierarchical document node (heading with content and children)
/// </summary>
public class DocumentNode
{
    /// <summary>
    /// The heading text (e.g., "1. Introduction", "2.1 Functional Requirements")
    /// </summary>
    public string Heading { get; set; } = string.Empty;

    /// <summary>
    /// Level in the hierarchy (1 = top level, 2 = sub-heading, etc.)
    /// </summary>
    public int Level { get; set; }

    /// <summary>
    /// Content of this section in HTML format (converted from DOCX)
    /// </summary>
    public string? ContentHtml { get; set; }

    /// <summary>
    /// Content of this section in Markdown format
    /// </summary>
    public string? ContentMarkdown { get; set; }

    /// <summary>
    /// Original DOCX content as base64 (optional, for downloading original split files)
    /// </summary>
    public string? ContentDocxBase64 { get; set; }

    /// <summary>
    /// Child nodes (sub-headings)
    /// </summary>
    public List<DocumentNode> Children { get; set; } = new List<DocumentNode>();

    /// <summary>
    /// Statistics about this node
    /// </summary>
    public NodeStatistics Statistics { get; set; } = new NodeStatistics();
}

public class NodeStatistics
{
    public int ParagraphCount { get; set; }
    public int TableCount { get; set; }
    public int ImageCount { get; set; }
    public int WordCount { get; set; }
}
