import * as React from "react";
import { useState, useEffect, useRef } from "react";
import styled from "styled-components";
import { s } from "@shared/styles";
import useStores from "~/hooks/useStores";

export type PickedDocument = {
  id: string;
  title: string;
  url: string;
};

interface ImpactDocumentPickerProps {
  disabledDocumentIds: string[];
  disabledDocumentTitles?: Set<string>;
  onSelect: (doc: PickedDocument) => void;
  disabled?: boolean;
}

export default function ImpactDocumentPicker({
  disabledDocumentIds,
  disabledDocumentTitles,
  onSelect,
  disabled = false,
}: ImpactDocumentPickerProps) {
  const { documents } = useStores();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedDocument[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const performSearch = async (q: string) => {
    setIsLoading(true);
    try {
      const searchResults = await documents.searchTitles(
        q.trim() ? { query: q } : {}
      );
      setResults(
        searchResults.map((r) => ({
          id: r.document.id,
          title: r.document.title,
          url: r.document.path,
        }))
      );
      setIsOpen(true);
    } catch {
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Debounced search on query change
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      void performSearch(query);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const handleFocus = () => {
    if (results.length > 0) {
      // Re-open if results already cached
      setIsOpen(true);
    } else {
      // Fetch recent docs immediately on first focus
      void performSearch(query);
    }
  };

  const handleSelect = (doc: PickedDocument) => {
    setIsOpen(false);
    setQuery("");
    onSelect(doc);
  };

  return (
    <Container ref={containerRef}>
      <SearchInput
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={handleFocus}
        placeholder="Tìm document..."
        disabled={disabled}
        autoComplete="off"
      />
      {isLoading && <LoadingHint>Đang tìm...</LoadingHint>}
      {isOpen && results.length > 0 && (
        <Dropdown>
          {results.map((doc) => {
            const isDisabled =
              disabledDocumentIds.includes(doc.id) ||
              (disabledDocumentTitles?.has(doc.title.toLowerCase()) ?? false);
            return (
              <DropdownItem
                key={doc.id}
                $disabled={isDisabled}
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent input blur before click fires
                  if (!isDisabled) {
                    handleSelect(doc);
                  }
                }}
                title={
                  isDisabled ? "Document này đã có trong danh sách" : undefined
                }
              >
                <ItemIcon>📄</ItemIcon>
                <ItemTitle>{doc.title || "Untitled"}</ItemTitle>
                {isDisabled && <AlreadyAdded>Đã có</AlreadyAdded>}
              </DropdownItem>
            );
          })}
        </Dropdown>
      )}
      {isOpen && results.length === 0 && !isLoading && (
        <Dropdown>
          <EmptyState>Không tìm thấy document</EmptyState>
        </Dropdown>
      )}
    </Container>
  );
}

// ─── Styled components ────────────────────────────────────────────────────────

const Container = styled.div`
  position: relative;
  width: 100%;
`;

const SearchInput = styled.input`
  width: 100%;
  font-size: 13px;
  padding: 6px 10px;
  border: 1px solid ${s("inputBorder")};
  border-radius: 6px;
  background: ${s("background")};
  color: ${s("text")};
  outline: none;
  font-family: inherit;
  box-sizing: border-box;

  &::placeholder {
    color: ${s("placeholder")};
  }

  &:focus {
    border-color: ${s("inputBorderFocused")};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const LoadingHint = styled.div`
  font-size: 11px;
  color: ${s("textTertiary")};
  padding: 2px 4px;
`;

const Dropdown = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  z-index: 100;
  max-height: 220px;
  overflow-y: auto;
`;

const DropdownItem = styled.div<{ $disabled: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 13px;
  color: ${({ $disabled }) => ($disabled ? s("textTertiary") : s("text"))};
  cursor: ${({ $disabled }) => ($disabled ? "not-allowed" : "pointer")};
  opacity: ${({ $disabled }) => ($disabled ? 0.6 : 1)};

  &:hover {
    background: ${({ $disabled }) =>
      $disabled ? "transparent" : s("listItemHoverBackground")};
  }

  &:first-child {
    border-radius: 6px 6px 0 0;
  }

  &:last-child {
    border-radius: 0 0 6px 6px;
  }
`;

const ItemIcon = styled.span`
  font-size: 14px;
  flex-shrink: 0;
`;

const ItemTitle = styled.span`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AlreadyAdded = styled.span`
  font-size: 11px;
  color: ${s("textTertiary")};
  flex-shrink: 0;
  font-style: italic;
`;

const EmptyState = styled.div`
  padding: 12px;
  font-size: 13px;
  color: ${s("textTertiary")};
  text-align: center;
`;
