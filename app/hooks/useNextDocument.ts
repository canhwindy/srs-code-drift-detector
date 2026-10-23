import type { NavigationNode } from "@shared/types";
import useAdjacentDocument from "~/hooks/useAdjacentDocument";

/**
 * Hook to determine the next document in DFS order within a collection tree.
 * Convenience wrapper around useAdjacentDocument.
 */
export default function useNextDocument(
  documentId: string,
  collectionId?: string | null
): NavigationNode | undefined {
  return useAdjacentDocument(documentId, collectionId, "next");
}
