import JSZip from "jszip";
import type { NavigationNode } from "@shared/types";
import { FileOperationFormat } from "@shared/types";
import type { Collection, FileOperation } from "@server/models";
import type { Document } from "@server/models";
import ExportDocumentTreeTask from "./ExportDocumentTreeTask";

export default class ExportDocxZipTask extends ExportDocumentTreeTask {
    public async exportCollections(
        collections: Collection[],
        fileOperation: FileOperation
    ) {
        const zip = new JSZip();

        return await this.addCollectionsToArchive(
            zip,
            collections,
            FileOperationFormat.DocxZip,
            fileOperation.options?.includeAttachments ?? true
        );
    }

    public async exportDocument(
        document: Document,
        documentStructure: NavigationNode[]
    ): Promise<string> {
        const zip = new JSZip();

        return await this.addDocumentToArchive({
            document,
            documentStructure,
            format: FileOperationFormat.DocxZip,
            zip,
        });
    }
}
