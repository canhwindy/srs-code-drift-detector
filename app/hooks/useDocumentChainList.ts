import { flattenTree } from "@shared/utils/tree";
import type { NavigationNode } from "@shared/types";
import useStores from "~/hooks/useStores";

export interface DocumentChainList {
    /** All document nodes in DFS order (excluding drafts) */
    nodes: NavigationNode[];
    /** Index of the current document in the nodes array */
    currentIndex: number;
}

/**
 * Hook to get a flat list of all documents in a collection in DFS order.
 * Excludes draft documents from the list.
 *
 * Must be used within a mobx-react `observer` component so that changes to
 * `collection.sortedDocuments` trigger a re-render.
 *
 * @param documentId - The current document ID
 * @param collectionId - The collection the document belongs to
 * @returns Object with nodes array and current document index
 */
export default function useDocumentChainList(
    documentId: string,
    collectionId: string | null | undefined
): DocumentChainList {
    const { collections } = useStores();

    if (!collectionId) {
        return { nodes: [], currentIndex: -1 };
    }

    const collection = collections.get(collectionId);
    if (!collection?.sortedDocuments) {
        return { nodes: [], currentIndex: -1 };
    }

    // Flatten the entire collection tree in DFS order
    const allNodes: NavigationNode[] = [];
    for (const root of collection.sortedDocuments) {
        allNodes.push(...flattenTree(root));
    }

    // Filter out draft documents
    const publishedNodes = allNodes.filter((node) => !node.isDraft);

    // Find current document index
    const currentIndex = publishedNodes.findIndex(
        (node) => node.id === documentId
    );

    return {
        nodes: publishedNodes,
        currentIndex,
    };
}
