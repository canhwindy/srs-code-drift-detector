import { observer } from "mobx-react";
import * as React from "react";
import styled from "styled-components";
import { richExtensions, withComments } from "@shared/editor/nodes";
import { s } from "@shared/styles";
import Editor from "~/components/Editor";
import useAdjacentDocument from "~/hooks/useAdjacentDocument";
import useStores from "~/hooks/useStores";

const MAX_CHAINED_DOCUMENTS = 5;

const readOnlyExtensions = withComments(richExtensions);

type Props = {
  /** The current document ID to find the previous document before */
  documentId: string;
  /** The collection ID to search within */
  collectionId: string;
  /** Current depth in the chain (used to enforce max limit) */
  depth?: number;
};

function PreviousDocumentChain({
  documentId,
  collectionId,
  depth = 0,
}: Props) {
  const { documents, ui, collections } = useStores();
  const prevNode = useAdjacentDocument(documentId, collectionId, "previous");
  const [isVisible, setIsVisible] = React.useState(false);
  const [isLoaded, setIsLoaded] = React.useState(false);
  const sentinelRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const dividerRef = React.useRef<HTMLHRElement>(null);
  const hasAdjustedScroll = React.useRef(false);

  // Ensure the collection document tree is loaded
  React.useEffect(() => {
    const collection = collections.get(collectionId);
    if (collection) {
      void collection.fetchDocuments();
    }
  }, [collections, collectionId]);

  // IntersectionObserver to detect when sentinel (top of page) comes into view
  React.useEffect(() => {
    const element = sentinelRef.current;
    if (!element || !prevNode) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "500px" }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [prevNode]);

  // Fetch previous document data when sentinel becomes visible
  React.useEffect(() => {
    if (!isVisible || !prevNode) {
      return;
    }

    const doc = documents.get(prevNode.id);
    if (doc?.data) {
      setIsLoaded(true);
      return;
    }

    void documents.fetch(prevNode.id).then(() => {
      setIsLoaded(true);
    });
  }, [isVisible, prevNode, documents]);

  // After content renders, adjust scroll position so the viewport doesn't jump.
  // The prepended content pushes everything down, so we compensate by scrolling
  // down by the same amount.
  React.useEffect(() => {
    const element = contentRef.current;
    if (!element || hasAdjustedScroll.current) {
      return;
    }

    const height = element.offsetHeight;
    if (height > 0) {
      window.scrollBy(0, height);
      hasAdjustedScroll.current = true;
    }
  });

  // Track scroll position to update sidebar active document
  React.useEffect(() => {
    const element = dividerRef.current;
    if (!element || !prevNode) {
      return;
    }

    let currentlyActive = false;

    const handleScroll = () => {
      const rect = element.getBoundingClientRect();
      // Divider is below viewport bottom → user has scrolled up into the previous doc
      const shouldBeActive = rect.bottom > window.innerHeight;

      if (shouldBeActive && !currentlyActive) {
        currentlyActive = true;
        ui.setActiveDocument(prevNode.id);
      } else if (!shouldBeActive && currentlyActive) {
        currentlyActive = false;
        ui.setActiveDocument(documentId);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [prevNode, documentId, ui, isLoaded]);

  if (!prevNode || depth >= MAX_CHAINED_DOCUMENTS) {
    return null;
  }

  const prevDocument = isLoaded ? documents.get(prevNode.id) : undefined;

  return (
    <>
      {prevDocument?.data && (
        <div ref={contentRef}>
          <PreviousDocumentChain
            documentId={prevNode.id}
            collectionId={collectionId}
            depth={depth + 1}
          />
          <ChainedDocumentHeader>
            <ChainedTitle>
              {prevDocument.icon && <span>{prevDocument.icon} </span>}
              {prevDocument.titleWithDefault}
            </ChainedTitle>
          </ChainedDocumentHeader>
          <Editor
            defaultValue={prevDocument.data}
            extensions={readOnlyExtensions}
            readOnly
          />
          <Divider ref={dividerRef} />
        </div>
      )}
      <Sentinel ref={sentinelRef} />
    </>
  );
}

const Sentinel = styled.div`
  height: 1px;
`;

const Divider = styled.hr`
  border: 0;
  border-top: 1px solid ${s("divider")};
  margin: 32px 0;
`;

const ChainedDocumentHeader = styled.div`
  margin-bottom: 16px;
`;

const ChainedTitle = styled.h1`
  font-size: 2em;
  font-weight: 600;
  color: ${s("text")};
  margin: 0;
`;

export default observer(PreviousDocumentChain);
