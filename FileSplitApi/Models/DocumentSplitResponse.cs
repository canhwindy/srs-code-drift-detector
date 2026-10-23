namespace FileSplitApi.Models;

/// <summary>
/// Response from document splitting operation
/// </summary>
public class DocumentSplitResponse
{
    /// <summary>
    /// Original filename
    /// </summary>
    public string FileName { get; set; } = string.Empty;

    /// <summary>
    /// Root node of the document tree
    /// </summary>
    public List<DocumentNode> DocumentTree { get; set; } = new List<DocumentNode>();

    /// <summary>
    /// Overall statistics
    /// </summary>
    public SplitStatistics Statistics { get; set; } = new SplitStatistics();

    /// <summary>
    /// Detected heading levels with their font sizes/styles (auto-detected from document)
    /// </summary>
    public List<HeadingLevelInfo> DetectedHeadingLevels { get; set; } = new List<HeadingLevelInfo>();

    /// <summary>
    /// The detected body text font size (most frequent size in the document)
    /// </summary>
    public double? BodyTextFontSize { get; set; }

    /// <summary>
    /// Any warnings encountered during splitting
    /// </summary>
    public List<string> Warnings { get; set; } = new List<string>();

    /// <summary>
    /// Whether the operation was successful
    /// </summary>
    public bool Success { get; set; } = true;

    /// <summary>
    /// Error message if operation failed
    /// </summary>
    public string? ErrorMessage { get; set; }
}

/// <summary>
/// Information about a detected heading level
/// </summary>
public class HeadingLevelInfo
{
    public int Level { get; set; }
    public double? FontSize { get; set; }
    public string? StyleName { get; set; }
    public int ParagraphCount { get; set; }
    /// <summary>
    /// How this level was detected: "FontSize", "Style", or "Both"
    /// </summary>
    public string DetectionMethod { get; set; } = "FontSize";
}

public class SplitStatistics
{
    public int TotalNodes { get; set; }
    public int MaxDepth { get; set; }
    public int TotalParagraphs { get; set; }
    public int TotalTables { get; set; }
    public int TotalImages { get; set; }
    public DateTime ProcessedAt { get; set; } = DateTime.UtcNow;
    public double ProcessingTimeMs { get; set; }
}
