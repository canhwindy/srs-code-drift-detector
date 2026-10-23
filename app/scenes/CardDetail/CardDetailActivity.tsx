import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import { formatDistanceToNow, format } from "date-fns";
import { PlusIcon, DoneIcon, CloseIcon, UserIcon, EditIcon, ClockIcon, CollectionIcon, ImageIcon, AttachmentIcon } from "outline-icons";
import { ArrowRightIcon } from "~/components/Icons/ArrowIcon";
import Button from "~/components/Button";
import Linkify from "~/components/Linkify";
import MentionInput from "~/components/MentionInput";
import { bytesToHumanReadable } from "@shared/utils/files";
import type { ActivityEvent, CommentReply } from "./types";

/**
 * Renders text with mention highlights (dark blue @names).
 */
function renderTextWithMentions(text: string) {
  const mentionRegex = /(@[^\u200B]+)\u200B/g;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let m;

  while ((m = mentionRegex.exec(text)) !== null) {
    if (m.index > lastIdx) {
      parts.push(<Linkify key={`t-${lastIdx}`}>{text.slice(lastIdx, m.index)}</Linkify>);
    }
    parts.push(<CommentMention key={`m-${m.index}`}>{m[1]}</CommentMention>);
    lastIdx = m.index + m[0].length;
  }

  if (lastIdx < text.length) {
    parts.push(<Linkify key={`t-${lastIdx}`}>{text.slice(lastIdx)}</Linkify>);
  }

  return parts.length > 0 ? <>{parts}</> : <Linkify>{text}</Linkify>;
}

interface CardDetailActivityProps {
  activities: ActivityEvent[];
  newComment: string;
  isSubmittingComment: boolean;
  onCommentChange: (comment: string) => void;
  onAddComment: (attachments?: File[]) => Promise<void>;
  onAddReply: (parentId: string, replyText: string, attachments?: File[]) => Promise<void>;
  onImageClick: (src: string, alt: string) => void;
}

/**
 * Activity and comments section component for the card detail page.
 *
 * @param props - The component props.
 * @returns the activity section component.
 */
function CardDetailActivity({
  activities,
  newComment,
  isSubmittingComment,
  onCommentChange,
  onAddComment,
  onAddReply,
  onImageClick,
}: CardDetailActivityProps) {
  const { t } = useTranslation();
  const [replyingTo, setReplyingTo] = React.useState<string | null>(null);
  const [replyText, setReplyText] = React.useState("");
  const [isSubmittingReply, setIsSubmittingReply] = React.useState(false);
  const [commentAttachments, setCommentAttachments] = React.useState<File[]>([]);
  const [replyAttachments, setReplyAttachments] = React.useState<File[]>([]);
  const commentFileInputRef = React.useRef<HTMLInputElement>(null);
  const replyFileInputRef = React.useRef<HTMLInputElement>(null);

  const handleReply = React.useCallback(async (parentId: string) => {
    if (!replyText.trim() && replyAttachments.length === 0) {
      return;
    }

    setIsSubmittingReply(true);
    try {
      await onAddReply(parentId, replyText, replyAttachments);
      setReplyText("");
      setReplyingTo(null);
      setReplyAttachments([]);
    } catch {
      // Error is handled by parent
    } finally {
      setIsSubmittingReply(false);
    }
  }, [replyText, replyAttachments, onAddReply]);

  const handleStartReply = (commentId: string, mentionName?: string) => {
    setReplyingTo(commentId);
    // Auto-add @mention of the person being replied to
    // Use ZWSP (\u200B) to mark end of mention, preventing following text from being formatted
    if (mentionName) {
      setReplyText(`@${mentionName}\u200B `);
    } else {
      setReplyText("");
    }
  };

  const handleCancelReply = () => {
    setReplyingTo(null);
    setReplyText("");
    setReplyAttachments([]);
  };

  const handleCommentFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setCommentAttachments(prev => [...prev, ...files]);
    if (e.target) {
      e.target.value = "";
    }
  };

  const handleReplyFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setReplyAttachments(prev => [...prev, ...files]);
    if (e.target) {
      e.target.value = "";
    }
  };

  const removeCommentAttachment = (index: number) => {
    setCommentAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const removeReplyAttachment = (index: number) => {
    setReplyAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddCommentWithAttachments = React.useCallback(async () => {
    await onAddComment(commentAttachments);
    setCommentAttachments([]);
  }, [commentAttachments, onAddComment]);

  const handleCommentPaste = React.useCallback((e: React.ClipboardEvent) => {
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

    if (imageFiles.length > 0) {
      e.preventDefault();
      setCommentAttachments(prev => [...prev, ...imageFiles]);
    }
  }, []);

  const handleReplyPaste = React.useCallback((e: React.ClipboardEvent) => {
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

    if (imageFiles.length > 0) {
      e.preventDefault();
      setReplyAttachments(prev => [...prev, ...imageFiles]);
    }
  }, []);

  /**
   * Renders reply items for a comment recursively.
   */
  const renderReplies = (replies: CommentReply[], depth: number = 0): React.ReactNode => {
    if (!replies || replies.length === 0) {
      return null;
    }

    return (
      <RepliesContainer $depth={depth}>
        {replies.map((reply) => {
          const replyActorName = reply.createdBy?.name || t("Someone");
          const replyTimeAgo = formatDistanceToNow(new Date(reply.createdAt), { addSuffix: true });
          const isReplyingToThis = replyingTo === reply.id;

          return (
            <ReplyItem key={reply.id}>
              <ReplyHeader>
                <ReplyActor>
                  {reply.createdBy?.avatarUrl ? (
                    <ReplyAvatar src={reply.createdBy.avatarUrl} alt={replyActorName} />
                  ) : (
                    <ReplyInitial>{replyActorName.charAt(0).toUpperCase()}</ReplyInitial>
                  )}
                  <strong>{replyActorName}</strong>
                </ReplyActor>
                <ReplyTime>{replyTimeAgo}</ReplyTime>
              </ReplyHeader>
              <ReplyContent>
                {renderTextWithMentions(reply.content)}
                {reply.attachments && reply.attachments.length > 0 && (
                  <AttachmentsContainer>
                    {reply.attachments.map((attachment) => (
                      <AttachmentItem key={attachment.id}>
                        {attachment.contentType?.startsWith("image/") ? (
                          <AttachmentImage
                            src={attachment.url}
                            alt={attachment.name}
                            onClick={() => onImageClick(attachment.url, attachment.name)}
                          />
                        ) : (
                          <AttachmentFile href={attachment.url} target="_blank" rel="noopener noreferrer">
                            <AttachmentIcon size={16} />
                            <AttachmentName>{attachment.name}</AttachmentName>
                            <AttachmentSize>{bytesToHumanReadable(attachment.size)}</AttachmentSize>
                          </AttachmentFile>
                        )}
                      </AttachmentItem>
                    ))}
                  </AttachmentsContainer>
                )}
              </ReplyContent>

              {/* Reply button for this reply */}
              <CommentFooter>
                <ReplyButton onClick={() => handleStartReply(reply.id, replyActorName)}>
                  {t("Reply")}
                </ReplyButton>
              </CommentFooter>

              {/* Reply input for this reply - reply goes to this comment's ID as parent */}
              {isReplyingToThis && (
                <ReplyInputWrapper>
                  <MentionInput
                    value={replyText}
                    onChange={setReplyText}
                    placeholder={t("Write a reply to {{name}}...", { name: replyActorName })}
                    rows={2}
                    onPaste={handleReplyPaste}
                  />

                  {/* Attachment previews for reply */}
                  {replyAttachments.length > 0 && (
                    <AttachmentPreviewList>
                      {replyAttachments.map((file, index) => (
                        <AttachmentPreview key={index}>
                          {file.type.startsWith("image/") ? (
                            <PreviewImage src={URL.createObjectURL(file)} alt={file.name} />
                          ) : (
                            <PreviewFile>
                              <AttachmentIcon size={16} />
                              <PreviewFileName>{file.name}</PreviewFileName>
                            </PreviewFile>
                          )}
                          <RemovePreviewButton onClick={() => removeReplyAttachment(index)}>×</RemovePreviewButton>
                        </AttachmentPreview>
                      ))}
                    </AttachmentPreviewList>
                  )}

                  <ReplyActions>
                    <HiddenFileInput
                      ref={replyFileInputRef}
                      type="file"
                      multiple
                      accept="image/*,.pdf,.doc,.docx,.txt"
                      onChange={handleReplyFileSelect}
                    />
                    <AttachButton onClick={() => replyFileInputRef.current?.click()}>
                      <ImageIcon size={16} />
                      {t("Attach")}
                    </AttachButton>
                    <Button
                      onClick={handleCancelReply}
                      neutral
                    >
                      {t("Cancel")}
                    </Button>
                    <Button
                      onClick={() => handleReply(reply.id)}
                      disabled={isSubmittingReply || (!replyText.trim() && replyAttachments.length === 0)}
                    >
                      {isSubmittingReply ? t("Sending...") : t("Reply")}
                    </Button>
                  </ReplyActions>
                </ReplyInputWrapper>
              )}

              {/* Nested replies */}
              {renderReplies(reply.replies || [], depth + 1)}
            </ReplyItem>
          );
        })}
      </RepliesContainer>
    );
  };

  /**
   * Renders an activity event item.
   *
   * @param activity - The activity event to render.
   * @returns the activity item component.
   */
  const renderActivity = (activity: ActivityEvent) => {
    const actorName = activity.actor?.name || t("Someone");
    const timeAgo = formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true });

    let icon: React.ReactNode = <PlusIcon size={16} />;
    let content = "";

    switch (activity.name) {
      case "kanban_cards.create":
        icon = <PlusIcon size={16} />;
        content = t("{{actor}} created the card", { actor: actorName });
        break;
      case "kanban_cards.move":
        icon = <ArrowRightIcon size={16} />;
        content = t("{{actor}} moved the card from {{from}} to {{to}}", {
          actor: actorName,
          from: activity.data.previousListName || t("Unknown"),
          to: activity.data.newListName || t("Unknown"),
        });
        break;
      case "kanban_cards.update":
        icon = <EditIcon size={16} />;
        content = t("{{actor}} updated the card", { actor: actorName });
        break;
      case "kanban_cards.title_update":
        icon = <EditIcon size={16} />;
        content = t("{{actor}} changed the title from \"{{from}}\" to \"{{to}}\"", {
          actor: actorName,
          from: activity.data.previousTitle || "",
          to: activity.data.newTitle || "",
        });
        break;
      case "kanban_cards.description_update":
        icon = <EditIcon size={16} />;
        if (!activity.data.previousDescription && activity.data.newDescription) {
          content = t("{{actor}} added a description", { actor: actorName });
        } else if (activity.data.previousDescription && !activity.data.newDescription) {
          content = t("{{actor}} removed the description", { actor: actorName });
        } else {
          content = t("{{actor}} updated the description", { actor: actorName });
        }
        break;
      case "kanban_cards.duedate_update":
        icon = <ClockIcon size={16} />;
        if (!activity.data.previousDueDate && activity.data.newDueDate) {
          const newDate = format(new Date(activity.data.newDueDate), "MMM d, yyyy");
          content = t("{{actor}} set due date to {{date}}", {
            actor: actorName,
            date: newDate
          });
        } else if (activity.data.previousDueDate && !activity.data.newDueDate) {
          content = t("{{actor}} removed the due date", { actor: actorName });
        } else if (activity.data.previousDueDate && activity.data.newDueDate) {
          const prevDate = format(new Date(activity.data.previousDueDate), "MMM d, yyyy");
          const newDate = format(new Date(activity.data.newDueDate), "MMM d, yyyy");
          content = t("{{actor}} changed due date from {{from}} to {{to}}", {
            actor: actorName,
            from: prevDate,
            to: newDate,
          });
        }
        break;
      case "kanban_cards.add_member":
        icon = <UserIcon size={16} />;
        content = t("{{actor}} added {{member}} to the card", {
          actor: actorName,
          member: activity.data.memberName || activity.data.memberEmail || t("a member"),
        });
        break;
      case "kanban_cards.remove_member":
        icon = <UserIcon size={16} />;
        content = t("{{actor}} removed {{member}} from the card", {
          actor: actorName,
          member: activity.data.memberName || activity.data.memberEmail || t("a member"),
        });
        break;
      case "kanban_cards.checklist_create":
        icon = <CollectionIcon size={16} />;
        content = t("{{actor}} added checklist {{title}}", {
          actor: actorName,
          title: activity.data.checklistTitle || ""
        });
        break;
      case "kanban_cards.checklist_item_create":
        icon = <PlusIcon size={16} />;
        content = t("{{actor}} added task {{title}}", {
          actor: actorName,
          title: activity.data.itemTitle || ""
        });
        break;
      case "kanban_cards.checklist_item_complete":
        icon = <DoneIcon size={16} />;
        content = t("{{actor}} completed task {{title}}", {
          actor: actorName,
          title: activity.data.itemTitle || ""
        });
        break;
      case "kanban_cards.checklist_item_uncomplete":
        icon = <CloseIcon size={16} />;
        content = t("{{actor}} uncompleted task {{title}}", {
          actor: actorName,
          title: activity.data.itemTitle || ""
        });
        break;
      case "kanban_cards.comment": {
        icon = <PlusIcon size={16} />;
        const commentId = activity.data.commentId || activity.id;
        const isReplying = replyingTo === commentId;

        return (
          <ActivityItem key={activity.id}>
            <ActivityIcon>{icon}</ActivityIcon>
            <ActivityContent>
              <ActivityHeader>
                <ActivityActor>
                  {activity.actor?.avatarUrl ? (
                    <ActorAvatar src={activity.actor.avatarUrl} alt={actorName} />
                  ) : (
                    <ActorInitial>{actorName.charAt(0).toUpperCase()}</ActorInitial>
                  )}
                  <strong>{actorName}</strong>
                </ActivityActor>
                <ActivityTime>{timeAgo}</ActivityTime>
              </ActivityHeader>
              <CommentBubble>
                {renderTextWithMentions(activity.data.comment || "")}
                {activity.data.attachments && activity.data.attachments.length > 0 && (
                  <AttachmentsContainer>
                    {activity.data.attachments.map((attachment: any) => (
                      <AttachmentItem key={attachment.id}>
                        {attachment.contentType?.startsWith("image/") ? (
                          <AttachmentImage
                            src={attachment.url}
                            alt={attachment.name}
                            onClick={() => onImageClick(attachment.url, attachment.name)}
                          />
                        ) : (
                          <AttachmentFile href={attachment.url} target="_blank" rel="noopener noreferrer">
                            <AttachmentIcon size={16} />
                            <AttachmentName>{attachment.name}</AttachmentName>
                            <AttachmentSize>{bytesToHumanReadable(attachment.size)}</AttachmentSize>
                          </AttachmentFile>
                        )}
                      </AttachmentItem>
                    ))}
                  </AttachmentsContainer>
                )}
              </CommentBubble>

              {/* Reply button */}
              <CommentFooter>
                <ReplyButton onClick={() => handleStartReply(commentId, actorName)}>
                  {t("Reply")}
                </ReplyButton>
              </CommentFooter>

              {/* Replies */}
              {renderReplies(activity.data.replies || [], 0)}

              {/* Reply input */}
              {isReplying && (
                <ReplyInputWrapper>
                  <MentionInput
                    value={replyText}
                    onChange={setReplyText}
                    placeholder={t("Write a reply to {{name}}...", { name: actorName })}
                    rows={2}
                    onPaste={handleReplyPaste}
                  />

                  {/* Attachment previews for main reply */}
                  {replyAttachments.length > 0 && (
                    <AttachmentPreviewList>
                      {replyAttachments.map((file, index) => (
                        <AttachmentPreview key={index}>
                          {file.type.startsWith("image/") ? (
                            <PreviewImage src={URL.createObjectURL(file)} alt={file.name} />
                          ) : (
                            <PreviewFile>
                              <AttachmentIcon size={16} />
                              <PreviewFileName>{file.name}</PreviewFileName>
                            </PreviewFile>
                          )}
                          <RemovePreviewButton onClick={() => removeReplyAttachment(index)}>×</RemovePreviewButton>
                        </AttachmentPreview>
                      ))}
                    </AttachmentPreviewList>
                  )}

                  <ReplyActions>
                    <HiddenFileInput
                      ref={replyFileInputRef}
                      type="file"
                      multiple
                      accept="image/*,.pdf,.doc,.docx,.txt"
                      onChange={handleReplyFileSelect}
                    />
                    <AttachButton onClick={() => replyFileInputRef.current?.click()}>
                      <ImageIcon size={16} />
                      {t("Attach")}
                    </AttachButton>
                    <Button
                      onClick={handleCancelReply}
                      neutral
                    >
                      {t("Cancel")}
                    </Button>
                    <Button
                      onClick={() => handleReply(commentId)}
                      disabled={isSubmittingReply || (!replyText.trim() && replyAttachments.length === 0)}
                    >
                      {isSubmittingReply ? t("Sending...") : t("Reply")}
                    </Button>
                  </ReplyActions>
                </ReplyInputWrapper>
              )}
            </ActivityContent>
          </ActivityItem>
        );
      }
      default:
        content = t("{{actor}} performed an action", { actor: actorName });
    }

    return (
      <ActivityItem key={activity.id}>
        <ActivityIcon>{icon}</ActivityIcon>
        <ActivityContent>
          <ActivityText>
            {content}
            <ActivityTime> · {timeAgo}</ActivityTime>
          </ActivityText>
        </ActivityContent>
      </ActivityItem>
    );
  };

  return (
    <Section>
      <SectionHeader>
        <SectionTitle>{t("Activity")}</SectionTitle>
      </SectionHeader>

      {/* Comment Input */}
      <CommentInputWrapper>
        <MentionInput
          value={newComment}
          onChange={onCommentChange}
          placeholder={t("Write a comment... Use @ to mention someone")}
          rows={2}
          onPaste={handleCommentPaste}
        />

        {/* Attachment previews */}
        {commentAttachments.length > 0 && (
          <AttachmentPreviewList>
            {commentAttachments.map((file, index) => (
              <AttachmentPreview key={index}>
                {file.type.startsWith("image/") ? (
                  <PreviewImage src={URL.createObjectURL(file)} alt={file.name} />
                ) : (
                  <PreviewFile>
                    <AttachmentIcon size={16} />
                    <PreviewFileName>{file.name}</PreviewFileName>
                  </PreviewFile>
                )}
                <RemovePreviewButton onClick={() => removeCommentAttachment(index)}>×</RemovePreviewButton>
              </AttachmentPreview>
            ))}
          </AttachmentPreviewList>
        )}

        <CommentActions>
          <HiddenFileInput
            ref={commentFileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.txt"
            onChange={handleCommentFileSelect}
          />
          <AttachButton onClick={() => commentFileInputRef.current?.click()}>
            <ImageIcon size={16} />
            {t("Attach")}
          </AttachButton>

          {(newComment.trim() || commentAttachments.length > 0) && (
            <Button
              onClick={() => void handleAddCommentWithAttachments()}
              disabled={isSubmittingComment}
            >
              {isSubmittingComment ? t("Sending...") : t("Send")}
            </Button>
          )}
        </CommentActions>
      </CommentInputWrapper>

      {/* Activity List */}
      <ActivityList>
        {activities.length > 0 ? (
          activities.map(renderActivity)
        ) : (
          <NoActivityText>
            {t("No activity yet")}
          </NoActivityText>
        )}
      </ActivityList>
    </Section>
  );
}

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

const CommentInputWrapper = styled.div`
  margin-bottom: 24px;
`;

const CommentActions = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
`;

const ActivityList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const ActivityItem = styled.div`
  display: flex;
  gap: 12px;
`;

const ActivityIcon = styled.div`
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: ${s("text")};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  
  svg {
    color: ${s("background")};
  }
`;

const ActivityContent = styled.div`
  flex: 1;
`;

const ActivityHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
`;

const ActivityActor = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  
  strong {
    font-size: 14px;
  }
`;

const ActorAvatar = styled.img`
  width: 24px;
  height: 24px;
  border-radius: 50%;
`;

const ActorInitial = styled.div`
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: ${s("accent")};
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
`;

const ActivityText = styled.p`
  margin: 0;
  font-size: 14px;
  color: ${s("text")};
`;

const ActivityTime = styled.span`
  font-size: 12px;
  color: ${s("textTertiary")};
`;

const CommentBubble = styled.div`
  background: ${s("backgroundSecondary")};
  padding: 12px;
  border-radius: 8px;
  font-size: 14px;
  color: ${s("text")};
`;

const CommentFooter = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
`;

const ReplyButton = styled.button`
  background: none;
  border: none;
  color: ${s("textTertiary")};
  font-size: 12px;
  cursor: pointer;
  padding: 4px 0;
  
  &:hover {
    color: ${s("text")};
    text-decoration: underline;
  }
`;

const RepliesContainer = styled.div<{ $depth?: number }>`
  margin-top: 12px;
  margin-left: ${({ $depth = 0 }) => $depth > 0 ? 8 : 16}px;
  padding-left: 12px;
  border-left: 2px solid ${s("divider")};
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const ReplyItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const ReplyHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ReplyActor = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  
  strong {
    font-size: 13px;
  }
`;

const ReplyAvatar = styled.img`
  width: 20px;
  height: 20px;
  border-radius: 50%;
`;

const ReplyInitial = styled.div`
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: ${s("accent")};
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
`;

const ReplyTime = styled.span`
  font-size: 11px;
  color: ${s("textTertiary")};
`;

const ReplyContent = styled.div`
  background: ${s("backgroundSecondary")};
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: ${s("text")};
`;

const ReplyInputWrapper = styled.div`
  margin-top: 12px;
  margin-left: 16px;
  padding-left: 12px;
  border-left: 2px solid ${s("accent")};
`;

const ReplyActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
`;

const NoActivityText = styled.p`
  color: ${s("textTertiary")};
  font-size: 14px;
  text-align: center;
  padding: 24px;
`;

const AttachmentsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
`;

const AttachmentItem = styled.div`
  display: flex;
  flex-direction: column;
`;

const AttachmentImage = styled.img`
  max-width: 400px;
  max-height: 300px;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 8px;
  cursor: pointer;
  transition: opacity 0.2s ease;

  &:hover {
    opacity: 0.9;
  }
`;

const AttachmentFile = styled.a`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: ${s("backgroundTertiary")};
  border-radius: 6px;
  color: ${s("text")};
  text-decoration: none;
  transition: background 0.15s ease;

  &:hover {
    background: ${s("divider")};
  }
`;

const AttachmentName = styled.span`
  font-size: 13px;
  flex: 1;
`;

const AttachmentSize = styled.span`
  font-size: 11px;
  color: ${s("textTertiary")};
`;

const AttachmentPreviewList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
`;

const AttachmentPreview = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: ${s("backgroundSecondary")};
  border-radius: 6px;
  border: 1px solid ${s("divider")};
`;

const PreviewImage = styled.img`
  max-width: 100px;
  max-height: 100px;
  object-fit: contain;
  border-radius: 4px;
`;

const PreviewFile = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
`;

const PreviewFileName = styled.span`
  font-size: 12px;
  color: ${s("text")};
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const RemovePreviewButton = styled.button`
  position: absolute;
  top: 4px;
  right: 4px;
  background: ${s("danger")};
  color: white;
  border: none;
  border-radius: 50%;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  opacity: 0.9;
  transition: opacity 0.15s ease;

  &:hover {
    opacity: 1;
  }
`;

const HiddenFileInput = styled.input`
  display: none;
`;

const AttachButton = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid ${s("divider")};
  color: ${s("textSecondary")};
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: ${s("backgroundSecondary")};
    color: ${s("text")};
    border-color: ${s("accent")};
  }
`;

const CommentMention = styled.span`
  color: #1a56db;
  font-weight: 600;
`;

export default CardDetailActivity;
