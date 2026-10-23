using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using FileSplitApi.Services;

var builder = WebApplication.CreateBuilder(args);

// Read port from environment variable (centralized in .env file)
var port = Environment.GetEnvironmentVariable("FILE_SPLIT_API_PORT") ?? "5000";
builder.WebHost.UseUrls($"http://+:{port}");

// Read configuration from environment variables
var maxFileSizeStr = Environment.GetEnvironmentVariable("FILE_SPLIT_API_MAX_FILE_SIZE");
var maxFileSize = !string.IsNullOrEmpty(maxFileSizeStr) && long.TryParse(maxFileSizeStr, out var size)
    ? size
    : 52428800L; // Default: 50 MB

// Add services to the container
builder.Services.AddControllers()
    .AddNewtonsoftJson(options =>
    {
        options.SerializerSettings.ReferenceLoopHandling = Newtonsoft.Json.ReferenceLoopHandling.Ignore;
        options.SerializerSettings.NullValueHandling = Newtonsoft.Json.NullValueHandling.Include;
        options.SerializerSettings.ContractResolver = new Newtonsoft.Json.Serialization.CamelCasePropertyNamesContractResolver();
    });

// Configure CORS — read allowed origins from environment variable
// Default to common dev origins if not set
var allowedOriginsEnv = builder.Configuration["FILE_SPLIT_API_ALLOWED_ORIGINS"]
    ?? Environment.GetEnvironmentVariable("FILE_SPLIT_API_ALLOWED_ORIGINS")
    ?? "http://localhost:3000,http://localhost:3001,http://localhost:5173,http://localhost:8080";

var allowedOrigins = allowedOriginsEnv
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
    .ToArray();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowOutline", policy =>
    {
        policy.WithOrigins(allowedOrigins)
            .AllowAnyMethod()
            .AllowAnyHeader()
            .AllowCredentials();
    });
});

// Add Swagger/OpenAPI
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new Microsoft.OpenApi.Models.OpenApiInfo
    {
        Title = "Document Splitter API",
        Version = "v1",
        Description = "API for splitting DOCX documents into hierarchical structure"
    });
});

// Register DocumentSplitter service
builder.Services.AddScoped<IDocumentSplitterService, DocumentSplitterService>();

// Configure file size limits (read from environment or fallback to default)
builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = maxFileSize;
});

// Also configure Kestrel limits for consistency
builder.WebHost.ConfigureKestrel(serverOptions =>
{
    serverOptions.Limits.MaxRequestBodySize = maxFileSize;
});

var app = builder.Build();

// Log startup info
var startupLogger = app.Services.GetRequiredService<ILogger<Program>>();
startupLogger.LogInformation("=== FileSplit API Starting ===");
startupLogger.LogInformation("Environment: {Env}", app.Environment.EnvironmentName);
startupLogger.LogInformation("Listening on port: {Port}", port);
startupLogger.LogInformation("Allowed CORS Origins: {Origins}", string.Join(", ", allowedOrigins));

// Configure the HTTP request pipeline
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Request logging middleware (development only to avoid noise in production)
if (app.Environment.IsDevelopment())
{
    app.Use(async (context, next) =>
    {
        var logger = context.RequestServices.GetRequiredService<ILogger<Program>>();
        logger.LogInformation("=== Incoming Request ===");
        logger.LogInformation("Method: {Method} Path: {Path}", context.Request.Method, context.Request.Path);
        logger.LogInformation("Origin: {Origin}", context.Request.Headers["Origin"].ToString());
        
        await next();
        
        logger.LogInformation("Response Status: {StatusCode}", context.Response.StatusCode);
    });
}

// HTTPS redirection not needed - Nginx handles TLS termination
// app.UseHttpsRedirection();

app.UseCors("AllowOutline");

app.UseAuthorization();

app.MapControllers();

app.Run();
