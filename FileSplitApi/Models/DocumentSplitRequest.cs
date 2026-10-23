namespace FileSplitApi.Models;

public class DocumentSplitRequest
{
    /// <summary>
    /// Comma-separated list of heading font sizes (in points).
    /// Only used when AutoDetect is false.
    /// Example: "18, 16, 15, 14, 12, 11"
    /// </summary>
    public string HeadingSizes { get; set; } = "18, 16, 15, 14, 12, 11";

    /// <summary>
    /// Whether to return full document content or just structure
    /// </summary>
    public bool IncludeContent { get; set; } = true;

    /// <summary>
    /// When true, heading levels are auto-detected from document structure
    /// (font size frequency analysis + Word heading styles) instead of using HeadingSizes.
    /// </summary>
    public bool AutoDetect { get; set; } = true;
}
