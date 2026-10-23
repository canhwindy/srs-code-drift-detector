using System.IO;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using A = DocumentFormat.OpenXml.Drawing;
using DW = DocumentFormat.OpenXml.Drawing.Wordprocessing;
using PIC = DocumentFormat.OpenXml.Drawing.Pictures;

namespace FileSplitApi;

/// <summary>
/// Represents a block element in the document (paragraph or table).
/// </summary>
public class BlockElement
{
    public OpenXmlElement Element { get; set; } = null!;
    public bool IsParagraph => Element is Paragraph;
    public bool IsTable => Element is Table;
}

/// <summary>
/// Represents a node in the document heading structure.
/// </summary>
public class HeadingNode
{
    public string Heading { get; set; } = "";
    public Paragraph? HeadingParagraph { get; set; }
    public List<BlockElement> Content { get; set; } = new();
    public Dictionary<string, HeadingNode> Children { get; set; } = new();

    public bool HasSubHeadings => Children.Count > 0;
}

/// <summary>
/// Splits a .docx document into multiple .docx files based on heading font sizes.
/// Port of the Python DocumentSplitterFinal class.
/// </summary>
public class DocumentSplitter
{
    private readonly string _inputFile;
    private readonly string _outputDir;
    private readonly List<double> _headingSizes;
    private readonly Action<string> _log;
    private readonly Action<int> _setProgress;

    public DocumentSplitter(string inputFile, string outputDir, List<double> headingSizes,
        Action<string> log, Action<int> setProgress)
    {
        _inputFile = inputFile;
        _outputDir = outputDir;
        _headingSizes = headingSizes;
        _log = log;
        _setProgress = setProgress;
    }

    /// <summary>
    /// Get the primary font size (in pt) of a paragraph.
    /// OpenXml stores font size in half-points, so we divide by 2.
    /// </summary>
    private double? GetFontSize(Paragraph paragraph)
    {
        // Check runs first
        foreach (var run in paragraph.Elements<Run>())
        {
            var rp = run.RunProperties;
            if (rp?.FontSize?.Val != null)
            {
                return double.Parse(rp.FontSize.Val!) / 2.0;
            }
        }

        // Check paragraph style's run properties
        var pPr = paragraph.ParagraphProperties;
        if (pPr?.ParagraphMarkRunProperties != null)
        {
            var fontSize = pPr.ParagraphMarkRunProperties.Elements<FontSize>().FirstOrDefault();
            if (fontSize?.Val != null)
            {
                return double.Parse(fontSize.Val!) / 2.0;
            }
        }

        return null;
    }

    /// <summary>
    /// Get the text content of a paragraph.
    /// </summary>
    private static string GetText(Paragraph paragraph)
    {
        return paragraph.InnerText?.Trim() ?? "";
    }

    /// <summary>
    /// Check if text starts with a numbering pattern (e.g. "1.", "2.2.1", "3)").
    /// Used to distinguish real section headings from sub-section labels like "Description:", "Activity Flows:".
    /// </summary>
    private static bool StartsWithNumberPattern(string text)
    {
        if (string.IsNullOrEmpty(text)) return false;
        return char.IsDigit(text[0]);
    }

    /// <summary>
    /// Detect which of the configured heading sizes actually appear in the document.
    /// </summary>
    private List<double> DetectHeadingLevels(WordprocessingDocument doc)
    {
        var foundSizes = new HashSet<double>();
        var body = doc.MainDocumentPart!.Document.Body!;

        foreach (var para in body.Elements<Paragraph>())
        {
            var text = GetText(para);
            if (string.IsNullOrEmpty(text)) continue;

            var size = GetFontSize(para);
            if (size.HasValue && _headingSizes.Contains(size.Value))
            {
                foundSizes.Add(size.Value);
            }
        }

        return foundSizes.OrderByDescending(s => s).ToList();
    }

    /// <summary>
    /// Iterate all block-level elements (paragraphs and tables) in order.
    /// </summary>
    private static List<BlockElement> IterBlockItems(Body body)
    {
        var items = new List<BlockElement>();
        foreach (var child in body.ChildElements)
        {
            if (child is Paragraph || child is Table)
            {
                items.Add(new BlockElement { Element = child });
            }
        }
        return items;
    }

    /// <summary>
    /// Parse the document into a hierarchical structure based on heading levels.
    /// </summary>
    private Dictionary<string, HeadingNode> ParseDocument(WordprocessingDocument doc, List<double> headingLevels)
    {
        int maxDepth = headingLevels.Count;
        var structure = new Dictionary<string, HeadingNode>();
        var currentPath = new string?[maxDepth];
        var currentHeadingParas = new Paragraph?[maxDepth];
        var currentRefs = new Dictionary<string, HeadingNode>[maxDepth];
        var contentStacks = new List<BlockElement>[maxDepth];

        for (int i = 0; i < maxDepth; i++)
        {
            currentRefs[i] = structure;
            contentStacks[i] = new List<BlockElement>();
        }

        _log($"\nDetected {maxDepth} heading levels: {string.Join(", ", headingLevels)}");
        _log("Files will be created at the deepest level of each branch");
        _log(new string('-', 70));

        void SaveContentAtLevel(int levelIdx)
        {
            if (currentPath[levelIdx] != null && contentStacks[levelIdx].Count > 0)
            {
                var heading = currentPath[levelIdx]!;
                var parentRef = currentRefs[levelIdx];

                if (!parentRef.ContainsKey(heading))
                {
                    parentRef[heading] = new HeadingNode { Heading = heading };
                }

                parentRef[heading].Content = new List<BlockElement>(contentStacks[levelIdx]);
                if (currentHeadingParas[levelIdx] != null)
                {
                    parentRef[heading].HeadingParagraph = currentHeadingParas[levelIdx];
                }
                contentStacks[levelIdx] = new List<BlockElement>();
            }
        }

        var body = doc.MainDocumentPart!.Document.Body!;
        var blockItems = IterBlockItems(body);

        foreach (var block in blockItems)
        {
            if (block.IsParagraph)
            {
                var para = (Paragraph)block.Element;
                var text = GetText(para);
                var fontSize = GetFontSize(para);

                if (string.IsNullOrEmpty(text))
                {
                    // Empty paragraph - add to the deepest active level only
                    for (int i = maxDepth - 1; i >= 0; i--)
                    {
                        if (currentPath[i] != null)
                        {
                            contentStacks[i].Add(block);
                            break;
                        }
                    }
                    continue;
                }

                if (fontSize.HasValue && headingLevels.Contains(fontSize.Value))
                {
                    int levelIdx = headingLevels.IndexOf(fontSize.Value);

                    // At the deepest heading level (when there are 2+ levels), only treat as a
                    // heading if the text starts with a number pattern (e.g. "2.2.1 Feature").
                    // Non-numbered text like "Description:", "Activity Flows:", "Business Rules:"
                    // is treated as content of the previous numbered heading.
                    if (levelIdx == maxDepth - 1 && maxDepth >= 2 && !StartsWithNumberPattern(text))
                    {
                        // Add this paragraph as content (including its heading formatting)
                        for (int i = maxDepth - 1; i >= 0; i--)
                        {
                            if (currentPath[i] != null)
                            {
                                contentStacks[i].Add(block);
                                break;
                            }
                        }

                        var skipIndent = new string(' ', levelIdx * 2);
                        _log($"{skipIndent}  (content) {text}");
                        continue;
                    }

                    // Save content for this level and all deeper levels
                    for (int i = levelIdx; i < maxDepth; i++)
                    {
                        SaveContentAtLevel(i);
                        if (i > levelIdx)
                        {
                            currentPath[i] = null;
                            currentHeadingParas[i] = null;
                        }
                    }

                    currentPath[levelIdx] = text;
                    currentHeadingParas[levelIdx] = para;

                    // Set reference for this level
                    if (levelIdx == 0)
                    {
                        currentRefs[0] = structure;
                    }
                    else
                    {
                        var parentHeading = currentPath[levelIdx - 1];
                        var parentRef = currentRefs[levelIdx - 1];
                        if (parentHeading != null && !parentRef.ContainsKey(parentHeading))
                        {
                            parentRef[parentHeading] = new HeadingNode { Heading = parentHeading };
                        }
                        if (parentHeading != null)
                        {
                            currentRefs[levelIdx] = parentRef[parentHeading].Children;
                        }
                    }

                    // Update references for deeper levels
                    for (int i = levelIdx + 1; i < maxDepth; i++)
                    {
                        var currentHeading = currentPath[levelIdx]!;
                        if (!currentRefs[levelIdx].ContainsKey(currentHeading))
                        {
                            currentRefs[levelIdx][currentHeading] = new HeadingNode { Heading = currentHeading };
                        }
                        currentRefs[i] = currentRefs[levelIdx][currentHeading].Children;
                    }

                    var indent = new string(' ', levelIdx * 2);
                    _log($"{indent}L{levelIdx + 1} ({fontSize}pt): {text}");
                }
                else
                {
                    // Regular content - add to the deepest active level only
                    for (int i = maxDepth - 1; i >= 0; i--)
                    {
                        if (currentPath[i] != null)
                        {
                            contentStacks[i].Add(block);
                            break;
                        }
                    }
                }
            }
            else if (block.IsTable)
            {
                // Table - add to the deepest active level only
                for (int i = maxDepth - 1; i >= 0; i--)
                {
                    if (currentPath[i] != null)
                    {
                        contentStacks[i].Add(block);
                        break;
                    }
                }
            }
        }

        // Save remaining content
        for (int i = 0; i < maxDepth; i++)
        {
            SaveContentAtLevel(i);
        }

        return structure;
    }

    /// <summary>
    /// Sanitize a string for use as a file/folder name.
    /// maxLength controls the maximum allowed name length.
    /// </summary>
    private static string SanitizeName(string name, int maxLength = 80)
    {
        name = (name ?? "").Trim();
        char[] invalidChars = Path.GetInvalidFileNameChars();
        foreach (char c in invalidChars)
        {
            name = name.Replace(c, '_');
        }
        name = name.TrimEnd('.', ' ');
        if (name.Length > maxLength)
            name = name[..maxLength].TrimEnd('.', ' ', '_');
        return string.IsNullOrEmpty(name) ? "unnamed" : name;
    }

    /// <summary>
    /// Truncate a name so the full path does not exceed Windows MAX_PATH (260).
    /// Returns a shortened name if necessary.
    /// </summary>
    private static string FitNameToPathLimit(string basePath, string name, string? extension = null)
    {
        const int maxPath = 250; // leave some margin below 260
        // Calculate how much space the name can use
        // Full path = basePath \ name \ name.ext  (for leaf) or basePath \ name (for dir)
        int overhead = basePath.Length + 1; // +1 for separator
        if (extension != null)
        {
            // leaf: basePath\name\name.ext => basePath.Length + 1 + name.Length + 1 + name.Length + ext.Length
            overhead += 1 + extension.Length; // extra separator + .docx
            int available = (maxPath - overhead) / 2; // name appears twice (folder + file)
            if (available < 10) available = 10;
            if (name.Length > available)
                name = name[..available].TrimEnd('.', ' ', '_');
        }
        else
        {
            // directory: basePath\name
            int available = maxPath - overhead;
            if (available < 10) available = 10;
            if (name.Length > available)
                name = name[..available].TrimEnd('.', ' ', '_');
        }
        return string.IsNullOrEmpty(name) ? "unnamed" : name;
    }

    /// <summary>
    /// Copy document styles, theme, and numbering definitions from source to target.
    /// This ensures table styles (borders, shading) and paragraph styles are preserved.
    /// </summary>
    private static void CopyDocumentStyles(WordprocessingDocument sourceDoc, WordprocessingDocument targetDoc)
    {
        var sourceMainPart = sourceDoc.MainDocumentPart!;
        var targetMainPart = targetDoc.MainDocumentPart!;

        // Use AddPart() to deep-copy each part INCLUDING all sub-parts and relationships.
        // This prevents "missing or invalid part" errors (e.g. fontTable.xml referencing
        // embedded font files that weren't copied).

        if (sourceMainPart.StyleDefinitionsPart != null)
            targetMainPart.AddPart(sourceMainPart.StyleDefinitionsPart);

        if (sourceMainPart.ThemePart != null)
            targetMainPart.AddPart(sourceMainPart.ThemePart);

        if (sourceMainPart.NumberingDefinitionsPart != null)
            targetMainPart.AddPart(sourceMainPart.NumberingDefinitionsPart);

        if (sourceMainPart.FontTablePart != null)
            targetMainPart.AddPart(sourceMainPart.FontTablePart);

        if (sourceMainPart.DocumentSettingsPart != null)
            targetMainPart.AddPart(sourceMainPart.DocumentSettingsPart);
    }

    /// <summary>
    /// Copy a paragraph with full formatting (fonts, sizes, bold, italic, colors, images) into a target document.
    /// </summary>
    private static void CopyParagraphWithFullFormatting(Paragraph sourcePara, WordprocessingDocument sourceDoc,
        Body targetBody, WordprocessingDocument targetDoc)
    {
        // Deep clone the paragraph XML
        var clonedPara = (Paragraph)sourcePara.CloneNode(true);

        // Handle images: find all blip references and copy image parts
        var drawings = clonedPara.Descendants<A.Blip>().ToList();
        foreach (var blip in drawings)
        {
            var embedAttr = blip.Embed?.Value;
            if (embedAttr != null)
            {
                try
                {
                    var sourcePart = sourceDoc.MainDocumentPart!.GetPartById(embedAttr);
                    if (sourcePart is ImagePart sourceImagePart)
                    {
                        // Add image part to target document
                        var targetImagePart = targetDoc.MainDocumentPart!.AddImagePart(sourceImagePart.ContentType);
                        using (var stream = sourceImagePart.GetStream())
                        {
                            targetImagePart.FeedData(stream);
                        }

                        // Update the relationship ID in the cloned paragraph
                        string newRelId = targetDoc.MainDocumentPart!.GetIdOfPart(targetImagePart);
                        blip.Embed = newRelId;
                    }
                }
                catch
                {
                    // Image not found, skip
                }
            }
        }

        targetBody.AppendChild(clonedPara);
    }

    /// <summary>
    /// Copy a table with full formatting into a target document.
    /// Deep clones the XML and preserves original borders (from inline props or styles).
    /// Only adds fallback borders if neither inline borders nor a table style are defined.
    /// </summary>
    private static void CopyTable(Table sourceTable, WordprocessingDocument sourceDoc,
        Body targetBody, WordprocessingDocument targetDoc)
    {
        var clonedTable = (Table)sourceTable.CloneNode(true);

        // Ensure table properties exist
        var tblPr = clonedTable.Elements<TableProperties>().FirstOrDefault();
        if (tblPr == null)
        {
            tblPr = new TableProperties();
            clonedTable.InsertAt(tblPr, 0);
        }

        // Only add fallback borders if there are no inline borders AND no table style
        // (table style borders are resolved via the copied StyleDefinitionsPart)
        bool hasInlineBorders = tblPr.TableBorders != null;
        bool hasTableStyle = tblPr.TableStyle != null;
        bool hasCellBorders = clonedTable.Descendants<TableCellBorders>().Any();

        if (!hasInlineBorders && !hasTableStyle && !hasCellBorders)
        {
            tblPr.TableBorders = new TableBorders(
                new TopBorder { Val = BorderValues.Single, Size = 4, Space = 0, Color = "000000" },
                new LeftBorder { Val = BorderValues.Single, Size = 4, Space = 0, Color = "000000" },
                new BottomBorder { Val = BorderValues.Single, Size = 4, Space = 0, Color = "000000" },
                new RightBorder { Val = BorderValues.Single, Size = 4, Space = 0, Color = "000000" },
                new InsideHorizontalBorder { Val = BorderValues.Single, Size = 4, Space = 0, Color = "000000" },
                new InsideVerticalBorder { Val = BorderValues.Single, Size = 4, Space = 0, Color = "000000" }
            );
        }

        // Handle images inside table cells
        var blips = clonedTable.Descendants<A.Blip>().ToList();
        foreach (var blip in blips)
        {
            var embedAttr = blip.Embed?.Value;
            if (embedAttr != null)
            {
                try
                {
                    var sourcePart = sourceDoc.MainDocumentPart!.GetPartById(embedAttr);
                    if (sourcePart is ImagePart sourceImagePart)
                    {
                        var targetImagePart = targetDoc.MainDocumentPart!.AddImagePart(sourceImagePart.ContentType);
                        using (var stream = sourceImagePart.GetStream())
                        {
                            targetImagePart.FeedData(stream);
                        }
                        string newRelId = targetDoc.MainDocumentPart!.GetIdOfPart(targetImagePart);
                        blip.Embed = newRelId;
                    }
                }
                catch
                {
                    // Image not found, skip
                }
            }
        }

        targetBody.AppendChild(clonedTable);
    }

    /// <summary>
    /// Write a heading paragraph and content blocks into a target document body.
    /// </summary>
    private static void WriteNodeContent(HeadingNode node, WordprocessingDocument sourceDoc,
        Body targetBody, WordprocessingDocument targetDoc)
    {
        if (node.HeadingParagraph != null)
        {
            CopyParagraphWithFullFormatting(node.HeadingParagraph, sourceDoc, targetBody, targetDoc);
        }

        foreach (var block in node.Content)
        {
            if (block.IsParagraph)
            {
                CopyParagraphWithFullFormatting((Paragraph)block.Element, sourceDoc, targetBody, targetDoc);
            }
            else if (block.IsTable)
            {
                CopyTable((Table)block.Element, sourceDoc, targetBody, targetDoc);
            }
        }
    }

    /// <summary>
    /// Create a .docx file, copy styles from source, and write content via a callback.
    /// </summary>
    private static void CreateDocxFile(string filePath, WordprocessingDocument sourceDoc,
        Action<Body, WordprocessingDocument> writeContent)
    {
        using var targetDoc = WordprocessingDocument.Create(filePath, WordprocessingDocumentType.Document);
        var mainPart = targetDoc.AddMainDocumentPart();
        mainPart.Document = new Document(new Body());
        var targetBody = mainPart.Document.Body!;

        CopyDocumentStyles(sourceDoc, targetDoc);
        writeContent(targetBody, targetDoc);
        mainPart.Document.Save();
    }

    /// <summary>
    /// Count the total number of output files that will be created.
    /// </summary>
    private int CountOutputFiles(Dictionary<string, HeadingNode> nodes)
    {
        int count = 0;
        foreach (var kvp in nodes)
        {
            var node = kvp.Value;
            if (!node.HasSubHeadings)
            {
                // Leaf node → 1 file
                count++;
            }
            else
            {
                // Branch node → folder + optional content file + recurse
                if (node.Content.Count > 0 || node.HeadingParagraph != null)
                    count++;
                count += CountOutputFiles(node.Children);
            }
        }
        return count;
    }

    private void CreateFlexibleStructure(Dictionary<string, HeadingNode> nodes,
        string basePath, WordprocessingDocument sourceDoc, int depth, ref int filesCreated, int totalFiles)
    {
        foreach (var kvp in nodes)
        {
            var heading = kvp.Key;
            var node = kvp.Value;
            var sanitized = SanitizeName(heading);
            var indent = new string(' ', depth * 2);

            if (!node.HasSubHeadings)
            {
                // Leaf node - create folder and file named after this heading
                sanitized = FitNameToPathLimit(basePath, sanitized, ".docx");
                var nodePath = Path.Combine(basePath, sanitized);
                Directory.CreateDirectory(nodePath);

                var fileName = $"{sanitized}.docx";
                var filePath = Path.Combine(nodePath, fileName);

                CreateDocxFile(filePath, sourceDoc, (targetBody, targetDoc) =>
                {
                    WriteNodeContent(node, sourceDoc, targetBody, targetDoc);
                });

                filesCreated++;
                _log($"{indent}[OK] {sanitized}/{fileName}");
                _setProgress(totalFiles > 0 ? (int)(filesCreated * 100.0 / totalFiles) : 100);
            }
            else
            {
                // Branch node → create folder, recurse
                sanitized = FitNameToPathLimit(basePath, sanitized);
                var nodePath = Path.Combine(basePath, sanitized);
                Directory.CreateDirectory(nodePath);
                _log($"{indent}[DIR] {sanitized}/");

                // If branch node has its own content (before first sub-heading), write it to a file
                if (node.Content.Count > 0 || node.HeadingParagraph != null)
                {
                    var contentFileName = FitNameToPathLimit(nodePath, sanitized, ".docx");
                    var contentFilePath = Path.Combine(nodePath, $"{contentFileName}.docx");

                    CreateDocxFile(contentFilePath, sourceDoc, (targetBody, targetDoc) =>
                    {
                        WriteNodeContent(node, sourceDoc, targetBody, targetDoc);
                    });

                    filesCreated++;
                    _log($"{indent}  [OK] {contentFileName}.docx (branch content)");
                    _setProgress(totalFiles > 0 ? (int)(filesCreated * 100.0 / totalFiles) : 100);
                }

                CreateFlexibleStructure(node.Children, nodePath, sourceDoc, depth + 1, ref filesCreated, totalFiles);
            }
        }
    }

    /// <summary>
    /// Main entry point: split the document.
    /// </summary>
    public void Split()
    {
        _log(new string('=', 70));
        _log("Document Splitter - WPF Version");
        _log(new string('=', 70));
        _log($"Input: {_inputFile}");
        _log($"Output: {_outputDir}");
        _setProgress(0);

        using var doc = WordprocessingDocument.Open(_inputFile, false);

        _log("\nScanning document...");
        var headingLevels = DetectHeadingLevels(doc);

        if (headingLevels.Count == 0)
        {
            _log("\n[Error] No heading structure detected!");
            return;
        }

        var structure = ParseDocument(doc, headingLevels);

        if (structure.Count == 0)
        {
            _log("\n[Error] No content found!");
            return;
        }

        _log("\n" + new string('=', 70));
        _log("Creating output files...");
        _log(new string('=', 70));

        Directory.CreateDirectory(_outputDir);

        int totalFiles = CountOutputFiles(structure);
        int filesCreated = 0;
        CreateFlexibleStructure(structure, _outputDir, doc, 0, ref filesCreated, totalFiles);

        _setProgress(100);
        _log("\n" + new string('=', 70));
        _log($"[SUCCESS] Document splitting completed! Created {filesCreated} files.");
        _log($"Output: {Path.GetFullPath(_outputDir)}");
        _log(new string('=', 70));
    }
}
