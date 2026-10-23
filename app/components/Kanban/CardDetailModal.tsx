import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled, { css } from "styled-components";
import { s } from "@shared/styles";
import { formatDistanceToNow, format, isBefore, startOfDay } from "date-fns";
import { CloseIcon, PlusIcon, UserIcon } from "outline-icons";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Text from "~/components/Text";
import useStores from "~/hooks/useStores";
import { toast } from "sonner";
import ImplementCardButton from "~/components/Kanban/ImplementCardButton";

interface Props {
  cardId: string;
  onClose: () => void;
}

const PRIORITIES = [
  { value: "Blocked", label: "Blocked", color: "#B91C1C" },
  { value: "Critical", label: "Critical", color: "#DC2626" },
  { value: "High", label: "High", color: "#F97316" },
  { value: "Medium", label: "Medium", color: "#FACC15" },
];

interface Member {
  id: string;
  name: string;
  avatarUrl: string;
  email: string;
}

/**
 * Modal for viewing and editing Kanban card details.
 */
const CardDetailModal: React.FC<Props> = observer(({ cardId, onClose }) => {
  const { t } = useTranslation();
  const { kanbanCards, users } = useStores();

  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [dueDate, setDueDate] = React.useState<string>("");
  const [isSaving, setIsSaving] = React.useState(false);
  const [isDescriptionDirty, setIsDescriptionDirty] = React.useState(false);
  const [showPrioritySelector, setShowPrioritySelector] = React.useState(false);
  const [showMemberSelector, setShowMemberSelector] = React.useState(false);

  const card = kanbanCards.get(cardId);

  // Get all team members
  const teamMembers = React.useMemo(() => Array.from(users.all || []), [users.all]);

  // Initialize form values
  React.useEffect(() => {
    if (card) {
      setTitle(card.title || "");
      setDescription(card.description || "");
      setDueDate(card.dueDate ? format(new Date(card.dueDate), "yyyy-MM-dd") : "");
    }
  }, [card]);

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
        dueDate: dueDate ? new Date(dueDate) : undefined,
      });
      toast.success(t("Card updated"));
      setIsDescriptionDirty(false);
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
      setShowPrioritySelector(false);
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
      setShowMemberSelector(false);
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

  if (!card) {
    return (
      <Container>
        <Text type="secondary">{t("Card not found")}</Text>
      </Container>
    );
  }

  const isOverdue = card.dueDate && isBefore(new Date(card.dueDate), startOfDay(new Date()));
  const cardMembers = card.members || [];
  const currentPriority = PRIORITIES.find(p => p.value === card.priority);

  const unassignedMembers = teamMembers.filter(
    (user: { id: string }) => !cardMembers.some((cm: Member) => cm.id === user.id)
  );

  return (
    <Container>
      <Header>
        <TitleInput
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleSave}
          placeholder={t("Card title")}
        />
        <CloseButton onClick={onClose}>
          <CloseIcon size={24} />
        </CloseButton>
      </Header>

      <Content>
        {/* Description Section */}
        <Section>
          <SectionTitle>{t("Description")}</SectionTitle>
          <DescriptionTextarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setIsDescriptionDirty(true);
            }}
            placeholder={t("Add a more detailed description...")}
            rows={4}
          />
          {isDescriptionDirty && (
            <DescriptionActions>
              <Button
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? t("Saving...") : t("Save")}
              </Button>
            </DescriptionActions>
          )}
        </Section>

        {/* Due Date Section */}
        <Section>
          <SectionTitle>{t("Due Date")}</SectionTitle>
          <Flex align="center" gap={8}>
            <DateInput
              type="date"
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value);
              }}
              onBlur={handleSave}
              $isOverdue={!!isOverdue}
            />
            {dueDate && (
              <ClearButton onClick={() => {
                setDueDate("");
                handleSave();
              }}>
                <CloseIcon size={16} />
              </ClearButton>
            )}
            {isOverdue && (
              <OverdueLabel>{t("Overdue")}</OverdueLabel>
            )}
          </Flex>
        </Section>

        {/* Priority Section */}
        <Section>
          <SectionTitle>{t("Priority")}</SectionTitle>
          <LabelsContainer>
            {currentPriority ? (
              <LabelBadge $color={currentPriority.color}>
                {currentPriority.label}
                <RemoveButton onClick={() => handlePriorityChange(null)}>
                  <CloseIcon size={12} />
                </RemoveButton>
              </LabelBadge>
            ) : null}
            {showPrioritySelector ? (
              <LabelSelector>
                {PRIORITIES.map(p => (
                  <LabelOption
                    key={p.value}
                    onClick={() => handlePriorityChange(p.value)}
                  >
                    <LabelColor $color={p.color} />
                    {p.label}
                  </LabelOption>
                ))}
                <CancelLink onClick={() => setShowPrioritySelector(false)}>
                  {t("Cancel")}
                </CancelLink>
              </LabelSelector>
            ) : (
              <AddButton onClick={() => setShowPrioritySelector(true)}>
                <PlusIcon size={14} />
                <span>{currentPriority ? t("Change priority") : t("Set priority")}</span>
              </AddButton>
            )}
          </LabelsContainer>
        </Section>

        {/* Members Section */}
        <Section>
          <SectionTitle>{t("Members")}</SectionTitle>
          <MembersContainer>
            {cardMembers.map((member: Member) => (
              <MemberBadge key={member.id}>
                <MemberAvatar>
                  {member.avatarUrl ? (
                    <img src={member.avatarUrl} alt={member.name} />
                  ) : (
                    <UserIcon size={16} />
                  )}
                </MemberAvatar>
                <span>{member.name || member.email}</span>
                <RemoveButton onClick={() => handleRemoveMember(member.id)}>
                  <CloseIcon size={12} />
                </RemoveButton>
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
              <AddButton onClick={() => setShowMemberSelector(true)}>
                <PlusIcon size={14} />
                <span>{t("Add member")}</span>
              </AddButton>
            )}
          </MembersContainer>
        </Section>

        {/* Implement Section */}
        <Section>
          <SectionTitle>{t("Implement")}</SectionTitle>
          <ImplementCardButton
            cardId={card.id}
            implementStatus={card.implementStatus}
            implementError={card.implementError ?? null}
          />
        </Section>

        {/* Activity Section */}
        <Section>
          <SectionTitle>{t("Activity")}</SectionTitle>

          <ActivityEntry>
            <ActivityIcon>+</ActivityIcon>
            <ActivityText>
              {t("Created")}{" "}
              <ActivityTime>
                {formatDistanceToNow(new Date(card.createdAt), { addSuffix: true })}
              </ActivityTime>
            </ActivityText>
          </ActivityEntry>

          {[...(card.implementHistory ?? [])]
            .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
            .map((entry, i) => (
              <ActivityEntry key={i}>
                <ActivityIcon $status={entry.status}>
                  {entry.status === "completed" ? "✓" : "✗"}
                </ActivityIcon>
                <ActivityText>
                  <strong>{entry.userName ?? t("Someone")}</strong>
                  {" "}
                  {entry.status === "completed"
                    ? t("implemented this card")
                    : t("attempted to implement (failed)")}
                  {entry.error && (
                    <ActivityError title={entry.error}> — failed</ActivityError>
                  )}
                  <ActivityTime>
                    {" "}·{" "}
                    {formatDistanceToNow(new Date(entry.at), { addSuffix: true })}
                  </ActivityTime>
                </ActivityText>
              </ActivityEntry>
            ))}
        </Section>
      </Content>

      <Footer>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? t("Saving...") : t("Save changes")}
        </Button>
      </Footer>
    </Container>
  );
});

const Container = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 500px;
  max-width: 700px;
  max-height: 80vh;
`;

const Header = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding-bottom: 16px;
  border-bottom: 1px solid ${s("divider")};
  margin-bottom: 16px;
`;

const TitleInput = styled.input`
  flex: 1;
  font-size: 20px;
  font-weight: 600;
  border: none;
  background: transparent;
  color: ${s("text")};
  padding: 4px 8px;
  margin-right: 8px;
  border-radius: 4px;
  
  &:hover,
  &:focus {
    background: ${s("backgroundSecondary")};
    outline: none;
  }
`;

const CloseButton = styled.button`
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: ${s("textTertiary")};
  
  &:hover {
    color: ${s("text")};
  }
`;

const Content = styled.div`
  flex: 1;
  overflow-y: auto;
  padding-right: 8px;
`;

const Section = styled.div`
  margin-bottom: 24px;
`;

const SectionTitle = styled.h4`
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  color: ${s("textTertiary")};
  margin: 0 0 8px 0;
`;

const DescriptionTextarea = styled.textarea`
  width: 100%;
  min-height: 80px;
  padding: 12px;
  border: 1px solid ${s("inputBorder")};
  border-radius: 4px;
  background: ${s("background")};
  color: ${s("text")};
  font-size: 14px;
  resize: vertical;
  
  &:focus {
    outline: none;
    border-color: ${s("accent")};
  }
  
  &::placeholder {
    color: ${s("placeholder")};
  }
`;

const DescriptionActions = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
`;

const DateInput = styled.input<{ $isOverdue?: boolean }>`
  padding: 8px 12px;
  border: 1px solid ${s("inputBorder")};
  border-radius: 4px;
  background: ${s("background")};
  color: ${s("text")};
  font-size: 14px;
  
  ${props => props.$isOverdue && css`
    border-color: ${s("danger")};
    color: ${s("danger")};
  `}
  
  &:focus {
    outline: none;
    border-color: ${s("accent")};
  }
`;

const ClearButton = styled.button`
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: ${s("textTertiary")};
  
  &:hover {
    color: ${s("danger")};
  }
`;

const OverdueLabel = styled.span`
  font-size: 12px;
  color: ${s("danger")};
  font-weight: 500;
`;

const LabelsContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
`;

const LabelBadge = styled.div<{ $color: string }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 4px;
  background: ${props => props.$color || "#3B82F6"};
  color: white;
  font-size: 12px;
  font-weight: 500;
`;

const RemoveButton = styled.button`
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
  color: rgba(255, 255, 255, 0.7);
  display: flex;
  align-items: center;
  
  &:hover {
    color: white;
  }
`;

const AddButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px dashed ${s("inputBorder")};
  border-radius: 4px;
  background: transparent;
  color: ${s("textTertiary")};
  font-size: 12px;
  cursor: pointer;
  
  &:hover {
    border-color: ${s("accent")};
    color: ${s("accent")};
  }
`;

const LabelSelector = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid ${s("inputBorder")};
  border-radius: 4px;
  background: ${s("menuBackground")};
  min-width: 200px;
`;

const LabelOption = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: ${s("text")};
  font-size: 13px;
  
  &:hover {
    background: ${s("backgroundSecondary")};
  }
`;

const LabelColor = styled.div<{ $color: string }>`
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: ${props => props.$color || "#3B82F6"};
`;

const MembersContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
`;

const MemberBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border-radius: 20px;
  background: ${s("backgroundSecondary")};
  color: ${s("text")};
  font-size: 12px;
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
  min-width: 200px;
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

const Footer = styled.div`
  display: flex;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid ${s("divider")};
  margin-top: 16px;
`;

const ActivityEntry = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 12px;
`;

const ActivityIcon = styled.span<{ $status?: string }>`
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: ${props =>
    props.$status === "completed"
      ? "#22c55e22"
      : props.$status === "failed"
      ? "#ef444422"
      : "#6b728022"};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  flex-shrink: 0;
  margin-top: 2px;
  color: ${props =>
    props.$status === "completed"
      ? "#22c55e"
      : props.$status === "failed"
      ? "#ef4444"
      : "#6b7280"};
`;

const ActivityText = styled.div`
  font-size: 13px;
  color: ${s("text")};
  line-height: 1.4;
`;

const ActivityTime = styled.span`
  color: ${s("textTertiary")};
  font-size: 12px;
`;

const ActivityError = styled.span`
  color: ${s("danger")};
`;

export default CardDetailModal;
