import { observer } from "mobx-react";
import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import { s } from "@shared/styles";
import { DocumentStatus } from "@shared/types";
import type Document from "~/models/Document";
import usePolicy from "~/hooks/usePolicy";
import { client } from "~/utils/ApiClient";
import ViewAllStatusModal from "~/components/ViewAllStatusModal";

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
    document: Document;
    readOnly?: boolean;
};

function DocumentStatusDropdown({ document, readOnly }: Props) {
    const [isOpen, setIsOpen] = useState(false);
    const [showViewAll, setShowViewAll] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
    const can = usePolicy(document);
    const canEdit = can.update && !readOnly;

    const handleOpenViewAll = useCallback(() => {
        setIsOpen(false);
        setShowViewAll(true);
    }, []);

    const config = STATUS_CONFIG[document.status] ?? STATUS_CONFIG[DocumentStatus.InProgress];

    const handleToggle = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (canEdit) {
            setIsOpen((prev) => !prev);
        }
    }, [canEdit]);

    const handleSelect = useCallback(
        async (status: DocumentStatus) => {
            setIsOpen(false);
            if (status !== document.status) {
                const previousStatus = document.status;
                document.status = status;
                try {
                    await client.post("/documents.update", {
                        id: document.id,
                        status,
                    });
                } catch {
                    document.status = previousStatus;
                }
            }
        },
        [document]
    );

    // Position the dropdown portal based on badge location
    useEffect(() => {
        if (isOpen && ref.current) {
            const rect = ref.current.getBoundingClientRect();
            setDropdownPos({
                top: rect.bottom + 4,
                left: rect.left,
            });
        }
    }, [isOpen]);

    // Close on click outside (handles both badge ref and portal dropdown ref)
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            if (
                ref.current && !ref.current.contains(target) &&
                dropdownRef.current && !dropdownRef.current.contains(target)
            ) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            window.document.addEventListener("mousedown", handleClickOutside);
        }
        return () => {
            window.document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isOpen]);

    return (
        <Container ref={ref}>
            <StatusBadge
                onClick={handleToggle}
                $color={config.color}
                $bg={config.bg}
                $clickable={canEdit}
            >
                <StatusDot $color={config.color} />
                {config.label}
                {canEdit && <Chevron $open={isOpen}>▾</Chevron>}
            </StatusBadge>

            {isOpen && createPortal(
                <DropdownPortal
                    ref={dropdownRef}
                    style={{ top: dropdownPos.top, left: dropdownPos.left }}
                >
                    {STATUS_ORDER.map((status) => {
                        const cfg = STATUS_CONFIG[status];
                        const isActive = document.status === status;
                        return (
                            <DropdownItem
                                key={status}
                                onClick={(e: React.MouseEvent) => {
                                    e.stopPropagation();
                                    handleSelect(status);
                                }}
                                $active={isActive}
                            >
                                <StatusDot $color={cfg.color} />
                                <ItemLabel>{cfg.label}</ItemLabel>
                                {isActive && <CheckMark>✓</CheckMark>}
                            </DropdownItem>
                        );
                    })}
                    <Divider />
                    <DropdownItem
                        $active={false}
                        onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            handleOpenViewAll();
                        }}
                    >
                        <ViewAllIcon>⊞</ViewAllIcon>
                        <ItemLabel>View All</ItemLabel>
                    </DropdownItem>
                </DropdownPortal>,
                window.document.body
            )}

            <ViewAllStatusModal
                isOpen={showViewAll}
                onClose={() => setShowViewAll(false)}
                collectionId={document.collectionId ?? ""}
            />
        </Container>
    );
}

const Container = styled.div`
  position: relative;
  display: inline-flex;
  align-items: center;
  margin-left: 8px;
  flex-shrink: 0;
`;

const StatusBadge = styled.button<{
    $color: string;
    $bg: string;
    $clickable: boolean;
}>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 12px;
  border: 1px solid ${(props) => props.$color}33;
  background: ${(props) => props.$bg};
  color: ${(props) => props.$color};
  font-size: 12px;
  font-weight: 600;
  cursor: ${(props) => (props.$clickable ? "pointer" : "default")};
  transition: all 150ms ease;
  white-space: nowrap;
  line-height: 1;

  &:hover {
    ${(props) =>
        props.$clickable &&
        `
      border-color: ${props.$color}66;
      box-shadow: 0 1px 4px ${props.$color}22;
    `}
  }
`;

const StatusDot = styled.span<{ $color: string }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${(props) => props.$color};
  flex-shrink: 0;
`;

const Chevron = styled.span<{ $open: boolean }>`
  font-size: 10px;
  transition: transform 150ms ease;
  transform: ${(props) => (props.$open ? "rotate(180deg)" : "rotate(0)")};
`;

const DropdownPortal = styled.div`
  position: fixed;
  z-index: 1000;
  min-width: 160px;
  padding: 4px;
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  box-shadow: ${(props) =>
        props.theme.isDark
            ? "0 4px 16px rgba(0, 0, 0, 0.4)"
            : "0 4px 16px rgba(0, 0, 0, 0.1)"};
`;

const DropdownItem = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: ${(props) =>
        props.$active ? s("listItemHoverBackground")(props) : "transparent"};
  color: ${s("text")};
  font-size: 13px;
  cursor: pointer;
  transition: background 100ms ease;

  &:hover {
    background: ${s("listItemHoverBackground")};
  }
`;

const ItemLabel = styled.span`
  flex: 1;
  text-align: left;
`;

const CheckMark = styled.span`
  font-size: 14px;
  font-weight: 700;
  color: ${s("accent")};
`;

const Divider = styled.div`
  height: 1px;
  background: ${s("divider")};
  margin: 4px 0;
`;

const ViewAllIcon = styled.span`
  font-size: 14px;
  color: ${s("textTertiary")};
  width: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
`;

export default observer(DocumentStatusDropdown);
