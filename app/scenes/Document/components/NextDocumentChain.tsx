import { observer } from "mobx-react";
import * as React from "react";
import styled from "styled-components";
import { richExtensions, withComments } from "@shared/editor/nodes";
import { s } from "@shared/styles";
import Editor from "~/components/Editor";
import useNextDocument from "~/hooks/useNextDocument";
import useStores from "~/hooks/useStores";

const MAX_CHAINED_DOCUMENTS = 5;

const readOnlyExtensions = withComments(richExtensions);

type Props = {
  /** The current document ID to find the next document after */
  documentId: string;
  /** The collection ID to search within */
  collectionId: string;
  /** Current depth in the chain (used to enforce max limit) */
  depth?: number;
};

function NextDocumentChain({ documentId, collectionId, depth = 0 }: Props) {
  const { documents, ui, collections } = useStores();
  const nextNode = useNextDocument(documentId, collectionId);
  const [isVisible, setIsVisible] = React.useState(false);
  const [isLoaded, setIsLoaded] = React.useState(false);
  const sentinelRef = React.useRef<HTMLDivElement>(null);
  const dividerRef = React.useRef<HTMLHRElement>(null);

  // Ensure the collection document tree is loaded
  React.useEffect(() => {
    const collection = collections.get(collectionId);
    if (collection) {
      void collection.fetchDocuments();
    }
  }, [collections, collectionId]);

  // IntersectionObserver to detect when sentinel comes into view
  React.useEffect(() => {
    const element = sentinelRef.current;
    if (!element || !nextNode) {
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
  }, [nextNode]);

  // Fetch next document data when sentinel becomes visible
  React.useEffect(() => {
    if (!isVisible || !nextNode) {
      return;
    }

    const doc = documents.get(nextNode.id);
    if (doc?.data) {
      setIsLoaded(true);
      return;
    }

    void documents.fetch(nextNode.id).then(() => {
      setIsLoaded(true);
    });
  }, [isVisible, nextNode, documents]);

  // Track scroll position to update sidebar active document.
  // Uses a scroll listener instead of IntersectionObserver to avoid race
  // conditions with DataLoader which also calls ui.setActiveDocument.
  React.useEffect(() => {
    const element = dividerRef.current;
    if (!element || !nextNode) {
      return;
    }

    let currentlyActive = false;

    const handleScroll = () => {
      const rect = element.getBoundingClientRect();
      const shouldBeActive = rect.top < 0;

      if (shouldBeActive && !currentlyActive) {
        currentlyActive = true;
        ui.setActiveDocument(nextNode.id);
      } else if (!shouldBeActive && currentlyActive) {
        currentlyActive = false;
        ui.setActiveDocument(documentId);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [nextNode, documentId, ui, isLoaded]);

  if (!nextNode || depth >= MAX_CHAINED_DOCUMENTS) {
    return null;
  }

  const nextDocument = isLoaded ? documents.get(nextNode.id) : undefined;

  return (
    <>
      <Sentinel ref={sentinelRef} />
      {nextDocument?.data && (
        <>
          <Divider ref={dividerRef} />
          <ChainedDocumentHeader>
            <ChainedTitle>
              {nextDocument.icon && <span>{nextDocument.icon} </span>}
              {nextDocument.titleWithDefault}
            </ChainedTitle>
          </ChainedDocumentHeader>
          <Editor
            defaultValue={nextDocument.data}
            extensions={readOnlyExtensions}
            readOnly
          />
          <NextDocumentChain
            documentId={nextNode.id}
            collectionId={collectionId}
            depth={depth + 1}
          />
        </>
      )}
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

export default observer(NextDocumentChain);
