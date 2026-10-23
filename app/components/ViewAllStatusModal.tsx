import { observer } from "mobx-react";
import { useState, useCallback, useEffect, useRef } from "react";
import styled from "styled-components";
import { s } from "@shared/styles";
import { DocumentStatus, type NavigationNode } from "@shared/types";
import Modal from "~/components/Modal";
import Button from "~/components/Button";
import Spinner from "@shared/components/Spinner";
import { toast } from "sonner";
import useStores from "~/hooks/useStores";
import { client } from "~/utils/ApiClient";

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  [DocumentStatus.Closed]: {
    label: "Closed",
    color: "#6B7280",
    bg: "rgba(107, 114, 128, 0.12)",
  },
  [DocumentStatus.InProgress]: {
    label: "In Progress",
    color: "#F59E0B",
    bg: "rgba(245, 158, 11, 0.12)",
  },
  [DocumentStatus.Reviewed]: {
    label: "Reviewed",
    color: "#3B82F6",
    bg: "rgba(59, 130, 246, 0.12)",
  },
  [DocumentStatus.Approved]: {
    label: "Approved",
    color: "#10B981",
    bg: "rgba(16, 185, 129, 0.12)",
  },
};

const STATUS_ORDER = [
  DocumentStatus.Closed,
  DocumentStatus.InProgress,
  DocumentStatus.Reviewed,
  DocumentStatus.Approved,
];

type Props = {
  isOpen: boolean;
  onClose: () => void;
  collectionId: string;
};

/** Mini status dropdown that mimics the document header badge style.
 *  Renders menu inline (no createPortal) so it stays inside the Radix Dialog
 *  tree and won't trigger "pointer-down-outside" which would close the modal. */
function InlineStatusDropdown({
  docId,
  currentStatus,
  onChangeStatus,
}: {
  docId: string;
  currentStatus: DocumentStatus;
  onChangeStatus: (docId: string, status: DocumentStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const config = STATUS_CONFIG[currentStatus];

  // Calculate position synchronously on toggle to avoid flash
  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen((prev) => {
      if (!prev && badgeRef.current) {
        const rect = badgeRef.current.getBoundingClientRect();
        const menuWidth = 160;
        let left = rect.right - menuWidth;
        if (left < 8) {
          left = rect.left;
        }
        setPos({ top: rect.bottom + 4, left });
      }
      return !prev;
    });
  }, []);

  // Close on click outside
  useEffect(() => {
    if (!open) {
      return;
    }
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    // Use setTimeout to avoid the current click from immediately closing
    const timer = setTimeout(() => {
      window.document.addEventListener("mousedown", handler);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.document.removeEventListener("mousedown", handler);
    };
  }, [open]);

  return (
    <DropdownWrapper ref={wrapperRef}>
      <BadgeButton
        ref={badgeRef}
        $color={config.color}
        $bg={config.bg}
        onClick={handleToggle}
      >
        <Dot $color={config.color} />
        {config.label}
        <Chevron $open={open}>▾</Chevron>
      </BadgeButton>
      {open && pos && (
        <DropdownMenu style={{ top: pos.top, left: pos.left }}>
          {STATUS_ORDER.map((st) => {
            const cfg = STATUS_CONFIG[st];
            const isActive = currentStatus === st;
            return (
              <MenuItem
                key={st}
                $active={isActive}
                onClick={(e) => {
                  e.stopPropagation();
                  onChangeStatus(docId, st);
                  setOpen(false);
                }}
              >
                <Dot $color={cfg.color} />
                <MenuLabel>{cfg.label}</MenuLabel>
                {isActive && <CheckMark>✓</CheckMark>}
              </MenuItem>
            );
          })}
        </DropdownMenu>
      )}
    </DropdownWrapper>
  );
}

function ViewAllStatusModal({ isOpen, onClose, collectionId }: Props) {
  const { collections, documents } = useStores();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<
    Map<string, DocumentStatus>
  >(new Map());
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());
  const [checkedDocs, setCheckedDocs] = useState<Set<string>>(new Set());

  const collection = collections.get(collectionId);

  // Load collection documents when modal opens
  useEffect(() => {
    if (!isOpen || !collection) {
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        await collection.fetchDocuments();
      } finally {
        setLoading(false);
      }
    };

    void load();
    setPendingChanges(new Map());
    setCheckedDocs(new Set());
  }, [isOpen, collection]);

  const getEffectiveStatus = useCallback(
    (docId: string): DocumentStatus => {
      if (pendingChanges.has(docId)) {
        return pendingChanges.get(docId)!;
      }
      const doc = documents.get(docId);
      return (doc?.status as DocumentStatus) ?? DocumentStatus.InProgress;
    },
    [pendingChanges, documents]
  );

  // Collect all document IDs recursively from nodes
  const collectAllIds = useCallback((nodes: NavigationNode[]): string[] => {
    const ids: string[] = [];
    const walk = (list: NavigationNode[]) => {
      for (const n of list) {
        ids.push(n.id);
        if (n.children.length > 0) {
          walk(n.children);
        }
      }
    };
    walk(nodes);
    return ids;
  }, []);

  // Set status for a single doc, cascading to children
  const setStatusWithCascade = useCallback(
    (docId: string, status: DocumentStatus, childrenNodes: NavigationNode[]) => {
      setPendingChanges((prev) => {
        const next = new Map(prev);
        next.set(docId, status);
        const cascadeChildren = (nodes: NavigationNode[]) => {
          for (const node of nodes) {
            next.set(node.id, status);
            if (node.children.length > 0) {
              cascadeChildren(node.children);
            }
          }
        };
        cascadeChildren(childrenNodes);
        return next;
      });
    },
    []
  );

  const handleSave = useCallback(async () => {
    if (pendingChanges.size === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const updates = Array.from(pendingChanges.entries()).filter(
        ([id, status]) => {
          const doc = documents.get(id);
          return doc?.status !== status;
        }
      );

      if (updates.length === 0) {
        setPendingChanges(new Map());
        setCheckedDocs(new Set());
        onClose();
        return;
      }

      await Promise.all(
        updates.map(([id, status]) =>
          client.post("/documents.update", { id, status })
        )
      );

      for (const [id, status] of updates) {
        const doc = documents.get(id);
        if (doc) {
          doc.status = status;
        }
      }

      setPendingChanges(new Map());
      setCheckedDocs(new Set());
      toast.success(`Updated status for ${updates.length} document${updates.length > 1 ? "s" : ""}`);
      onClose();
    } catch (_err) {
      toast.error("Failed to save status changes. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [pendingChanges, documents, onClose]);

  const toggleDoc = useCallback((docId: string) => {
    setExpandedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  }, []);

  const toggleCheck = useCallback(
    (docId: string, childrenNodes: NavigationNode[]) => {
      setCheckedDocs((prev) => {
        const next = new Set(prev);
        if (next.has(docId)) {
          // Uncheck this + all children
          next.delete(docId);
          for (const id of collectAllIds(childrenNodes)) {
            next.delete(id);
          }
        } else {
          // Check this + all children
          next.add(docId);
          for (const id of collectAllIds(childrenNodes)) {
            next.add(id);
          }
        }
        return next;
      });
    },
    [collectAllIds]
  );

  const handleChangeStatus = useCallback(
    (docId: string, status: DocumentStatus) => {
      const docNodes = collection?.sortedDocuments ?? [];

      // Helper: find node in tree
      const findNode = (nodes: NavigationNode[]): NavigationNode | undefined => {
        for (const n of nodes) {
          if (n.id === docId) {
            return n;
          }
          const found = findNode(n.children);
          if (found) {
            return found;
          }
        }
        return undefined;
      };

      const node = findNode(docNodes);
      setStatusWithCascade(docId, status, node?.children ?? []);

      // If this doc is checked, also apply the same status to all other checked docs
      if (checkedDocs.has(docId) && checkedDocs.size > 1) {
        setPendingChanges((prev) => {
          const next = new Map(prev);
          for (const checkedId of checkedDocs) {
            if (checkedId === docId) {
              continue;
            }
            next.set(checkedId, status);
          }
          return next;
        });
      }
    },
    [collection, setStatusWithCascade, checkedDocs]
  );

  const renderDocNode = (node: NavigationNode, depth: number) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedDocs.has(node.id);
    const isChanged = pendingChanges.has(node.id);
    const isChecked = checkedDocs.has(node.id);
    const currentStatus = getEffectiveStatus(node.id);

    return (
      <div key={node.id}>
        <DocRow $depth={depth} $changed={isChanged}>
          <DocLeft>
            <Checkbox
              type="checkbox"
              checked={isChecked}
              onChange={() => toggleCheck(node.id, node.children)}
            />
            {hasChildren ? (
              <ExpandBtn onClick={() => toggleDoc(node.id)}>
                {isExpanded ? "▾" : "▸"}
              </ExpandBtn>
            ) : (
              <ExpandPlaceholder />
            )}
            <DocTitle $depth={depth}>
              {node.emoji && <span>{node.emoji} </span>}
              {node.title || "Untitled"}
            </DocTitle>
          </DocLeft>
          <InlineStatusDropdown
            docId={node.id}
            currentStatus={currentStatus}
            onChangeStatus={handleChangeStatus}
          />
        </DocRow>
        {hasChildren && isExpanded && (
          <div>
            {node.children.map((child) => renderDocNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const docNodes = collection?.sortedDocuments ?? [];

  return (
    <Modal
      isOpen={isOpen}
      onRequestClose={onClose}
      title={
        collection
          ? `Manage Statuses — ${collection.name}`
          : "Manage Document Statuses"
      }
      width="720px"
    >
      <ModalBody>
        {loading ? (
          <LoadingContainer>
            <Spinner />
          </LoadingContainer>
        ) : (
          <DocList>
            {docNodes.length === 0 ? (
              <EmptyText>No documents in this collection</EmptyText>
            ) : (
              docNodes.map((node) => renderDocNode(node, 0))
            )}
          </DocList>
        )}

        <Footer>
          <ChangeCount>
            {pendingChanges.size > 0
              ? `${pendingChanges.size} change${pendingChanges.size > 1 ? "s" : ""} pending`
              : "No changes"}
          </ChangeCount>
          <FooterActions>
            <Button $neutral onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || pendingChanges.size === 0}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </FooterActions>
        </Footer>
      </ModalBody>
    </Modal>
  );
}

/* ─── Inline dropdown styled components ─── */

const DropdownWrapper = styled.div`
  position: relative;
  flex-shrink: 0;
`;

const BadgeButton = styled.button<{ $color: string; $bg: string }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 12px;
  border: 1px solid ${(props) => props.$color}33;
  background: ${(props) => props.$bg};
  color: ${(props) => props.$color};
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 150ms ease;
  white-space: nowrap;
  line-height: 1;
  flex-shrink: 0;

  &:hover {
    border-color: ${(props) => props.$color}66;
    box-shadow: 0 1px 4px ${(props) => props.$color}22;
  }
`;

const Dot = styled.span<{ $color: string }>`
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: ${(props) => props.$color};
  flex-shrink: 0;
`;

const Chevron = styled.span<{ $open: boolean }>`
  font-size: 9px;
  transition: transform 150ms ease;
  transform: ${(props) => (props.$open ? "rotate(180deg)" : "rotate(0)")};
`;

const DropdownMenu = styled.div`
  position: fixed;
  z-index: 10000;
  min-width: 155px;
  padding: 4px;
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  box-shadow: ${(props) =>
    props.theme.isDark
      ? "0 4px 16px rgba(0, 0, 0, 0.4)"
      : "0 4px 16px rgba(0, 0, 0, 0.1)"};
`;

const MenuItem = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: 6px;
  background: ${(props) =>
    props.$active ? s("listItemHoverBackground")(props) : "transparent"};
  color: ${s("text")};
  font-size: 12px;
  cursor: pointer;
  transition: background 100ms ease;

  &:hover {
    background: ${s("listItemHoverBackground")};
  }
`;

const MenuLabel = styled.span`
  flex: 1;
  text-align: left;
`;

const CheckMark = styled.span`
  font-size: 13px;
  font-weight: 700;
  color: ${s("accent")};
`;

/* ─── Modal body styled components ─── */

const ModalBody = styled.div`
  display: flex;
  flex-direction: column;
`;

const LoadingContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 40px;
`;

const DocList = styled.div`
  flex: 1;
  padding-bottom: 4px;
`;

const DocRow = styled.div<{ $depth: number; $changed: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 4px 6px ${(props) => 8 + props.$depth * 20}px;
  border-radius: 4px;
  background: ${(props) =>
    props.$changed ? "rgba(245, 158, 11, 0.06)" : "transparent"};

  &:hover {
    background: ${s("listItemHoverBackground")};
  }
`;

const DocLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
`;

const Checkbox = styled.input`
  width: 15px;
  height: 15px;
  margin: 0 4px 0 0;
  cursor: pointer;
  accent-color: ${s("accent")};
  flex-shrink: 0;
`;

const ExpandBtn = styled.button`
  background: none;
  border: none;
  padding: 0;
  width: 16px;
  cursor: pointer;
  color: ${s("textTertiary")};
  font-size: 12px;
  flex-shrink: 0;
`;

const ExpandPlaceholder = styled.span`
  width: 16px;
  flex-shrink: 0;
`;

const DocTitle = styled.span<{ $depth: number }>`
  font-size: 13px;
  color: ${s("text")};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: ${(props) => (props.$depth === 0 ? 500 : 400)};
`;

const EmptyText = styled.div`
  padding: 12px 28px;
  font-size: 13px;
  color: ${s("textTertiary")};
  font-style: italic;
`;

const Footer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 16px;
  border-top: 1px solid ${s("divider")};
  margin-top: 12px;
  flex-shrink: 0;
`;

const ChangeCount = styled.span`
  font-size: 12px;
  color: ${s("textTertiary")};
`;

const FooterActions = styled.div`
  display: flex;
  gap: 8px;
`;

export default observer(ViewAllStatusModal);
