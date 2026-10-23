import * as React from "react";
import { useTranslation } from "react-i18next";
import styled, { css } from "styled-components";
import { s } from "@shared/styles";
import { format, isBefore, startOfDay } from "date-fns";
import { PlusIcon, UserIcon, DocumentIcon } from "outline-icons";
import ImplementCardButton from "~/components/Kanban/ImplementCardButton";
import type { Member, RelatedDocument } from "./types";

const PRIORITIES = [
  { value: "Blocked", label: "Blocked", color: "#B91C1C" },
  { value: "Critical", label: "Critical", color: "#DC2626" },
  { value: "High", label: "High", color: "#F97316" },
  { value: "Medium", label: "Medium", color: "#FACC15" },
];

interface SearchResult {
  id: string;
  title: string;
  url: string;
}

interface CardDetailSidebarProps {
  cardId: string;
  implementStatus: string;
  implementError: string | null;
  listName: string;
  priority: string | null | undefined;
  cardMembers: Member[];
  teamMembers: Array<{ id: string; name: string; avatarUrl?: string; email: string }>;
  dueDate: string;
  relatedDocuments: RelatedDocument[];
  onPriorityChange: (priority: string | null) => Promise<void>;
  onAddMember: (userId: string) => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
  onDueDateChange: (date: string) => Promise<void>;
  onClearDueDate: () => Promise<void>;
  onSearchDocuments: (query: string) => Promise<SearchResult[]>;
  onAddRelatedDocument: (documentId: string) => Promise<void>;
  onRemoveRelatedDocument: (documentId: string) => Promise<void>;
}

/**
 * Sidebar component for the card detail page.
 *
 * @param props - The component props.
 * @returns the sidebar component.
 */
function CardDetailSidebar({
  cardId,
  implementStatus,
  implementError,
  listName,
  priority,
  cardMembers,
  teamMembers,
  dueDate,
  relatedDocuments,
  onPriorityChange,
  onAddMember,
  onRemoveMember,
  onDueDateChange,
  onClearDueDate,
  onSearchDocuments,
  onAddRelatedDocument,
  onRemoveRelatedDocument,
}: CardDetailSidebarProps) {
  const { t } = useTranslation();
  const [showPrioritySelector, setShowPrioritySelector] = React.useState(false);
  const [showMemberSelector, setShowMemberSelector] = React.useState(false);
  const [showDocumentSearch, setShowDocumentSearch] = React.useState(false);
  const [documentQuery, setDocumentQuery] = React.useState("");
  const [documentResults, setDocumentResults] = React.useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);
  const [selectedDocument, setSelectedDocument] = React.useState<SearchResult | null>(null);
  const [isSavingDocument, setIsSavingDocument] = React.useState(false);
  const searchTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>();
  const dateInputRef = React.useRef<HTMLInputElement>(null);

  const isOverdue = dueDate && isBefore(new Date(dueDate), startOfDay(new Date()));
  
  const unassignedMembers = teamMembers.filter(
    (user) => !cardMembers.some((cm) => cm.id === user.id)
  );

  const currentPriority = PRIORITIES.find(p => p.value === priority);

  const handleSelectPriority = React.useCallback(async (value: string | null) => {
    await onPriorityChange(value);
    setShowPrioritySelector(false);
  }, [onPriorityChange]);

  const handleAddMember = React.useCallback(async (userId: string) => {
    await onAddMember(userId);
    setShowMemberSelector(false);
  }, [onAddMember]);

  // Load all documents when the search panel opens
  const loadAllDocuments = React.useCallback(async () => {
    setIsSearching(true);
    try {
      const results = await onSearchDocuments("");
      const filtered = results.filter(
        (r) => !relatedDocuments.some((rd) => rd.id === r.id)
      );
      setDocumentResults(filtered);
    } catch {
      setDocumentResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [onSearchDocuments, relatedDocuments]);

  const handleOpenDocumentSearch = React.useCallback(() => {
    setShowDocumentSearch(true);
    void loadAllDocuments();
  }, [loadAllDocuments]);

  const handleDocumentSearch = React.useCallback((query: string) => {
    setDocumentQuery(query);
    setSelectedDocument(null);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await onSearchDocuments(query.trim());
        // Filter out already linked documents
        const filtered = results.filter(
          (r) => !relatedDocuments.some((rd) => rd.id === r.id)
        );
        setDocumentResults(filtered);
      } catch {
        setDocumentResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, [onSearchDocuments, relatedDocuments]);

  const handleSelectDocument = React.useCallback((doc: SearchResult) => {
    setSelectedDocument(doc);
    setDocumentQuery(doc.title);
  }, []);

  const handleSaveRelatedDocument = React.useCallback(async () => {
    if (!selectedDocument) {
      return;
    }

    setIsSavingDocument(true);
    try {
      await onAddRelatedDocument(selectedDocument.id);
      setSelectedDocument(null);
      setDocumentQuery("");
      setShowDocumentSearch(false);
    } catch {
      // error handled by parent
    } finally {
      setIsSavingDocument(false);
    }
  }, [selectedDocument, onAddRelatedDocument]);

  const handleCancelDocumentSearch = React.useCallback(() => {
    setShowDocumentSearch(false);
    setDocumentQuery("");
    setDocumentResults([]);
    setSelectedDocument(null);
  }, []);

  return (
    <Sidebar>
      {/* List Info */}
      <SidebarSection>
        <SidebarLabel>{t("List")}</SidebarLabel>
        <SidebarValue>{listName || t("Unknown")}</SidebarValue>
      </SidebarSection>
      
      {/* Priority Section */}
      <SidebarSection>
        <SidebarLabel>{t("Priority")}</SidebarLabel>
        <PriorityContainer>
          {currentPriority ? (
            <PriorityBadge $color={currentPriority.color}>
              {currentPriority.label}
              <RemoveButton onClick={() => void handleSelectPriority(null)}>×</RemoveButton>
            </PriorityBadge>
          ) : null}
          {showPrioritySelector ? (
            <PrioritySelector>
              {PRIORITIES.map(p => (
                <PriorityOption
                  key={p.value}
                  $isSelected={p.value === priority}
                  onClick={() => void handleSelectPriority(p.value)}
                >
                  <PriorityDot $color={p.color} />
                  {p.label}
                </PriorityOption>
              ))}
              {currentPriority && (
                <PriorityOption
                  $isSelected={false}
                  onClick={() => void handleSelectPriority(null)}
                >
                  {t("Clear priority")}
                </PriorityOption>
              )}
              <CancelLink onClick={() => setShowPrioritySelector(false)}>
                {t("Cancel")}
              </CancelLink>
            </PrioritySelector>
          ) : (
            <AddLink onClick={() => setShowPrioritySelector(true)}>
              <PlusIcon size={14} />
              {currentPriority ? t("Change priority") : t("Set priority")}
            </AddLink>
          )}
        </PriorityContainer>
      </SidebarSection>
      
      {/* Members Section */}
      <SidebarSection>
        <SidebarLabel>{t("Members")}</SidebarLabel>
        <MembersContainer>
          {cardMembers.map((member) => (
            <MemberBadge key={member.id}>
              <MemberAvatar>
                {member.avatarUrl ? (
                  <img src={member.avatarUrl} alt={member.name} />
                ) : (
                  <UserIcon size={16} />
                )}
              </MemberAvatar>
              <span>{member.name || member.email}</span>
              <RemoveButton onClick={() => onRemoveMember(member.id)}>×</RemoveButton>
            </MemberBadge>
          ))}
          {showMemberSelector ? (
            <MemberSelector>
              {unassignedMembers.length > 0 ? (
                unassignedMembers.map(user => (
                  <MemberOption key={user.id} onClick={() => handleAddMember(user.id)}>
                    <MemberAvatar>
                      {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt={user.name} />
                      ) : (
                        <UserIcon size={16} />
                      )}
                    </MemberAvatar>
                    <span>{user.name || user.email}</span>
                  </MemberOption>
                ))
              ) : (
                <NoItemsText>{t("No members available")}</NoItemsText>
              )}
              <CancelLink onClick={() => setShowMemberSelector(false)}>
                {t("Cancel")}
              </CancelLink>
            </MemberSelector>
          ) : (
            <AddLink onClick={() => setShowMemberSelector(true)}>
              <PlusIcon size={14} />
              {t("Add member")}
            </AddLink>
          )}
        </MembersContainer>
      </SidebarSection>
      
      {/* Due Date Section */}
      <SidebarSection>
        <SidebarLabel>{t("Due date")}</SidebarLabel>
        <DateInputWrapper>
          {dueDate ? (
            <DueDateDisplay $isOverdue={!!isOverdue}>
              {format(new Date(dueDate), "MMM d, yyyy")}
              {isOverdue && <OverdueLabel>{t("Overdue")}</OverdueLabel>}
              <RemoveButton onClick={() => void onClearDueDate()}>×</RemoveButton>
            </DueDateDisplay>
          ) : (
            <AddLink onClick={() => dateInputRef.current?.showPicker()}>
              <PlusIcon size={14} />
              {t("Set due date")}
            </AddLink>
          )}
          <HiddenDateInput
            ref={dateInputRef}
            type="date"
            value={dueDate}
            onChange={(e) => void onDueDateChange(e.target.value)}
          />
        </DateInputWrapper>
      </SidebarSection>

      {/* Related Documents Section */}
      <SidebarSection>
        <SidebarLabel>{t("Related documents")}</SidebarLabel>
        <RelatedDocsContainer>
          {relatedDocuments.map((doc) => (
            <RelatedDocBadge key={doc.id}>
              <DocumentIcon size={16} />
              <RelatedDocLink href={doc.url} target="_blank" rel="noopener noreferrer">
                {doc.title}
              </RelatedDocLink>
              <RemoveButton onClick={() => void onRemoveRelatedDocument(doc.id)}>×</RemoveButton>
            </RelatedDocBadge>
          ))}
          {showDocumentSearch ? (
            <DocumentSearchContainer>
              <DocumentSearchInput
                type="text"
                value={documentQuery}
                onChange={(e) => handleDocumentSearch(e.target.value)}
                placeholder={t("Search documents...")}
                autoFocus
              />
              {isSearching && (
                <SearchStatus>{t("Searching...")}</SearchStatus>
              )}
              {!isSearching && documentResults.length > 0 && (
                <DocumentDropdown>
                  {documentResults.map((doc) => (
                    <DocumentOption
                      key={doc.id}
                      $isSelected={selectedDocument?.id === doc.id}
                      onClick={() => handleSelectDocument(doc)}
                    >
                      <DocumentIcon size={16} />
                      <span>{doc.title}</span>
                    </DocumentOption>
                  ))}
                </DocumentDropdown>
              )}
              {!isSearching && documentResults.length === 0 && !selectedDocument && (
                <SearchStatus>{t("No documents found")}</SearchStatus>
              )}
              <DocumentSearchActions>
                <SaveButton
                  onClick={() => void handleSaveRelatedDocument()}
                  disabled={!selectedDocument || isSavingDocument}
                >
                  {isSavingDocument ? t("Saving...") : t("Save")}
                </SaveButton>
                <CancelLink onClick={handleCancelDocumentSearch}>
                  {t("Cancel")}
                </CancelLink>
              </DocumentSearchActions>
            </DocumentSearchContainer>
          ) : (
            <AddLink onClick={handleOpenDocumentSearch}>
              <PlusIcon size={14} />
              {t("Add related document")}
            </AddLink>
          )}
        </RelatedDocsContainer>
      </SidebarSection>

      {/* Implement Section */}
      <SidebarSection>
        <SidebarLabel>{t("Implement")}</SidebarLabel>
        <ImplementWrapper>
          <ImplementCardButton
            cardId={cardId}
            implementStatus={implementStatus}
            implementError={implementError}
          />
        </ImplementWrapper>
      </SidebarSection>
    </Sidebar>
  );
}

const Sidebar = styled.div`
  width: 280px;
  flex-shrink: 0;
  
  @media (max-width: 768px) {
    width: 100%;
  }
`;

const SidebarSection = styled.div`
  margin-bottom: 24px;
`;

const SidebarLabel = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: ${s("textTertiary")};
  text-transform: uppercase;
  margin-bottom: 8px;
`;

const SidebarValue = styled.div`
  font-size: 14px;
  color: ${s("text")};
`;

const PriorityContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const PriorityBadge = styled.div<{ $color: string }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 4px;
  background: ${props => props.$color || "#3B82F6"};
  color: white;
  font-size: 12px;
  font-weight: 500;
  width: fit-content;
`;

const PrioritySelector = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid ${s("inputBorder")};
  border-radius: 4px;
  background: ${s("menuBackground")};
`;

const PriorityOption = styled.button<{ $isSelected: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: none;
  border-radius: 4px;
  background: ${props => props.$isSelected ? s("backgroundSecondary")(props) : "transparent"};
  cursor: pointer;
  text-align: left;
  color: ${s("text")};
  font-weight: ${props => props.$isSelected ? 600 : 400};
  
  &:hover {
    background: ${s("backgroundSecondary")};
  }
`;

const PriorityDot = styled.div<{ $color: string }>`
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: ${props => props.$color};
`;

const RemoveButton = styled.button`
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
  color: currentColor;
  opacity: 0.7;
  font-size: 14px;
  line-height: 1;
  transition: opacity 0.15s ease;

  &:hover {
    opacity: 1;
  }
`;

const AddLink = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  color: ${s("accent")};
  font-size: 14px;
  cursor: pointer;
  padding: 4px 0;
  
  &:hover {
    text-decoration: underline;
  }
`;

const MembersContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const MemberBadge = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 20px;
  background: ${s("backgroundSecondary")};
  color: ${s("text")};
  font-size: 12px;
  width: fit-content;

  ${RemoveButton} {
    margin-left: 4px;
  }
`;

const MemberAvatar = styled.div`
  width: 24px;
  height: 24px;
  border-radius: 50%;
  overflow: hidden;
  background: ${s("sidebarBackground")};
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${s("textTertiary")};
  
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;

const MemberSelector = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid ${s("inputBorder")};
  border-radius: 4px;
  background: ${s("menuBackground")};
  max-height: 200px;
  overflow-y: auto;
`;

const MemberOption = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: ${s("text")};
  
  &:hover {
    background: ${s("backgroundSecondary")};
  }
`;

const NoItemsText = styled.span`
  font-size: 12px;
  color: ${s("textTertiary")};
  padding: 8px;
`;

const CancelLink = styled.button`
  background: transparent;
  border: none;
  color: ${s("textTertiary")};
  font-size: 12px;
  cursor: pointer;
  padding: 4px 8px;
  text-align: left;
  
  &:hover {
    color: ${s("text")};
  }
`;

const DateInputWrapper = styled.div`
  position: relative;
`;

const DueDateDisplay = styled.div<{ $isOverdue?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  background: ${s("backgroundSecondary")};
  font-size: 14px;
  color: ${s("text")};
  width: fit-content;

  ${RemoveButton} {
    margin-left: 4px;
  }

  ${props => props.$isOverdue && css`
    background: ${s("danger")};
    color: white;
  `}
`;

const OverdueLabel = styled.span`
  font-size: 12px;
  font-weight: 500;
`;

const HiddenDateInput = styled.input`
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
`;

const RelatedDocsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const RelatedDocBadge = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  background: ${s("backgroundSecondary")};
  color: ${s("text")};
  font-size: 13px;

  ${RemoveButton} {
    margin-left: auto;
    flex-shrink: 0;
  }
`;

const RelatedDocLink = styled.a`
  color: ${s("accent")};
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;

  &:hover {
    text-decoration: underline;
  }
`;

const DocumentSearchContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid ${s("inputBorder")};
  border-radius: 4px;
  background: ${s("menuBackground")};
`;

const DocumentSearchInput = styled.input`
  width: 100%;
  padding: 8px;
  border: 1px solid ${s("inputBorder")};
  border-radius: 4px;
  background: ${s("background")};
  color: ${s("text")};
  font-size: 13px;
  outline: none;
  box-sizing: border-box;

  &:focus {
    border-color: ${s("accent")};
  }

  &::placeholder {
    color: ${s("placeholder")};
  }
`;

const DocumentDropdown = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
`;

const DocumentOption = styled.button<{ $isSelected: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: none;
  border-radius: 4px;
  background: ${(props) =>
    props.$isSelected ? s("accent")(props) : "transparent"};
  color: ${(props) =>
    props.$isSelected ? "white" : s("text")(props)};
  cursor: pointer;
  text-align: left;
  font-size: 13px;

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:hover {
    background: ${(props) =>
      props.$isSelected ? s("accent")(props) : s("backgroundSecondary")(props)};
  }
`;

const SearchStatus = styled.span`
  font-size: 12px;
  color: ${s("textTertiary")};
  padding: 4px 0;
`;

const DocumentSearchActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 4px;
`;

const SaveButton = styled.button`
  padding: 6px 16px;
  border: none;
  border-radius: 4px;
  background: ${s("accent")};
  color: white;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s ease;

  &:hover {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ImplementWrapper = styled.div`
  & > div {
    position: relative;
    bottom: auto;
    right: auto;
    opacity: 1;
    max-height: none;
    overflow: visible;
    margin-top: 0;
    width: 100%;
  }

  button {
    padding: 8px 12px;
    font-size: 13px;
    min-height: 36px;
    width: 100%;
    justify-content: center;
  }
`;

export default CardDetailSidebar;
