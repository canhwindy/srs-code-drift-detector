using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using FileSplitApi.Models;
using FileSplitApi.Services;
using System.ComponentModel.DataAnnotations;

namespace FileSplitApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class DocumentSplitController : ControllerBase
{
    private readonly IDocumentSplitterService _splitterService;
    private readonly ILogger<DocumentSplitController> _logger;

    // Allowed file extensions
    private static readonly string[] AllowedExtensions = { ".docx" };
    private const long MaxFileSize = 52428800; // 50 MB

    public DocumentSplitController(
        IDocumentSplitterService splitterService,
        ILogger<DocumentSplitController> logger)
    {
        _splitterService = splitterService;
        _logger = logger;
    }

    /// <summary>
    /// Upload and split a DOCX document into hierarchical structure
    /// </summary>
    /// <param name="file">The DOCX file to split</param>
    /// <param name="headingSizes">Comma-separated heading sizes (e.g., "18, 16, 15, 14, 12, 11")</param>
    /// <param name="includeContent">Whether to include full content extraction (default: false for performance)</param>
    /// <returns>Document tree structure</returns>
    [HttpPost("split")]
    [ProducesResponseType(typeof(DocumentSplitResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    [RequestSizeLimit(MaxFileSize)]
    public async Task<ActionResult<DocumentSplitResponse>> SplitDocument(
        [Required] IFormFile file,
        [FromForm] string headingSizes = "18, 16, 15, 14, 12, 11",
        [FromForm] bool includeContent = false,
        [FromForm] bool autoDetect = true)
    {
        _logger.LogInformation("=== FileSplit API Request Received ===");
        _logger.LogInformation("Request Origin: {Origin}", Request.Headers["Origin"].ToString());
        _logger.LogInformation("Request Method: {Method}", Request.Method);
        _logger.LogInformation("Request Path: {Path}", Request.Path);
        _logger.LogInformation("Content-Type: {ContentType}", Request.ContentType);
        
        try
        {
            // Validate file
            if (file == null || file.Length == 0)
            {
                _logger.LogWarning("No file uploaded in request");
                return BadRequest(new DocumentSplitResponse
                {
                    Success = false,
                    ErrorMessage = "No file uploaded"
                });
            }

            _logger.LogInformation("File details:");
            _logger.LogInformation("- Name: {FileName}", file.FileName);
            _logger.LogInformation("- Size: {FileSize} bytes ({FileSizeMB:F2} MB)", file.Length, file.Length / 1024.0 / 1024.0);
            _logger.LogInformation("- Content-Type: {ContentType}", file.ContentType);

            // Check file size
            if (file.Length > MaxFileSize)
            {
                _logger.LogWarning("File size {FileSize} exceeds maximum {MaxSize}", file.Length, MaxFileSize);
                return BadRequest(new DocumentSplitResponse
                {
                    Success = false,
                    ErrorMessage = $"File size exceeds maximum allowed size of {MaxFileSize / 1024 / 1024} MB"
                });
            }

            // Check file extension
            var fileExtension = Path.GetExtension(file.FileName).ToLowerInvariant();
            _logger.LogInformation("File extension: {Extension}", fileExtension);
            
            if (!AllowedExtensions.Contains(fileExtension))
            {
                _logger.LogWarning("Unsupported file extension: {Extension}", fileExtension);
                return BadRequest(new DocumentSplitResponse
                {
                    Success = false,
                    ErrorMessage = $"File type not supported. Allowed types: {string.Join(", ", AllowedExtensions)}"
                });
            }

            _logger.LogInformation("Processing parameters:");
            _logger.LogInformation("- Auto detect: {AutoDetect}", autoDetect);
            _logger.LogInformation("- Heading sizes: {HeadingSizes}", headingSizes);
            _logger.LogInformation("- Include content: {IncludeContent}", includeContent);
            _logger.LogInformation("Starting document split process...");

            // Create request
            var request = new DocumentSplitRequest
            {
                HeadingSizes = headingSizes,
                IncludeContent = includeContent,
                AutoDetect = autoDetect
            };

            // Process the file
            using var stream = file.OpenReadStream();
            var response = await _splitterService.SplitDocumentAsync(stream, file.FileName, request);

            if (!response.Success)
            {
                _logger.LogError("Document split failed: {ErrorMessage}", response.ErrorMessage);
                _logger.LogError("Warnings: {Warnings}", string.Join(", ", response.Warnings));
                return StatusCode(500, response);
            }

            _logger.LogInformation("=== Document Split Success ===");
            _logger.LogInformation("- Total nodes: {NodeCount}", response.Statistics.TotalNodes);
            _logger.LogInformation("- Max depth: {MaxDepth}", response.Statistics.MaxDepth);
            _logger.LogInformation("- Processing time: {ProcessingTime:F2}ms", response.Statistics.ProcessingTimeMs);
            
            if (response.Warnings.Any())
            {
                _logger.LogWarning("Warnings during processing: {Warnings}", string.Join(", ", response.Warnings));
            }

            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError("=== FileSplit API Error ===");
            _logger.LogError(ex, "Exception type: {ExceptionType}", ex.GetType().Name);
            _logger.LogError("Exception message: {Message}", ex.Message);
            _logger.LogError("Stack trace: {StackTrace}", ex.StackTrace);
            
            return StatusCode(500, new DocumentSplitResponse
            {
                Success = false,
                ErrorMessage = $"Internal server error: {ex.Message}"
            });
        }
    }

    /// <summary>
    /// Health check endpoint
    /// </summary>
    [HttpGet("health")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public ActionResult HealthCheck()
    {
        return Ok(new
        {
            status = "healthy",
            service = "Document Splitter API",
            version = "1.0.0",
            timestamp = DateTime.UtcNow
        });
    }

    /// <summary>
    /// Get API information
    /// </summary>
    [HttpGet("info")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public ActionResult GetInfo()
    {
        return Ok(new
        {
            service = "Document Splitter API",
            version = "1.0.0",
            description = "API for splitting DOCX documents into hierarchical structure based on heading font sizes",
            endpoints = new[]
            {
                new { method = "POST", path = "/api/DocumentSplit/split", description = "Upload and split a DOCX file" },
                new { method = "GET", path = "/api/DocumentSplit/health", description = "Health check" },
                new { method = "GET", path = "/api/DocumentSplit/info", description = "API information" }
            },
            supportedFileTypes = AllowedExtensions,
            maxFileSize = $"{MaxFileSize / 1024 / 1024} MB",
            defaultHeadingSizes = "18, 16, 15, 14, 12, 11"
        });
    }
}
