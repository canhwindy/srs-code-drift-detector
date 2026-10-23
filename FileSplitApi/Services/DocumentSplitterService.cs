using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using FileSplitApi.Models;
using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using A = DocumentFormat.OpenXml.Drawing;

namespace FileSplitApi.Services;

public class DocumentSplitterService : IDocumentSplitterService
{
    public async Task<DocumentSplitResponse> SplitDocumentAsync(
        Stream fileStream,
        string fileName,
        DocumentSplitRequest request)
    {
        var stopwatch = Stopwatch.StartNew();
        var response = new DocumentSplitResponse
        {
            FileName = fileName
        };

        try
        {
            // Create a copy of the stream since we need to read it
            using var memoryStream = new MemoryStream();
            await fileStream.CopyToAsync(memoryStream);
            memoryStream.Position = 0;

            // Offload CPU-bound OpenXml processing to a background thread
            // so the ASP.NET request thread is freed for other requests
            await Task.Run(() =>
            {
                using var document = WordprocessingDocument.Open(memoryStream, false);

                if (document.MainDocumentPart == null)
                {
                    throw new InvalidOperationException("Document has no main part");
                }

                var body = document.MainDocumentPart.Document.Body;
                if (body == null)
                {
                    throw new InvalidOperationException("Document body is null");
                }

                List<double> detectedHeadingLevels;
                Dictionary<string, int>? styleLevelMap = null;

                if (request.AutoDetect)
                {
                    // Auto-detect heading levels from document structure
                    var (autoSizes, levelInfos, bodySize, styleMap) = AutoDetectHeadingLevels(body, document);
                    detectedHeadingLevels = autoSizes;
                    styleLevelMap = styleMap;
                    response.DetectedHeadingLevels = levelInfos;
                    response.BodyTextFontSize = bodySize;

                    if (!detectedHeadingLevels.Any() && (styleLevelMap == null || !styleLevelMap.Any()))
                    {
                        response.Warnings.Add("No headings detected in document. The document may not have distinct heading sizes or Word heading styles.");
                    }
                }
                else
                {
                    // Legacy mode: use provided heading sizes
                    var headingSizesStr = request.HeadingSizes.Split(',')
                        .Select(s => s.Trim())
                        .Where(s => !string.IsNullOrEmpty(s))
                        .ToList();

                    if (!headingSizesStr.Any())
                    {
                        throw new ArgumentException("No heading sizes provided");
                    }

                    var headingSizes = headingSizesStr.Select(double.Parse).ToList();
                    detectedHeadingLevels = DetectHeadingLevels(body, headingSizes);

                    if (!detectedHeadingLevels.Any())
                    {
                        response.Warnings.Add("No headings detected in document");
                    }
                }

                // Step 2: Parse document into hierarchical structure
                var documentTree = ParseDocument(body, detectedHeadingLevels, request.IncludeContent, styleLevelMap);

                response.DocumentTree = documentTree;
                response.Statistics = CalculateStatistics(documentTree);
                response.Success = true;
            });

            stopwatch.Stop();
            response.Statistics.ProcessingTimeMs = stopwatch.Elapsed.TotalMilliseconds;

            return response;
        }
        catch (Exception ex)
        {
            stopwatch.Stop();
            response.Success = false;
            response.ErrorMessage = ex is OpenXmlPackageException
                ? "The uploaded file is not a valid DOCX package. If this file was originally .doc, please convert it to .docx in Microsoft Word and upload again."
                : ex.Message;
            response.Statistics.ProcessingTimeMs = stopwatch.Elapsed.TotalMilliseconds;
            return response;
        }
    }

    /// <summary>
    /// Detect which heading levels are actually used in the document (legacy mode with configured sizes)
    /// </summary>
    private List<double> DetectHeadingLevels(Body body, List<double> configuredSizes)
    {
        var detectedSizes = new HashSet<double>();

        foreach (var paragraph in body.Descendants<Paragraph>())
        {
            var fontSize = GetFontSize(paragraph);
            if (fontSize.HasValue && configuredSizes.Contains(fontSize.Value))
            {
                detectedSizes.Add(fontSize.Value);
            }
        }

        // Return sorted descending (largest font = highest level)
        return detectedSizes.OrderByDescending(s => s).ToList();
    }

    /// <summary>
    /// Auto-detect heading levels from document without requiring a predefined list.
    /// Uses font-size frequency analysis and Word built-in style detection.
    /// </summary>
    private (List<double> headingSizes, List<HeadingLevelInfo> levelInfos, double? bodyFontSize, Dictionary<string, int>? styleLevelMap)
        AutoDetectHeadingLevels(Body body, WordprocessingDocument document)
    {
        // Step 1: Collect font sizes and style info for all non-empty paragraphs
        var fontSizeFrequency = new Dictionary<double, int>();
        var styleLevelParagraphs = new Dictionary<int, int>(); // style heading level -> paragraph count
        var styleLevelFontSizes = new Dictionary<int, double?>(); // style heading level -> font size (first seen)
        var styleIdToLevel = new Dictionary<string, int>(); // style ID -> heading level (for ParseDocument)

        foreach (var paragraph in body.Descendants<Paragraph>())
        {
            var text = GetParagraphText(paragraph);
            if (string.IsNullOrWhiteSpace(text)) continue;

            var fontSize = GetFontSize(paragraph);

            // Check for Word built-in heading styles
            var styleId = paragraph.ParagraphProperties?.ParagraphStyleId?.Val?.Value;
            int? styleLevel = ParseHeadingStyleLevel(styleId);

            if (styleLevel.HasValue && styleId != null)
            {
                if (!styleLevelParagraphs.ContainsKey(styleLevel.Value))
                    styleLevelParagraphs[styleLevel.Value] = 0;
                styleLevelParagraphs[styleLevel.Value]++;

                if (!styleIdToLevel.ContainsKey(styleId))
                    styleIdToLevel[styleId] = styleLevel.Value;

                // Track font size associated with this style level
                if (fontSize.HasValue && !styleLevelFontSizes.ContainsKey(styleLevel.Value))
                    styleLevelFontSizes[styleLevel.Value] = fontSize.Value;
            }

            // Track all font sizes for frequency analysis
            if (fontSize.HasValue)
            {
                if (!fontSizeFrequency.ContainsKey(fontSize.Value))
                    fontSizeFrequency[fontSize.Value] = 0;
                fontSizeFrequency[fontSize.Value]++;
            }
        }

        // Try resolving missing style font sizes from StyleDefinitionsPart
        if (styleLevelFontSizes.Any(kv => !kv.Value.HasValue) &&
            document.MainDocumentPart?.StyleDefinitionsPart?.Styles != null)
        {
            foreach (var style in document.MainDocumentPart.StyleDefinitionsPart.Styles.Elements<Style>())
            {
                var level = ParseHeadingStyleLevel(style.StyleId?.Value);
                if (level.HasValue && styleLevelFontSizes.ContainsKey(level.Value) && !styleLevelFontSizes[level.Value].HasValue)
                {
                    var fs = style.StyleRunProperties?.FontSize?.Val?.Value;
                    if (fs != null && double.TryParse(fs, out double halfPoints))
                    {
                        styleLevelFontSizes[level.Value] = halfPoints / 2.0;
                    }
                }
            }
        }

        var levelInfos = new List<HeadingLevelInfo>();
        var headingSizes = new List<double>();
        double? bodyFontSize = null;

        // --- Font-size-based detection ---
        if (fontSizeFrequency.Count >= 2)
        {
            // The most frequent font size is body text
            bodyFontSize = fontSizeFrequency
                .OrderByDescending(kv => kv.Value)
                .ThenBy(kv => kv.Key) // tie-break: smaller size is more likely body text
                .First().Key;

            // Heading candidates: sizes STRICTLY LARGER than body text
            var headingCandidates = fontSizeFrequency
                .Where(kv => kv.Key > bodyFontSize.Value)
                .OrderByDescending(kv => kv.Key)
                .ToList();

            int level = 1;
            foreach (var candidate in headingCandidates)
            {
                headingSizes.Add(candidate.Key);
                levelInfos.Add(new HeadingLevelInfo
                {
                    Level = level,
                    FontSize = candidate.Key,
                    ParagraphCount = candidate.Value,
                    DetectionMethod = "FontSize"
                });
                level++;
            }
        }
        else if (fontSizeFrequency.Count == 1)
        {
            // Only one font size in entire document - everything is body text
            bodyFontSize = fontSizeFrequency.Keys.First();
        }

        // --- Style-based detection (supplement or replace font-size detection) ---
        if (styleLevelParagraphs.Any())
        {
            foreach (var kvp in styleLevelParagraphs.OrderBy(kv => kv.Key))
            {
                int styleLevel = kvp.Key;
                double? styleFontSize = styleLevelFontSizes.ContainsKey(styleLevel)
                    ? styleLevelFontSizes[styleLevel] : null;

                // Check if this font size is already covered by font-size detection
                bool alreadyCoveredByFontSize = styleFontSize.HasValue &&
                    levelInfos.Any(li => li.FontSize.HasValue && Math.Abs(li.FontSize.Value - styleFontSize.Value) < 0.1);

                if (alreadyCoveredByFontSize)
                {
                    // Mark existing level as detected by both methods
                    var existing = levelInfos.First(li => li.FontSize.HasValue && Math.Abs(li.FontSize.Value - styleFontSize!.Value) < 0.1);
                    existing.StyleName = $"Heading{styleLevel}";
                    existing.DetectionMethod = "Both";
                }
                else
                {
                    // Add as a new level from style detection
                    if (styleFontSize.HasValue && !headingSizes.Contains(styleFontSize.Value))
                    {
                        headingSizes.Add(styleFontSize.Value);
                    }

                    levelInfos.Add(new HeadingLevelInfo
                    {
                        Level = styleLevel,
                        FontSize = styleFontSize,
                        StyleName = $"Heading{styleLevel}",
                        ParagraphCount = kvp.Value,
                        DetectionMethod = "Style"
                    });
                }
            }
        }

        // Sort heading sizes descending (largest = level 1) and re-normalize level numbers
        headingSizes = headingSizes.OrderByDescending(s => s).ToList();
        levelInfos = levelInfos.OrderByDescending(li => li.FontSize ?? 0).ToList();
        for (int i = 0; i < levelInfos.Count; i++)
        {
            levelInfos[i].Level = i + 1;
        }

        // Build styleLevelMap for ParseDocument: maps style ID -> level index in headingSizes
        Dictionary<string, int>? resultStyleMap = null;
        if (styleIdToLevel.Any())
        {
            resultStyleMap = new Dictionary<string, int>();
            foreach (var kvp in styleIdToLevel)
            {
                var styleFontSize = styleLevelFontSizes.ContainsKey(kvp.Value)
                    ? styleLevelFontSizes[kvp.Value] : null;

                if (styleFontSize.HasValue)
                {
                    var idx = headingSizes.IndexOf(styleFontSize.Value);
                    if (idx >= 0)
                    {
                        resultStyleMap[kvp.Key] = idx;
                    }
                }
                else
                {
                    // Style without font size - map by relative level position
                    // Find the first available level index based on style level ordering
                    var sortedStyleLevels = styleIdToLevel.Values.Distinct().OrderBy(v => v).ToList();
                    var relativeIdx = sortedStyleLevels.IndexOf(kvp.Value);
                    if (relativeIdx >= 0 && relativeIdx + headingSizes.Count < 10)
                    {
                        resultStyleMap[kvp.Key] = headingSizes.Count + relativeIdx;
                    }
                }
            }
        }

        return (headingSizes, levelInfos, bodyFontSize, resultStyleMap);
    }

    /// <summary>
    /// Parse a Word style ID to determine if it's a heading style, returning the level number.
    /// Handles: "Heading1", "heading1", "Heading 1", etc.
    /// </summary>
    private int? ParseHeadingStyleLevel(string? styleId)
    {
        if (string.IsNullOrEmpty(styleId)) return null;

        var normalized = styleId.ToLowerInvariant().Trim();

        // Pattern: "heading1" through "heading9" or "heading 1" through "heading 9"
        if (normalized.StartsWith("heading"))
        {
            var remainder = normalized.Substring("heading".Length).Trim();
            if (int.TryParse(remainder, out int level) && level >= 1 && level <= 9)
            {
                return level;
            }
        }

        return null;
    }

    /// <summary>
    /// Parse document body into hierarchical document tree
    /// Uses multi-level content stacks to correctly distribute content (matching WPF behavior)
    /// </summary>
    private List<DocumentNode> ParseDocument(Body body, List<double> headingLevels, bool includeContent, Dictionary<string, int>? styleLevelMap = null)
    {
        int maxDepth = headingLevels.Count;

        // If we have style-only headings that extend beyond font-size-based levels, expand maxDepth
        if (styleLevelMap != null && styleLevelMap.Any())
        {
            var maxStyleIdx = styleLevelMap.Values.Max();
            if (maxStyleIdx >= maxDepth)
                maxDepth = maxStyleIdx + 1;
        }

        if (maxDepth == 0)
            return ParseDocumentWithoutHeadings(body, includeContent);

        var rootNodes = new List<DocumentNode>();

        // Track current heading at each level
        var currentNodes = new DocumentNode?[maxDepth];

        // Track content builders for each level
        var contentBuilders = new StringBuilder[maxDepth];
        for (int i = 0; i < maxDepth; i++)
        {
            contentBuilders[i] = new StringBuilder();
        }

        // Track parent references for building hierarchy
        var parentNodes = new DocumentNode?[maxDepth];

        var bodyElements = body.ChildElements.Where(e => e is Paragraph || e is Table).ToList();

        // Helper function to save content at a specific level
        void SaveContentAtLevel(int levelIdx)
        {
            if (currentNodes[levelIdx] != null && includeContent && contentBuilders[levelIdx].Length > 0)
            {
                var content = contentBuilders[levelIdx].ToString().Trim();
                currentNodes[levelIdx]!.ContentMarkdown = content;
                contentBuilders[levelIdx].Clear();
            }
        }

        foreach (var element in bodyElements)
        {
            if (element is Paragraph paragraph)
            {
                var text = GetParagraphText(paragraph);
                var fontSize = GetFontSize(paragraph);

                // Check if this paragraph is a heading (by font size or by Word heading style)
                int levelIdx = -1;

                if (fontSize.HasValue && headingLevels.Contains(fontSize.Value))
                {
                    levelIdx = headingLevels.IndexOf(fontSize.Value);
                }
                else if (styleLevelMap != null)
                {
                    var styleId = paragraph.ParagraphProperties?.ParagraphStyleId?.Val?.Value;
                    if (styleId != null && styleLevelMap.ContainsKey(styleId))
                    {
                        levelIdx = styleLevelMap[styleId];
                    }
                }

                if (levelIdx >= 0 && levelIdx < maxDepth)
                {
                    var level = levelIdx + 1;
                    var isDeepestLevel = (levelIdx == maxDepth - 1);

                    // Special rule for deepest level: must start with number to be a heading
                    if (isDeepestLevel && maxDepth >= 2 && !StartsWithNumber(text))
                    {
                        // This is content, not a heading - add to deepest active level
                        for (int i = maxDepth - 1; i >= 0; i--)
                        {
                            if (currentNodes[i] != null)
                            {
                                currentNodes[i]!.Statistics.ParagraphCount++;

                                // Count images
                                var imageCount = paragraph.Descendants<A.Blip>().Count();
                                currentNodes[i]!.Statistics.ImageCount += imageCount;

                                if (includeContent)
                                {
                                    var formattedText = GetParagraphMarkdown(paragraph);
                                    if (!string.IsNullOrWhiteSpace(formattedText))
                                    {
                                        contentBuilders[i].AppendLine(formattedText);
                                        contentBuilders[i].AppendLine();
                                    }
                                }
                                break;
                            }
                        }
                        continue;
                    }

                    // This is a heading - save content for this level and all deeper levels
                    for (int i = levelIdx; i < maxDepth; i++)
                    {
                        SaveContentAtLevel(i);
                        if (i > levelIdx)
                        {
                            currentNodes[i] = null;
                        }
                    }

                    // Create new node for this heading
                    var newNode = new DocumentNode
                    {
                        Heading = text,
                        Level = level
                    };

                    // Handle hierarchy
                    if (levelIdx == 0)
                    {
                        // Top level - add to root
                        rootNodes.Add(newNode);
                        parentNodes[0] = null;
                    }
                    else
                    {
                        // Child level - add to parent
                        var parentNode = currentNodes[levelIdx - 1];
                        if (parentNode != null)
                        {
                            parentNode.Children.Add(newNode);
                            parentNodes[levelIdx] = parentNode;
                        }
                        else
                        {
                            // No parent found, add to root as orphan
                            rootNodes.Add(newNode);
                        }
                    }

                    currentNodes[levelIdx] = newNode;
                }
                else
                {
                    // This is content paragraph - add to deepest active level only
                    for (int i = maxDepth - 1; i >= 0; i--)
                    {
                        if (currentNodes[i] != null)
                        {
                            currentNodes[i]!.Statistics.ParagraphCount++;

                            // Count images in this paragraph
                            var imageCount = paragraph.Descendants<A.Blip>().Count();
                            currentNodes[i]!.Statistics.ImageCount += imageCount;

                            // Extract content with formatting if enabled
                            if (includeContent)
                            {
                                var formattedText = GetParagraphMarkdown(paragraph);
                                if (!string.IsNullOrWhiteSpace(formattedText))
                                {
                                    contentBuilders[i].AppendLine(formattedText);
                                    contentBuilders[i].AppendLine();
                                }
                            }
                            break; // Only add to deepest active level
                        }
                    }
                }
            }
            else if (element is Table table)
            {
                // Table - add to deepest active level only
                for (int i = maxDepth - 1; i >= 0; i--)
                {
                    if (currentNodes[i] != null)
                    {
                        currentNodes[i]!.Statistics.TableCount++;

                        // Count images in table cells
                        var imageCount = table.Descendants<A.Blip>().Count();
                        currentNodes[i]!.Statistics.ImageCount += imageCount;

                        // Extract table content if enabled
                        if (includeContent)
                        {
                            contentBuilders[i].AppendLine(ExtractTableContent(table));
                            contentBuilders[i].AppendLine();
                        }
                        break; // Only add to deepest active level
                    }
                }
            }
        }

        // Save remaining content for all levels
        for (int i = 0; i < maxDepth; i++)
        {
            SaveContentAtLevel(i);
        }

        return rootNodes;
    }

    /// <summary>
    /// Fallback parser for documents where no heading levels are detected.
    /// Preserves all content by placing it into a single root node.
    /// </summary>
    private List<DocumentNode> ParseDocumentWithoutHeadings(Body body, bool includeContent)
    {
        var rootNode = new DocumentNode
        {
            Heading = "Document",
            Level = 1
        };

        var markdown = new StringBuilder();
        var bodyElements = body.ChildElements.Where(e => e is Paragraph || e is Table).ToList();

        foreach (var element in bodyElements)
        {
            if (element is Paragraph paragraph)
            {
                rootNode.Statistics.ParagraphCount++;
                rootNode.Statistics.ImageCount += paragraph.Descendants<A.Blip>().Count();

                if (includeContent)
                {
                    var formattedText = GetParagraphMarkdown(paragraph);
                    if (!string.IsNullOrWhiteSpace(formattedText))
                    {
                        markdown.AppendLine(formattedText);
                        markdown.AppendLine();
                    }
                }
            }
            else if (element is Table table)
            {
                rootNode.Statistics.TableCount++;
                rootNode.Statistics.ImageCount += table.Descendants<A.Blip>().Count();

                if (includeContent)
                {
                    markdown.AppendLine(ExtractTableContent(table));
                    markdown.AppendLine();
                }
            }
        }

        if (includeContent)
        {
            rootNode.ContentMarkdown = markdown.ToString().Trim();
        }

        return new List<DocumentNode> { rootNode };
    }

    /// <summary>
    /// Known language identifiers for detecting code block markers in callout-box tables.
    /// </summary>
    private static readonly string[] KnownLanguages =
    {
        "yaml", "json", "xml", "html", "css", "javascript", "typescript",
        "python", "java", "csharp", "c#", "sql", "markdown", "md",
        "bash", "shell", "powershell", "ruby", "go", "rust", "php",
        "plaintext", "text", "txt"
    };

    /// <summary>
    /// Try to convert a table to an Outline container_notice block (:::info ... :::).
    /// Detects single-column tables with background shading — a common Word pattern
    /// for "callout boxes" containing AI-generated YAML/Markdown content.
    /// Returns the notice-block markdown, or null if the table is a regular data table.
    /// </summary>
    private string? TryConvertToNoticeBlock(Table table)
    {
        var rows = table.Elements<TableRow>().ToList();
        if (!rows.Any()) return null;

        // Only handle single-column tables (the "callout box" pattern in Word)
        bool isSingleColumn = rows.All(row => row.Elements<TableCell>().Count() == 1);
        if (!isSingleColumn) return null;

        // Check if any cell has background shading (fill color)
        bool hasShading = false;
        foreach (var row in rows)
        {
            var cell = row.Elements<TableCell>().FirstOrDefault();
            if (cell != null)
            {
                var shading = cell.TableCellProperties?.Shading;
                if (shading?.Fill != null)
                {
                    var fill = shading.Fill.Value?.ToUpper() ?? "";
                    if (!string.IsNullOrEmpty(fill) && fill != "AUTO" && fill != "FFFFFF")
                    {
                        hasShading = true;
                        break;
                    }
                }
            }
        }

        if (!hasShading) return null;

        // First pass: extract plain text to detect language marker
        // (plain text avoids **bold** wrapping that breaks language detection)
        var plainContentBuilder = new StringBuilder();
        foreach (var row in rows)
        {
            var cell = row.Elements<TableCell>().FirstOrDefault();
            if (cell == null) continue;
            foreach (var para in cell.Elements<Paragraph>())
            {
                plainContentBuilder.AppendLine(GetParagraphPlainText(para));
            }
        }
        var plainContent = plainContentBuilder.ToString().TrimEnd();
        if (string.IsNullOrWhiteSpace(plainContent)) return null;

        // Detect a language marker on the first non-empty line (e.g. "YAML", "Markdown")
        var plainLines = plainContent.Split('\n');
        var firstNonEmptyIdx = Array.FindIndex(plainLines, l => !string.IsNullOrWhiteSpace(l));
        if (firstNonEmptyIdx < 0) return null;

        var firstLine = plainLines[firstNonEmptyIdx].Trim();
        var detectedLanguage = KnownLanguages.FirstOrDefault(lang =>
            string.Equals(firstLine, lang, StringComparison.OrdinalIgnoreCase));

        var sb = new StringBuilder();
        sb.AppendLine();
        sb.AppendLine(":::info");

        if (detectedLanguage != null)
        {
            // Language detected — use PLAIN TEXT (no markdown formatting)
            // to preserve YAML/code structure (indentation, special chars)
            var remainingLines = plainLines.Where((_, idx) => idx != firstNonEmptyIdx);
            var codeContent = string.Join("\n", remainingLines).Trim();

            // Normalize language name for the code fence
            var langName = detectedLanguage.ToLower();
            if (langName == "c#") langName = "csharp";
            if (langName == "md") langName = "markdown";
            if (langName == "txt" || langName == "text") langName = "plaintext";

            sb.AppendLine($"```{langName}");
            sb.AppendLine(codeContent);
            sb.AppendLine("```");
        }
        else
        {
            // No language marker — use markdown-formatted content
            var markdownContentBuilder = new StringBuilder();
            foreach (var row in rows)
            {
                var cell = row.Elements<TableCell>().FirstOrDefault();
                if (cell == null) continue;
                foreach (var para in cell.Elements<Paragraph>())
                {
                    markdownContentBuilder.AppendLine(GetParagraphMarkdown(para));
                }
            }
            sb.AppendLine(markdownContentBuilder.ToString().TrimEnd());
        }

        sb.AppendLine(":::");
        return sb.ToString();
    }

    /// <summary>
    /// Extract table content as markdown with formatting.
    /// First tries to convert callout-box-style tables (single-column with shading)
    /// into Outline container_notice blocks. Falls back to standard markdown table format.
    /// </summary>
    private string ExtractTableContent(Table table)
    {
        // Try notice-block conversion for callout-box tables
        var noticeBlock = TryConvertToNoticeBlock(table);
        if (noticeBlock != null) return noticeBlock;

        // Standard markdown table conversion
        var tableBuilder = new StringBuilder();
        var rows = table.Elements<TableRow>().ToList();

        if (!rows.Any()) return string.Empty;

        // Process each row
        foreach (var row in rows)
        {
            var cells = row.Elements<TableCell>().ToList();
            var cellTexts = cells.Select(cell =>
            {
                // Extract formatted text from each cell
                var cellContent = new StringBuilder();
                var paragraphs = cell.Elements<Paragraph>().ToList();
                for (int i = 0; i < paragraphs.Count; i++)
                {
                    var formattedText = GetParagraphMarkdown(paragraphs[i]);
                    if (!string.IsNullOrWhiteSpace(formattedText))
                    {
                        cellContent.Append(formattedText);
                        // Add line breaks within table cells
                        // Use <br> HTML tag (works better in table context than Markdown syntax)
                        if (i < paragraphs.Count - 1)
                        {
                            cellContent.Append("<br>");
                        }
                    }
                }
                return cellContent.ToString().Trim();
            }).ToList();

            tableBuilder.AppendLine("| " + string.Join(" | ", cellTexts) + " |");

            // Add separator after first row (header)
            if (row == rows.First())
            {
                var separators = cellTexts.Select(_ => "---");
                tableBuilder.AppendLine("| " + string.Join(" | ", separators) + " |");
            }
        }

        return tableBuilder.ToString();
    }

    /// <summary>
    /// Calculate overall statistics from document tree
    /// </summary>
    private SplitStatistics CalculateStatistics(List<DocumentNode> tree)
    {
        var stats = new SplitStatistics();
        CalculateStatsRecursive(tree, stats, 1);
        return stats;
    }

    private void CalculateStatsRecursive(List<DocumentNode> nodes, SplitStatistics stats, int depth)
    {
        foreach (var node in nodes)
        {
            stats.TotalNodes++;
            stats.MaxDepth = Math.Max(stats.MaxDepth, depth);
            stats.TotalParagraphs += node.Statistics.ParagraphCount;
            stats.TotalTables += node.Statistics.TableCount;
            stats.TotalImages += node.Statistics.ImageCount;

            if (node.Children.Any())
            {
                CalculateStatsRecursive(node.Children, stats, depth + 1);
            }
        }
    }

    /// <summary>
    /// Get font size of a paragraph (in points)
    /// </summary>
    private double? GetFontSize(Paragraph paragraph)
    {
        var runProps = paragraph.Descendants<RunProperties>().FirstOrDefault();
        if (runProps != null)
        {
            var fontSize = runProps.FontSize;
            if (fontSize?.Val != null)
            {
                // OpenXML stores font size in half-points (e.g., 36 = 18pt)
                var rawValue = fontSize.Val.Value;
                if (!string.IsNullOrWhiteSpace(rawValue) &&
                    double.TryParse(rawValue, out var halfPoints))
                {
                    return halfPoints / 2.0;
                }
            }
        }

        // Try paragraph properties (ParagraphMarkRunProperties doesn't have FontSize in all versions)
        // Skip this check as it's not reliable
        // var paraProps = paragraph.ParagraphProperties;
        // if (paraProps != null)
        // {
        //     var pRunProps = paraProps.ParagraphMarkRunProperties;
        //     if (pRunProps != null)
        //     {
        //         var fontSize = pRunProps.FontSize;
        //         if (fontSize?.Val != null)
        //         {
        //             var halfPoints = double.Parse(fontSize.Val.Value);
        //             return halfPoints / 2.0;
        //         }
        //     }
        // }

        return null;
    }

    /// <summary>
    /// Get plain text from paragraph (for heading detection)
    /// </summary>
    private string GetParagraphText(Paragraph paragraph)
    {
        var sb = new StringBuilder();
        foreach (var text in paragraph.Descendants<Text>())
        {
            sb.Append(text.Text);
        }
        return sb.ToString().Trim();
    }

    /// <summary>
    /// Get plain text from paragraph preserving whitespace/indentation.
    /// No bold/italic/underline markers, no list prefixes, no HTML tags.
    /// Used for content that goes inside code fences where formatting would corrupt syntax.
    /// </summary>
    private string GetParagraphPlainText(Paragraph paragraph)
    {
        var sb = new StringBuilder();
        foreach (var run in paragraph.Elements<Run>())
        {
            foreach (var child in run.ChildElements)
            {
                if (child is Text textElement)
                {
                    if (!string.IsNullOrEmpty(textElement.Text))
                    {
                        sb.Append(textElement.Text);
                    }
                }
                else if (child is Break)
                {
                    sb.Append('\n');
                }
            }
        }
        return sb.ToString();
    }

    /// <summary>
    /// Get formatted text from paragraph with Markdown syntax
    /// </summary>
    private string GetParagraphMarkdown(Paragraph paragraph)
    {
        var sb = new StringBuilder();

        // Check if this is a list item
        var numProp = paragraph.ParagraphProperties?.NumberingProperties;
        if (numProp != null)
        {
            // This is a list item
            var ilvl = numProp.NumberingLevelReference?.Val?.Value ?? 0;
            var indent = new string(' ', ilvl * 2);
            sb.Append(indent);

            // Determine if bullet or numbered list
            var numId = numProp.NumberingId?.Val?.Value;
            if (numId.HasValue)
            {
                sb.Append("- "); // Default to bullet, could enhance to detect numbered
            }
        }

        foreach (var run in paragraph.Elements<Run>())
        {
            var runProps = run.RunProperties;

            // Process all child elements in order (text, breaks, images, etc.)
            foreach (var child in run.ChildElements)
            {
                if (child is Text textElement)
                {
                    var text = textElement.Text;
                    if (!string.IsNullOrEmpty(text))
                    {
                        // Apply formatting
                        bool isBold = runProps?.Bold?.Val?.Value ?? false;
                        bool isItalic = runProps?.Italic?.Val?.Value ?? false;
                        bool isUnderline = runProps?.Underline != null;

                        if (isBold && isItalic)
                        {
                            sb.Append($"***{text}***");
                        }
                        else if (isBold)
                        {
                            sb.Append($"**{text}**");
                        }
                        else if (isItalic)
                        {
                            sb.Append($"*{text}*");
                        }
                        else if (isUnderline)
                        {
                            // Use double underscore for underline (Outline supports this)
                            sb.Append($"__{text}__");
                        }
                        else
                        {
                            sb.Append(text);
                        }
                    }
                }
                else if (child is Break)
                {
                    // Handle line breaks within paragraph (Shift+Enter in Word)
                    sb.Append("<br>");
                }
                else if (child is DocumentFormat.OpenXml.Wordprocessing.Drawing)
                {
                    // Check for images
                    var drawing = run.Descendants<DocumentFormat.OpenXml.Drawing.Blip>().FirstOrDefault();
                    if (drawing != null)
                    {
                        var imageData = ExtractImageFromDrawing(run);
                        if (!string.IsNullOrEmpty(imageData))
                        {
                            sb.Append(imageData);
                        }
                    }
                }
            }
        }

        return sb.ToString().Trim();
    }

    /// <summary>
    /// Extract image from drawing element
    /// </summary>
    private string ExtractImageFromDrawing(Run run)
    {
        try
        {
            var drawing = run.Descendants<DocumentFormat.OpenXml.Drawing.Blip>().FirstOrDefault();
            if (drawing?.Embed?.Value == null)
                return string.Empty;

            var embedId = drawing.Embed.Value;
            var mainPart = run.Ancestors<Document>().FirstOrDefault()?.MainDocumentPart;
            if (mainPart == null)
                return string.Empty;

            var imagePart = mainPart.GetPartById(embedId);
            if (imagePart == null)
                return string.Empty;

            using (var stream = imagePart.GetStream())
            using (var memoryStream = new MemoryStream())
            {
                stream.CopyTo(memoryStream);
                var imageBytes = memoryStream.ToArray();
                var base64 = Convert.ToBase64String(imageBytes);

                // Determine image type
                var contentType = imagePart.ContentType;
                var mimeType = contentType switch
                {
                    "image/png" => "image/png",
                    "image/jpeg" => "image/jpeg",
                    "image/jpg" => "image/jpeg",
                    "image/gif" => "image/gif",
                    "image/bmp" => "image/bmp",
                    _ => "image/png"
                };

                return $"\n\n![Image](data:{mimeType};base64,{base64})\n\n";
            }
        }
        catch
        {
            return "[Image extraction failed]";
        }
    }

    /// <summary>
    /// Check if text starts with a number pattern (1., 2.1, 3.2.1, etc.)
    /// </summary>
    private bool StartsWithNumber(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return false;

        // Match patterns like: "1.", "2.1", "3.2.1.", "1)", "2-1", etc.
        var pattern = @"^\s*\d+([.\-)\s]\d+)*[.\-)\s]";
        return Regex.IsMatch(text, pattern);
    }
}
