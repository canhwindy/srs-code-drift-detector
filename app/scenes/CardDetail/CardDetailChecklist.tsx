import * as React from "react";
import { useTranslation } from "react-i18next";
import styled, { css } from "styled-components";
import { s } from "@shared/styles";
import { PlusIcon, TrashIcon } from "outline-icons";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import type { Checklist } from "./types";

interface CardDetailChecklistProps {
  checklists: Checklist[];
  onAddChecklist: (title: string) => Promise<void>;
  onDeleteChecklist: (checklistId: string) => Promise<void>;
  onAddItem: (checklistId: string, title: string) => Promise<void>;
  onToggleItem: (checklistId: string, itemId: string, isCompleted: boolean) => Promise<void>;
  onDeleteItem: (checklistId: string, itemId: string, isCompleted: boolean) => Promise<void>;
}

/**
 * Checklist section component for the card detail page.
 *
 * @param props - The component props.
 * @returns the checklist section component.
 */
function CardDetailChecklist({
  checklists,
  onAddChecklist,
  onDeleteChecklist,
  onAddItem,
  onToggleItem,
  onDeleteItem,
}: CardDetailChecklistProps) {
  const { t } = useTranslation();
  const [showAddChecklist, setShowAddChecklist] = React.useState(false);
  const [newChecklistTitle, setNewChecklistTitle] = React.useState("");
  const [newItemTitle, setNewItemTitle] = React.useState<{ [checklistId: string]: string }>({});
  const [showAddItem, setShowAddItem] = React.useState<{ [checklistId: string]: boolean }>({});

  const handleAddChecklist = React.useCallback(async () => {
    if (!newChecklistTitle.trim()) {
      return;
    }
    await onAddChecklist(newChecklistTitle.trim());
    setNewChecklistTitle("");
    setShowAddChecklist(false);
  }, [newChecklistTitle, onAddChecklist]);

  const handleAddItem = React.useCallback(async (checklistId: string) => {
    const title = newItemTitle[checklistId]?.trim();
    if (!title) {
      return;
    }
    await onAddItem(checklistId, title);
    setNewItemTitle(prev => ({ ...prev, [checklistId]: "" }));
  }, [newItemTitle, onAddItem]);

  return (
    <Section>
      <SectionHeader>
        <SectionTitle>{t("Checklist")}</SectionTitle>
        <AddChecklistButton onClick={() => setShowAddChecklist(true)}>
          <PlusIcon size={16} />
        </AddChecklistButton>
      </SectionHeader>

      {showAddChecklist && (
        <AddChecklistForm>
          <ChecklistInput
            autoFocus
            value={newChecklistTitle}
            onChange={(e) => setNewChecklistTitle(e.target.value)}
            placeholder={t("Checklist title...")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void handleAddChecklist();
              } else if (e.key === "Escape") {
                setShowAddChecklist(false);
                setNewChecklistTitle("");
              }
            }}
          />
          <Flex gap={8}>
            <Button onClick={handleAddChecklist}>{t("Add")}</Button>
            <Button neutral onClick={() => {
              setShowAddChecklist(false);
              setNewChecklistTitle("");
            }}>{t("Cancel")}</Button>
          </Flex>
        </AddChecklistForm>
      )}

      {checklists.map(checklist => (
        <ChecklistContainer key={checklist.id}>
          <ChecklistHeader>
            <ChecklistTitle>{checklist.title}</ChecklistTitle>
            <ChecklistActions>
              <ChecklistProgress>
                {checklist.completedCount}/{checklist.totalCount}
              </ChecklistProgress>
              <DeleteChecklistButton onClick={() => onDeleteChecklist(checklist.id)}>
                <TrashIcon size={14} />
              </DeleteChecklistButton>
              <AddItemButton onClick={() => setShowAddItem(prev => ({ ...prev, [checklist.id]: true }))}>
                <PlusIcon size={14} />
              </AddItemButton>
            </ChecklistActions>
          </ChecklistHeader>

          <ChecklistItems>
            {checklist.items.map(item => (
              <ChecklistItemRow key={item.id}>
                <Checkbox
                  type="checkbox"
                  checked={item.isCompleted}
                  onChange={() => onToggleItem(checklist.id, item.id, item.isCompleted)}
                />
                <ItemTitle $completed={item.isCompleted}>{item.title}</ItemTitle>
                <DeleteItemButton onClick={() => onDeleteItem(checklist.id, item.id, item.isCompleted)}>
                  <TrashIcon size={12} />
                </DeleteItemButton>
              </ChecklistItemRow>
            ))}

            {showAddItem[checklist.id] && (
              <AddItemForm>
                <AddItemInput
                  autoFocus
                  value={newItemTitle[checklist.id] || ""}
                  onChange={(e) => setNewItemTitle(prev => ({ ...prev, [checklist.id]: e.target.value }))}
                  placeholder={t("Add an item...")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void handleAddItem(checklist.id);
                    } else if (e.key === "Escape") {
                      setShowAddItem(prev => ({ ...prev, [checklist.id]: false }));
                      setNewItemTitle(prev => ({ ...prev, [checklist.id]: "" }));
                    }
                  }}
                />
                <Flex gap={4}>
                  <Button onClick={() => handleAddItem(checklist.id)}>{t("Add")}</Button>
                  <Button neutral onClick={() => {
                    setShowAddItem(prev => ({ ...prev, [checklist.id]: false }));
                    setNewItemTitle(prev => ({ ...prev, [checklist.id]: "" }));
                  }}>{t("Cancel")}</Button>
                </Flex>
              </AddItemForm>
            )}
          </ChecklistItems>
        </ChecklistContainer>
      ))}
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

const AddChecklistButton = styled.button`
  background: transparent;
  border: none;
  color: ${s("textTertiary")};
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  
  &:hover {
    background: ${s("backgroundSecondary")};
    color: ${s("text")};
  }
`;

const AddChecklistForm = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
  padding: 12px;
  background: ${s("backgroundSecondary")};
  border-radius: 8px;
`;

const ChecklistInput = styled.input`
  width: 100%;
  padding: 8px 12px;
  border: 1px solid ${s("inputBorder")};
  border-radius: 4px;
  background: ${s("background")};
  color: ${s("text")};
  font-size: 14px;
  
  &:focus {
    outline: none;
    border-color: ${s("accent")};
  }
`;

const ChecklistContainer = styled.div`
  margin-bottom: 20px;
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  overflow: hidden;
`;

const ChecklistHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: ${s("backgroundSecondary")};
  border-bottom: 1px solid ${s("divider")};
`;

const ChecklistTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${s("text")};
`;

const ChecklistActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ChecklistProgress = styled.div`
  font-size: 12px;
  color: ${s("textTertiary")};
  background: ${s("background")};
  padding: 2px 8px;
  border-radius: 12px;
`;

const DeleteChecklistButton = styled.button`
  background: transparent;
  border: none;
  color: ${s("textTertiary")};
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  opacity: 0.6;
  
  &:hover {
    opacity: 1;
    color: ${s("danger")};
  }
`;

const AddItemButton = styled.button`
  background: transparent;
  border: none;
  color: ${s("textTertiary")};
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  
  &:hover {
    background: ${s("backgroundSecondary")};
    color: ${s("text")};
  }
`;

const ChecklistItems = styled.div`
  padding: 8px 0;
`;

const ChecklistItemRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  
  &:hover {
    background: ${s("backgroundSecondary")};
    
    button {
      opacity: 1;
    }
  }
`;

const Checkbox = styled.input`
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: ${s("accent")};
`;

const ItemTitle = styled.span<{ $completed?: boolean }>`
  flex: 1;
  font-size: 14px;
  color: ${s("text")};
  
  ${props => props.$completed && css`
    text-decoration: line-through;
    color: ${s("textTertiary")};
  `}
`;

const DeleteItemButton = styled.button`
  background: transparent;
  border: none;
  color: ${s("textTertiary")};
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  opacity: 0;
  
  &:hover {
    color: ${s("danger")};
  }
`;

const AddItemForm = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 16px;
`;

const AddItemInput = styled.input`
  width: 100%;
  padding: 8px 12px;
  border: 1px solid ${s("inputBorder")};
  border-radius: 4px;
  background: ${s("background")};
  color: ${s("text")};
  font-size: 14px;
  
  &:focus {
    outline: none;
    border-color: ${s("accent")};
  }
`;

export default CardDetailChecklist;
