import { observer } from "mobx-react";
import * as React from "react";
import type Document from "~/models/Document";
import Editor from "./Editor";
import {
    VirtualDocumentChain,
    useDocumentChainStatus,
} from "./VirtualDocumentChainV2";

type EditorProps = React.ComponentProps<typeof Editor>;

type Props = Omit<EditorProps, "hasChainedDocuments"> & {
    document: Document;
};

/**
 * Wrapper component that combines Editor with virtualized document chaining.
 * Renders previous and next documents in the collection as the user scrolls,
 * with a sliding window to keep memory usage bounded.
 */
function EditorWithChain({ document, children, ...editorProps }: Props) {
    const { hasPrevious, hasNext } = useDocumentChainStatus(
        document.id,
        document.collectionId
    );
    const hasChainedDocuments = hasPrevious || hasNext;

    if (!document.collectionId) {
        return (
            <Editor {...editorProps} document={document} hasChainedDocuments={false}>
                {children}
            </Editor>
        );
    }

    return (
        <VirtualDocumentChain.Provider
            mainDocumentId={document.id}
            collectionId={document.collectionId}
        >
            <VirtualDocumentChain.Before />
            <Editor
                {...editorProps}
                document={document}
                hasChainedDocuments={hasChainedDocuments}
            >
                {children}
            </Editor>
            <VirtualDocumentChain.After />
        </VirtualDocumentChain.Provider>
    );
}

export default observer(EditorWithChain);