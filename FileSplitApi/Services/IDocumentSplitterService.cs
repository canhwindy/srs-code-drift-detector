using FileSplitApi.Models;

namespace FileSplitApi.Services;

public interface IDocumentSplitterService
{
    /// <summary>
    /// Split a DOCX document into hierarchical structure based on heading sizes
    /// </summary>
    /// <param name="fileStream">Input DOCX file stream</param>
    /// <param name="fileName">Original filename</param>
    /// <param name="request">Split configuration</param>
    /// <returns>Document tree structure</returns>
    Task<DocumentSplitResponse> SplitDocumentAsync(
        Stream fileStream,
        string fileName,
        DocumentSplitRequest request);
}
