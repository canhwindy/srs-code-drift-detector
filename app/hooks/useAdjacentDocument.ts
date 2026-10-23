import { flattenTree } from "@shared/utils/tree";
import type { NavigationNode } from "@shared/types";
import useStores from "~/hooks/useStores";

/**
 * Hook to determine the next or previous document in DFS order within a
 * collection tree. Skips draft documents.
 *
 * Must be used within a mobx-react `observer` component so that changes to
 * `collection.sortedDocuments` trigger a re-render.
 *
 * @param documentId - The current document ID
 * @param collectionId - The collection the document belongs to
 * @param direction - "next" or "previous"
 * @returns The adjacent NavigationNode or undefined if none exists
 */
export default function useAdjacentDocument(
  documentId: string,
  collectionId: string | null | undefined,
  direction: "next" | "previous"
): NavigationNode | undefined {
  const { collections } = useStores();

  if (!collectionId) {
    return undefined;
  }

  const collection = collections.get(collectionId);
  if (!collection?.sortedDocuments) {
    return undefined;
  }

  // Flatten the entire collection tree in DFS order
  const allNodes: NavigationNode[] = [];
  for (const root of collection.sortedDocuments) {
    allNodes.push(...flattenTree(root));
  }

  // Find current document index
  const currentIndex = allNodes.findIndex((node) => node.id === documentId);
  if (currentIndex === -1) {
    return undefined;
  }

  if (direction === "next") {
    for (let i = currentIndex + 1; i < allNodes.length; i++) {
      if (!allNodes[i].isDraft) {
        return allNodes[i];
      }
    }
  } else {
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (!allNodes[i].isDraft) {
        return allNodes[i];
      }
    }
  }

  return undefined;
}
