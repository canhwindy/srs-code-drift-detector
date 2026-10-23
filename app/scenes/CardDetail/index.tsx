import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useParams, useHistory } from "react-router-dom";
import styled, { keyframes } from "styled-components";
import { s, depths } from "@shared/styles";
import { format } from "date-fns";
import { TableIcon, ImageIcon, CloseIcon, ZoomInIcon, ZoomOutIcon } from "outline-icons";
import { AttachmentPreset } from "@shared/types";
import Text from "~/components/Text";
import Scene from "~/components/Scene";
import Linkify from "~/components/Linkify";
import MentionInput from "~/components/MentionInput";
import useStores from "~/hooks/useStores";
import { toast } from "sonner";
import { kanbanPath } from "~/utils/routeHelpers";
import { uploadFile } from "~/utils/files";
import CardDetailChecklist from "./CardDetailChecklist";
import CardDetailActivity from "./CardDetailActivity";
import CardDetailSidebar from "./CardDetailSidebar";
import type { ActivityEvent, Checklist, Member, RelatedDocument } from "./types";

/**
 * Page for viewing and editing Kanban card details.
 *
 * @returns the card detail scene component.
 */
function CardDetail() {
  const { t } = useTranslation();
  const history = useHistory();
  const { cardId } = useParams<{ cardId: string }>();
  const { kanbanCards, kanbanBoards, kanbanLists, kanbanChecklists, users, documents } = useStores();

  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [dueDate, setDueDate] = React.useState<string>("");
  const [, setIsSaving] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [newComment, setNewComment] = React.useState("");
  const [isSubmittingComment, setIsSubmittingComment] = React.useState(false);
  const [activities, setActivities] = React.useState<ActivityEvent[]>([]);
  const [checklists, setChecklists] = React.useState<Checklist[]>([]);
  const [isEditingDescription, setIsEditingDescription] = React.useState(false);
  const [isUploadingImage, setIsUploadingImage] = React.useState(false);
  const [lightboxImage, setLightboxImage] = React.useState<{ src: string; alt: string } | null>(null);
  const descriptionTextareaRef = React.useRef<HTMLTextAreaElement>(null);
  const descriptionFileInputRef = React.useRef<HTMLInputElement>(null);

  const card = kanbanCards.get(cardId);
  const list = card ? kanbanLists.get(card.listId) : null;
  const board = list ? kanbanBoards.get(list.boardId) : null;

  // Get all team members
  const teamMembers = React.useMemo(() => Array.from(users.all || []), [users.all]);

  // Load card details, activities, and checklists
  React.useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);

        // Fetch card details if not in store
        if (!kanbanCards.get(cardId)) {
          await kanbanCards.fetch(cardId);
        }

        // Fetch activities
        const activitiesResponse = await kanbanCards.fetchActivities(cardId);
        if (activitiesResponse) {
          setActivities(activitiesResponse);
        }

        // Fetch checklists
        const checklistsResponse = await kanbanChecklists.fetchForCard(cardId);
        if (checklistsResponse) {
          setChecklists(checklistsResponse);
        }

        // Fetch users
        await users.fetchPage({ limit: 100 });
      } catch (_error) {
        toast.error(t("Failed to load card details"));
      } finally {
        setIsLoading(false);
      }
    };

    void loadData();
  }, [cardId, kanbanCards, kanbanChecklists, users, t]);

  // Initialize form values
  React.useEffect(() => {
    if (card) {
      setTitle(card.title || "");
      setDescription(card.description || "");
      setDueDate(card.dueDate ? format(new Date(card.dueDate), "yyyy-MM-dd") : "");
    }
  }, [card]);

  const handleBack = React.useCallback(() => {
    history.push(kanbanPath());
  }, [history]);

  const handleSave = React.useCallback(async () => {
    if (!card) {
      return;
    }

    setIsSaving(true);
    try {
      await kanbanCards.update({
        id: card.id,
        title,
        description: description || undefined,
      });

      // Update due date separately if changed
      if (dueDate !== (card.dueDate ? format(new Date(card.dueDate), "yyyy-MM-dd") : "")) {
        await kanbanCards.updateDueDate(card.id, dueDate ? new Date(dueDate) : null);
      }

      toast.success(t("Card updated"));
    } catch (_error) {
      toast.error(t("Failed to update card"));
    } finally {
      setIsSaving(false);
    }
  }, [card, title, description, dueDate, kanbanCards, t]);

  const handlePriorityChange = React.useCallback(async (priority: string | null) => {
    if (!card) {
      return;
    }

    try {
      await kanbanCards.updatePriority(card.id, priority);
      toast.success(t("Priority updated"));
    } catch (_error) {
      toast.error(t("Failed to update priority"));
    }
  }, [card, kanbanCards, t]);

  const handleAddMember = React.useCallback(async (userId: string) => {
    if (!card) {
      return;
    }

    try {
      await kanbanCards.addMember(card.id, userId);
      toast.success(t("Member added"));
    } catch (_error) {
      toast.error(t("Failed to add member"));
    }
  }, [card, kanbanCards, t]);

  const handleRemoveMember = React.useCallback(async (userId: string) => {
    if (!card) {
      return;
    }

    try {
      await kanbanCards.removeMember(card.id, userId);
      toast.success(t("Member removed"));
    } catch (_error) {
      toast.error(t("Failed to remove member"));
    }
  }, [card, kanbanCards, t]);

  const handleAddComment = React.useCallback(async (attachments?: File[]) => {
    if (!card) {
      return;
    }

    if (!newComment.trim() && (!attachments || attachments.length === 0)) {
      return;
    }

    setIsSubmittingComment(true);
    try {
      // Upload attachments first
      const attachmentIds: string[] = [];
      if (attachments && attachments.length > 0) {
        for (const file of attachments) {
          const attachment = await uploadFile(file, {
            preset: AttachmentPreset.DocumentAttachment,
          });
          attachmentIds.push(attachment.id);
        }
      }

      // Add comment with attachment IDs
      await kanbanCards.addComment(card.id, newComment.trim() || " ", undefined, attachmentIds);
      setNewComment("");

      // Refresh activities
      const response = await kanbanCards.fetchActivities(cardId);
      if (response) {
        setActivities(response);
      }
      toast.success(t("Comment added"));
    } catch (_error) {
      toast.error(t("Failed to add comment"));
    } finally {
      setIsSubmittingComment(false);
    }
  }, [card, cardId, newComment, kanbanCards, t]);

  const handleAddReply = React.useCallback(async (parentId: string, replyText: string, attachments?: File[]) => {
    if (!card || (!replyText.trim() && (!attachments || attachments.length === 0))) {
      return;
    }

    try {
      // Upload attachments first
      const attachmentIds: string[] = [];
      if (attachments && attachments.length > 0) {
        for (const file of attachments) {
          const attachment = await uploadFile(file, {
            preset: AttachmentPreset.DocumentAttachment,
          });
          attachmentIds.push(attachment.id);
        }
      }

      // Add reply with attachment IDs
      await kanbanCards.addComment(card.id, replyText.trim() || " ", parentId, attachmentIds);

      // Refresh activities
      const response = await kanbanCards.fetchActivities(cardId);
      if (response) {
        setActivities(response);
      }
      toast.success(t("Reply added"));
    } catch (error) {
      toast.error(t("Failed to add reply"));
      throw error; // Re-throw to let the caller handle it
    }
  }, [card, cardId, kanbanCards, t]);

  const handleAddChecklist = React.useCallback(async (title: string) => {
    if (!card) {
      return;
    }

    try {
      const checklist = await kanbanChecklists.create(card.id, title);
      setChecklists(prev => [...prev, checklist]);
      // Refresh activities
      const response = await kanbanCards.fetchActivities(cardId);
      if (response) {
        setActivities(response);
      }
      toast.success(t("Checklist added"));
    } catch (_error) {
      toast.error(t("Failed to add checklist"));
    }
  }, [card, cardId, kanbanChecklists, kanbanCards, t]);

  const handleDeleteChecklist = React.useCallback(async (checklistId: string) => {
    try {
      await kanbanChecklists.delete(checklistId);
      setChecklists(prev => prev.filter(c => c.id !== checklistId));
      toast.success(t("Checklist deleted"));
    } catch (_error) {
      toast.error(t("Failed to delete checklist"));
    }
  }, [kanbanChecklists, t]);

  const handleAddChecklistItem = React.useCallback(async (checklistId: string, title: string) => {
    try {
      const item = await kanbanChecklists.addItem(checklistId, title);
      setChecklists(prev => prev.map(c => {
        if (c.id === checklistId) {
          return {
            ...c,
            items: [...c.items, item],
            totalCount: c.totalCount + 1,
          };
        }
        return c;
      }));
      // Refresh activities
      const response = await kanbanCards.fetchActivities(cardId);
      if (response) {
        setActivities(response);
      }
    } catch (_error) {
      toast.error(t("Failed to add item"));
    }
  }, [kanbanChecklists, kanbanCards, cardId, t]);

  const handleToggleChecklistItem = React.useCallback(async (checklistId: string, itemId: string, isCompleted: boolean) => {
    try {
      await kanbanChecklists.updateItem(itemId, { isCompleted: !isCompleted });
      setChecklists(prev => prev.map(c => {
        if (c.id === checklistId) {
          return {
            ...c,
            items: c.items.map(item => {
              if (item.id === itemId) {
                return { ...item, isCompleted: !isCompleted };
              }
              return item;
            }),
            completedCount: isCompleted ? c.completedCount - 1 : c.completedCount + 1,
          };
        }
        return c;
      }));
      // Refresh activities
      const response = await kanbanCards.fetchActivities(cardId);
      if (response) {
        setActivities(response);
      }
    } catch (_error) {
      toast.error(t("Failed to update item"));
    }
  }, [kanbanChecklists, kanbanCards, cardId, t]);

  const handleDeleteChecklistItem = React.useCallback(async (checklistId: string, itemId: string, isCompleted: boolean) => {
    try {
      await kanbanChecklists.deleteItem(itemId);
      setChecklists(prev => prev.map(c => {
        if (c.id === checklistId) {
          return {
            ...c,
            items: c.items.filter(item => item.id !== itemId),
            totalCount: c.totalCount - 1,
            completedCount: isCompleted ? c.completedCount - 1 : c.completedCount,
          };
        }
        return c;
      }));
    } catch (_error) {
      toast.error(t("Failed to delete item"));
    }
  }, [kanbanChecklists, t]);

  const handleDueDateChange = React.useCallback(async (date: string) => {
    if (!card) {
      return;
    }
    setDueDate(date);
    try {
      await kanbanCards.updateDueDate(card.id, date ? new Date(date) : null);
      toast.success(t("Due date updated"));
    } catch (_error) {
      toast.error(t("Failed to update due date"));
    }
  }, [card, kanbanCards, t]);

  const handleClearDueDate = React.useCallback(async () => {
    if (!card) {
      return;
    }
    setDueDate("");
    try {
      await kanbanCards.updateDueDate(card.id, null);
      toast.success(t("Due date cleared"));
    } catch (_error) {
      toast.error(t("Failed to clear due date"));
    }
  }, [card, kanbanCards, t]);

  const handleSearchDocuments = React.useCallback(async (query: string) => {
    if (!query.trim()) {
      // Load recent documents when no query
      await documents.fetchPage({ limit: 50 });
      return documents.all.slice(0, 50).map((doc) => ({
        id: doc.id,
        title: doc.title,
        url: doc.path,
      }));
    }

    const results = await documents.searchTitles({ query });
    return results.map((result) => ({
      id: result.document.id,
      title: result.document.title,
      url: result.document.path,
    }));
  }, [documents]);

  const handleAddRelatedDocument = React.useCallback(async (documentId: string) => {
    if (!card) {
      return;
    }

    try {
      await kanbanCards.addRelatedDocument(card.id, documentId);
      toast.success(t("Related document added"));
    } catch (_error) {
      toast.error(t("Failed to add related document"));
    }
  }, [card, kanbanCards, t]);

  const handleRemoveRelatedDocument = React.useCallback(async (documentId: string) => {
    if (!card) {
      return;
    }

    try {
      await kanbanCards.removeRelatedDocument(card.id, documentId);
      toast.success(t("Related document removed"));
    } catch (_error) {
      toast.error(t("Failed to remove related document"));
    }
  }, [card, kanbanCards, t]);

  const openImageModal = React.useCallback((src: string, alt: string) => {
    setLightboxImage({ src, alt });
  }, []);

  // Close lightbox on Escape key
  React.useEffect(() => {
    if (!lightboxImage) { return; }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLightboxImage(null);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [lightboxImage]);

  const handleDescriptionImageSelect = React.useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) { return; }

    // Switch to edit mode if not already
    if (!isEditingDescription) {
      setIsEditingDescription(true);
    }

    setIsUploadingImage(true);
    try {
      for (const file of files) {
        const attachment = await uploadFile(file, {
          preset: AttachmentPreset.DocumentAttachment,
        });
        const imageMarkdown = `![${file.name}](${attachment.url})\n`;
        setDescription(prev => prev + imageMarkdown);
      }
      toast.success(t("Image uploaded"));
    } catch (_error) {
      toast.error(t("Failed to upload image"));
    } finally {
      setIsUploadingImage(false);
      if (e.target) {
        e.target.value = "";
      }
    }
  }, [isEditingDescription, t]);

  const handleDescriptionPaste = React.useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) { return; }

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          imageFiles.push(file);
        }
      }
    }

    if (imageFiles.length === 0) { return; }

    e.preventDefault();
    setIsUploadingImage(true);

    try {
      for (const file of imageFiles) {
        const attachment = await uploadFile(file, {
          preset: AttachmentPreset.DocumentAttachment,
        });
        const imageMarkdown = `![${file.name}](${attachment.url})\n`;
        setDescription(prev => prev + imageMarkdown);
      }
      toast.success(t("Image uploaded"));
    } catch (_error) {
      toast.error(t("Failed to upload image"));
    } finally {
      setIsUploadingImage(false);
    }
  }, [t]);

  /**
   * Renders a text segment with mention highlights (dark blue @names).
   */
  const renderTextWithMentions = React.useCallback((text: string, keyPrefix: string) => {
    const mentionRegex = /(@[^\u200B]+)\u200B/g;
    const parts: React.ReactNode[] = [];
    let lastIdx = 0;
    let m;

    while ((m = mentionRegex.exec(text)) !== null) {
      if (m.index > lastIdx) {
        parts.push(<Linkify key={`${keyPrefix}-t-${lastIdx}`}>{text.slice(lastIdx, m.index)}</Linkify>);
      }
      parts.push(<DescriptionMention key={`${keyPrefix}-m-${m.index}`}>{m[1]}</DescriptionMention>);
      lastIdx = m.index + m[0].length;
    }

    if (lastIdx < text.length) {
      parts.push(<Linkify key={`${keyPrefix}-t-${lastIdx}`}>{text.slice(lastIdx)}</Linkify>);
    }

    return parts.length > 0 ? parts : <Linkify>{text}</Linkify>;
  }, []);

  /**
   * Renders description text with inline markdown images and mention highlights.
   */
  const renderDescription = React.useCallback((text: string) => {
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = imageRegex.exec(text)) !== null) {
      // Text before the image (with mention highlights)
      if (match.index > lastIndex) {
        parts.push(
          <React.Fragment key={`text-${lastIndex}`}>
            {renderTextWithMentions(text.slice(lastIndex, match.index), `seg-${lastIndex}`)}
          </React.Fragment>
        );
      }
      // The image
      const imgSrc = match[2];
      const imgAlt = match[1];
      parts.push(
        <DescriptionImage
          key={`img-${match.index}`}
          src={imgSrc}
          alt={imgAlt}
          onClick={() => openImageModal(imgSrc, imgAlt)}
        />
      );
      lastIndex = match.index + match[0].length;
    }

    // Remaining text after last image (with mention highlights)
    if (lastIndex < text.length) {
      parts.push(
        <React.Fragment key={`text-${lastIndex}`}>
          {renderTextWithMentions(text.slice(lastIndex), `seg-${lastIndex}`)}
        </React.Fragment>
      );
    }

    return parts.length > 0 ? parts : renderTextWithMentions(text, "full");
  }, [renderTextWithMentions, openImageModal]);

  if (isLoading) {
    return (
      <Scene icon={<TableIcon />} title={t("Card Details")}>
        <Container>
          <Text type="secondary">{t("Loading...")}</Text>
        </Container>
      </Scene>
    );
  }

  if (!card) {
    return (
      <Scene icon={<TableIcon />} title={t("Card Details")}>
        <Container>
          <Text type="secondary">{t("Card not found")}</Text>
          <BackButton onClick={handleBack}>
            {t("Back to Kanban")}
          </BackButton>
        </Container>
      </Scene>
    );
  }

  const cardMembers = (card.members || []) as Member[];

  return (
    <Scene
      icon={<TableIcon />}
      title={card.title || t("Card Details")}
      centered={false}
      left={
        <Breadcrumb>
          <BreadcrumbLink onClick={handleBack}>
            {board?.name || t("Kanban")}
          </BreadcrumbLink>
          <BreadcrumbSeparator>›</BreadcrumbSeparator>
          <BreadcrumbCurrent>
            {list?.name || t("List")}
          </BreadcrumbCurrent>
        </Breadcrumb>
      }
    >
      <PageContainer>
        <ContentWrapper>
          {/* Main Content */}
          <MainContent>
            {/* Title */}
            <TitleInput
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleSave}
              placeholder={t("Card title")}
            />

            {/* Description Section */}
            <Section>
              <SectionHeader>
                <SectionTitle>{t("Description")}</SectionTitle>
                <DescriptionImageButton
                  onClick={() => descriptionFileInputRef.current?.click()}
                  title={t("Insert image")}
                >
                  <ImageIcon size={16} />
                  {t("Image")}
                </DescriptionImageButton>
                <HiddenFileInput
                  ref={descriptionFileInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={(e) => void handleDescriptionImageSelect(e)}
                />
              </SectionHeader>
              {isEditingDescription ? (
                <DescriptionEditWrapper
                  onBlur={(e) => {
                    // Don't close if clicking within the wrapper (e.g. suggestion popup)
                    if (!isUploadingImage && !e.currentTarget.contains(e.relatedTarget as Node)) {
                      setIsEditingDescription(false);
                      void handleSave();
                    }
                  }}
                >
                  <MentionInput
                    value={description}
                    onChange={setDescription}
                    placeholder={t("Add a more detailed description... Use @ to mention someone")}
                    rows={4}
                    onPaste={handleDescriptionPaste}
                  />
                  {isUploadingImage && (
                    <UploadingIndicator>{t("Uploading image...")}</UploadingIndicator>
                  )}
                  {/* Inline image previews while editing */}
                  {(() => {
                    const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
                    const images: { alt: string; src: string; raw: string }[] = [];
                    let imgMatch;
                    while ((imgMatch = imgRegex.exec(description)) !== null) {
                      images.push({ alt: imgMatch[1], src: imgMatch[2], raw: imgMatch[0] });
                    }
                    return images.length > 0 ? (
                      <EditImagePreviewList>
                        {images.map((img, i) => (
                          <EditImagePreviewItem key={i}>
                            <DescriptionImage
                              src={img.src}
                              alt={img.alt}
                              onClick={() => openImageModal(img.src, img.alt)}
                            />
                            <RemoveImageButton
                              onClick={(e) => {
                                e.stopPropagation();
                                // Remove the markdown for this image (and trailing newline if any)
                                setDescription(prev => prev.replace(img.raw + "\n", "").replace(img.raw, ""));
                              }}
                              title={t("Remove image")}
                            >
                              ×
                            </RemoveImageButton>
                          </EditImagePreviewItem>
                        ))}
                      </EditImagePreviewList>
                    ) : null;
                  })()}
                </DescriptionEditWrapper>
              ) : (
                <DescriptionView
                  onClick={() => {
                    setIsEditingDescription(true);
                    setTimeout(() => descriptionTextareaRef.current?.focus(), 0);
                  }}
                  $hasContent={!!description}
                >
                  {description ? (
                    renderDescription(description)
                  ) : (
                    t("Add a more detailed description...")
                  )}
                </DescriptionView>
              )}
            </Section>

            {/* Checklists Section */}
            <CardDetailChecklist
              checklists={checklists}
              onAddChecklist={handleAddChecklist}
              onDeleteChecklist={handleDeleteChecklist}
              onAddItem={handleAddChecklistItem}
              onToggleItem={handleToggleChecklistItem}
              onDeleteItem={handleDeleteChecklistItem}
            />

{/* Activity Section */}
            <CardDetailActivity
              activities={activities}
              newComment={newComment}
              isSubmittingComment={isSubmittingComment}
              onCommentChange={setNewComment}
              onAddComment={handleAddComment}
              onAddReply={handleAddReply}
              onImageClick={openImageModal}
            />
          </MainContent>

          {/* Sidebar */}
          <CardDetailSidebar
            cardId={card.id}
            implementStatus={card.implementStatus}
            implementError={card.implementError ?? null}
            listName={list?.name || ""}
            priority={card.priority}
            cardMembers={cardMembers}
            teamMembers={teamMembers}
            dueDate={dueDate}
            relatedDocuments={(card.relatedDocuments || []) as RelatedDocument[]}
            onPriorityChange={handlePriorityChange}
            onAddMember={handleAddMember}
            onRemoveMember={handleRemoveMember}
            onDueDateChange={handleDueDateChange}
            onClearDueDate={handleClearDueDate}
            onSearchDocuments={handleSearchDocuments}
            onAddRelatedDocument={handleAddRelatedDocument}
            onRemoveRelatedDocument={handleRemoveRelatedDocument}
          />
        </ContentWrapper>
      </PageContainer>

      {/* Image Lightbox Modal */}
      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </Scene>
  );
}

// Styled components
const PageContainer = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px 24px;
`;

const Breadcrumb = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
`;

const BreadcrumbLink = styled.button`
  background: transparent;
  border: none;
  color: ${s("textSecondary")};
  cursor: pointer;
  padding: 0;
  font-size: 14px;

  &:hover {
    color: ${s("text")};
    text-decoration: underline;
  }
`;

const BreadcrumbSeparator = styled.span`
  color: ${s("textTertiary")};
`;

const BreadcrumbCurrent = styled.span`
  color: ${s("text")};
  font-size: 14px;
  font-weight: 500;
`;

const ContentWrapper = styled.div`
  display: flex;
  gap: 40px;
  
  @media (max-width: 768px) {
    flex-direction: column;
  }
`;

const MainContent = styled.div`
  flex: 1;
  min-width: 0;
`;

const TitleInput = styled.input`
  width: 100%;
  font-size: 28px;
  font-weight: 600;
  border: none;
  background: transparent;
  color: ${s("text")};
  padding: 8px 0;
  margin-bottom: 24px;
  
  &:hover,
  &:focus {
    outline: none;
  }
  
  &::placeholder {
    color: ${s("placeholder")};
  }
`;

const Section = styled.div`
  margin-bottom: 32px;
`;

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
`;

const SectionTitle = styled.h3`
  font-size: 14px;
  font-weight: 600;
  color: ${s("text")};
  margin: 0;
`;

const DescriptionEditWrapper = styled.div`
  border: 1px solid ${s("inputBorder")};
  border-radius: 8px;
  padding: 0;

  &:focus-within {
    border-color: ${s("accent")};
  }

  /* Remove border from MentionInput's internal textarea since wrapper has border */
  textarea {
    border: none;
    border-radius: 8px;

    &:focus {
      border-color: transparent;
    }
  }
`;

const DescriptionMention = styled.span`
  color: #1a56db;
  font-weight: 600;
`;

const DescriptionView = styled.div<{ $hasContent: boolean }>`
  min-height: 100px;
  padding: 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: ${s("backgroundSecondary")};
  color: ${(props) => props.$hasContent ? s("text")(props) : s("placeholder")(props)};
  font-size: 14px;
  line-height: 1.5;
  cursor: pointer;
  white-space: pre-wrap;
  word-break: break-word;

  &:hover {
    background: ${s("backgroundTertiary")};
  }
`;

const DescriptionImage = styled.img`
  max-width: 100%;
  max-height: 400px;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 8px;
  cursor: pointer;
  display: block;
  margin: 8px 0;
  transition: opacity 0.2s ease;

  &:hover {
    opacity: 0.9;
  }
`;

const EditImagePreviewList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px 12px;
  border-top: 1px solid ${s("divider")};
`;

const EditImagePreviewItem = styled.div`
  position: relative;

  img {
    max-height: 200px;
    margin: 0;
  }
`;

const RemoveImageButton = styled.button`
  position: absolute;
  top: 4px;
  right: 4px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: ${s("danger")};
  color: white;
  font-size: 16px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0.85;
  transition: opacity 0.15s ease;

  &:hover {
    opacity: 1;
  }
`;

const DescriptionImageButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 1px solid ${s("divider")};
  color: ${s("textSecondary")};
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: ${s("backgroundSecondary")};
    color: ${s("text")};
    border-color: ${s("accent")};
  }
`;

const HiddenFileInput = styled.input`
  display: none;
`;

const UploadingIndicator = styled.div`
  font-size: 12px;
  color: ${s("textTertiary")};
  padding: 4px 0;
`;

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
`;

const BackButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: none;
  color: ${s("accent")};
  font-size: 14px;
  cursor: pointer;
  padding: 8px 0;
  margin-top: 16px;
  
  &:hover {
    text-decoration: underline;
  }
`;

/**
 * Lightweight image lightbox with zoom/pan for the card detail page.
 */
function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [scale, setScale] = React.useState(1);
  const [translate, setTranslate] = React.useState({ x: 0, y: 0 });
  const isPanning = React.useRef(false);
  const panStart = React.useRef({ x: 0, y: 0 });
  const translateStart = React.useRef({ x: 0, y: 0 });

  const MIN_SCALE = 1;
  const MAX_SCALE = 8;
  const ZOOM_STEP = 0.5;

  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

  const zoomIn = React.useCallback(() => {
    setScale((prev) => {
      const next = clampScale(prev + ZOOM_STEP);
      if (next === MIN_SCALE) { setTranslate({ x: 0, y: 0 }); }
      return next;
    });
  }, []);

  const zoomOut = React.useCallback(() => {
    setScale((prev) => {
      const next = clampScale(prev - ZOOM_STEP);
      if (next === MIN_SCALE) { setTranslate({ x: 0, y: 0 }); }
      return next;
    });
  }, []);

  const handleWheel = React.useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    setScale((prev) => {
      const next = clampScale(prev + delta);
      if (next === MIN_SCALE) { setTranslate({ x: 0, y: 0 }); }
      return next;
    });
  }, []);

  const handlePointerDown = React.useCallback((e: React.PointerEvent) => {
    if (scale <= MIN_SCALE) { return; }
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY };
    translateStart.current = { ...translate };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [scale, translate]);

  const handlePointerMove = React.useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) { return; }
    setTranslate({
      x: translateStart.current.x + (e.clientX - panStart.current.x),
      y: translateStart.current.y + (e.clientY - panStart.current.y),
    });
  }, []);

  const handlePointerUp = React.useCallback(() => {
    isPanning.current = false;
  }, []);

  const handleOverlayClick = React.useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  const handleDoubleClick = React.useCallback(() => {
    if (scale > MIN_SCALE) {
      setScale(MIN_SCALE);
      setTranslate({ x: 0, y: 0 });
    } else {
      setScale(3);
    }
  }, [scale]);

  return (
    <LightboxOverlay onClick={handleOverlayClick}>
      <LightboxActions>
        <LightboxActionButton
          onClick={(e) => { e.stopPropagation(); zoomIn(); }}
          title={t("Zoom in")}
          disabled={scale >= MAX_SCALE}
        >
          <ZoomInIcon size={20} />
        </LightboxActionButton>
        <LightboxActionButton
          onClick={(e) => { e.stopPropagation(); zoomOut(); }}
          title={t("Zoom out")}
          disabled={scale <= MIN_SCALE}
        >
          <ZoomOutIcon size={20} />
        </LightboxActionButton>
        <LightboxActionButton
          onClick={onClose}
          title={t("Close")}
        >
          <CloseIcon size={20} />
        </LightboxActionButton>
      </LightboxActions>
      <LightboxImageWrapper
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        $cursor={isPanning.current ? "grabbing" : scale > MIN_SCALE ? "grab" : "zoom-in"}
      >
        <LightboxImg
          src={src}
          alt={alt}
          draggable={false}
          style={{
            transform: `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`,
          }}
        />
      </LightboxImageWrapper>
      {alt && scale <= MIN_SCALE && (
        <LightboxCaption>{alt}</LightboxCaption>
      )}
    </LightboxOverlay>
  );
}

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const LightboxOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: ${depths.modal};
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  animation: ${fadeIn} 0.2s ease;
`;

const LightboxActions = styled.div`
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  gap: 8px;
  z-index: ${depths.modal + 1};
`;

const LightboxActionButton = styled.button`
  width: 40px;
  height: 40px;
  border-radius: 8px;
  border: none;
  background: rgba(255, 255, 255, 0.15);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  &:disabled {
    opacity: 0.3;
    cursor: default;
  }
`;

const LightboxImageWrapper = styled.div<{ $cursor?: string }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 90vw;
  height: 85vh;
  overflow: hidden;
  cursor: ${({ $cursor }) => $cursor || "default"};
  touch-action: none;
`;

const LightboxImg = styled.img`
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
  transition: transform 0.15s ease;
  user-select: none;
`;

const LightboxCaption = styled.div`
  color: rgba(255, 255, 255, 0.7);
  font-size: 14px;
  margin-top: 12px;
  text-align: center;
`;

export default observer(CardDetail);
