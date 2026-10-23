import { observer } from "mobx-react";
import { TableIcon, PlusIcon, TrashIcon } from "outline-icons";
import { useTranslation, Trans } from "react-i18next";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import type { DragEvent } from "react";
import { useHistory } from "react-router-dom";
import styled, { css } from "styled-components";
import fractionalIndex from "fractional-index";
import { s } from "@shared/styles";
import ConfirmationDialog from "~/components/ConfirmationDialog";
import Heading from "~/components/Heading";
import Scene from "~/components/Scene";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Text from "~/components/Text";
import useStores from "~/hooks/useStores";
import { kanbanCardPath } from "~/utils/routeHelpers";
import { toast } from "sonner";
import ImplementCardButton, { ImplementButtonWrapper } from "~/components/Kanban/ImplementCardButton";

interface DragState {
  cardId: string | null;
  sourceListId: string | null;
}



interface ListDragState {
  listId: string | null;
  originalIndex: number | null;
  isDragging: boolean;
}

/**
 * Kanban board scene for managing tasks and documents visually.
 *
 * @returns the kanban scene component.
 */
function Kanban() {
  const { t } = useTranslation();
  const history = useHistory();
  const { kanbanBoards, kanbanLists, kanbanCards, dialogs } = useStores();
  const [activeBoard, setActiveBoard] = useState<string | null>(null);
  const [newCardTitle, setNewCardTitle] = useState<{ [listId: string]: string }>({});
  const [showCardForm, setShowCardForm] = useState<{ [listId: string]: boolean }>({});
  const [isLoading, setIsLoading] = useState(true);
  const [dragState, setDragState] = useState<DragState>({ cardId: null, sourceListId: null });
  const [dropTargetListId, setDropTargetListId] = useState<string | null>(null);
  const [cardDropTargetIndex, setCardDropTargetIndex] = useState<{ listId: string; index: number } | null>(null);
  const [newListName, setNewListName] = useState("");
  const [showAddList, setShowAddList] = useState(false);
  const [listDragState, setListDragState] = useState<ListDragState>({ listId: null, originalIndex: null, isDragging: false });
  const [previewDropIndex, setPreviewDropIndex] = useState<number | null>(null);
  const [autoScrollInterval, setAutoScrollInterval] = useState<NodeJS.Timeout | null>(null);
  const [sortBy, setSortBy] = useState<"createdAt" | "dueDate" | "updatedAt">("createdAt");

  // Load boards on mount
  useEffect(() => {
    const loadBoards = async () => {
      try {
        await kanbanBoards.fetchPage({ limit: 100 });

        // Select first board if available
        const firstBoard = kanbanBoards.orderedData[0];
        if (firstBoard) {
          setActiveBoard(firstBoard.id);
          await kanbanBoards.fetchWithDetails(firstBoard.id);
        }
      } catch (_error) {
        toast.error(t("Failed to load boards"));
      } finally {
        setIsLoading(false);
      }
    };

    void loadBoards();
  }, [kanbanBoards, t]);

  const handleAddCard = async (listId: string) => {
    const title = newCardTitle[listId]?.trim();
    if (!title) { return; }

    try {
      await kanbanCards.create({
        listId,
        title,
      });

      setNewCardTitle(prev => ({ ...prev, [listId]: "" }));
      setShowCardForm(prev => ({ ...prev, [listId]: false }));
      toast.success(t("Card added"));
    } catch (_error) {
      toast.error(t("Failed to add card"));
    }
  };

  const handleCreateBoard = async () => {
    try {
      const board = await kanbanBoards.create({
        name: t("Kanban"),
        description: "",
      });
      setActiveBoard(board.id);
      await kanbanBoards.fetchWithDetails(board.id);
      toast.success(t("Board created"));
    } catch (_error) {
      toast.error(t("Failed to create board"));
    }
  };



  const handleAddList = async () => {
    const name = newListName.trim();
    if (!name || !activeBoard) {
      return;
    }

    try {
      await kanbanLists.create({
        boardId: activeBoard,
        name,
      });
      setNewListName("");
      setShowAddList(false);
      toast.success(t("List added"));
    } catch (_error) {
      toast.error(t("Failed to add list"));
    }
  };

  const handleDeleteList = (listId: string) => {
    const list = kanbanLists.get(listId);
    if (!list) {
      return;
    }

    dialogs.openModal({
      title: t("Delete list"),
      content: (
        <ConfirmationDialog
          onSubmit={async () => {
            try {
              await kanbanLists.delete(list);
              toast.success(t("List deleted"));
            } catch (_error) {
              toast.error(t("Failed to delete list"));
            }
          }}
          submitText={t("I'm sure – Delete")}
          savingText={`${t("Deleting")}…`}
          danger
        >
          <Text as="p" type="secondary">
            <Trans>
              Are you sure you want to delete this list? All cards in this list will be permanently deleted.
            </Trans>
          </Text>
        </ConfirmationDialog>
      ),
    });
  };

  const handleDeleteCard = (cardId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    const card = kanbanCards.get(cardId);
    if (!card) {
      return;
    }

    dialogs.openModal({
      title: t("Delete card"),
      content: (
        <ConfirmationDialog
          onSubmit={async () => {
            try {
              await kanbanCards.delete(card);
              toast.success(t("Card deleted"));
            } catch (_error) {
              toast.error(t("Failed to delete card"));
            }
          }}
          submitText={t("I'm sure – Delete")}
          savingText={`${t("Deleting")}…`}
          danger
        >
          <Text as="p" type="secondary">
            <Trans>
              Are you sure you want to permanently delete this card?
            </Trans>
          </Text>
        </ConfirmationDialog>
      ),
    });
  };

  /**
   * Moves a card to the "Done" list when checkbox is clicked.
   *
   * @param cardId - The ID of the card to complete.
   * @param currentListId - The current list ID of the card.
   * @param e - The click event.
   */
  const handleCompleteCard = async (cardId: string, currentListId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    // Find the "Done" list
    const doneList = lists.find(list => list.name === "Done");
    if (!doneList) {
      toast.error(t("Done list not found"));
      return;
    }

    // Don't do anything if card is already in Done list
    if (currentListId === doneList.id) {
      return;
    }

    try {
      // Move card to the beginning of Done list
      const cardsInDoneList = kanbanCards.orderedData.filter(c => c.listId === doneList.id);
      const firstIndex = cardsInDoneList.length > 0 ? cardsInDoneList[0].index : null;
      const newIndex = fractionalIndex(null, firstIndex);

      await kanbanCards.move(cardId, doneList.id, newIndex);
      toast.success(t("Card marked as done"));
    } catch (_error) {
      toast.error(t("Failed to complete card"));
    }
  };

  /**
   * Opens the card detail page for viewing and editing card details.
   *
   * @param cardId - The ID of the card to open.
   */
  const handleOpenCard = useCallback((cardId: string) => {
    history.push(kanbanCardPath(cardId));
  }, [history]);

  // Get lists for active board
  const lists = activeBoard
    ? kanbanLists.orderedData.filter(list => list.boardId === activeBoard)
    : [];

  // Compute display order with live preview during drag
  const displayLists = useMemo(() => {
    if (!listDragState.listId || previewDropIndex === null || listDragState.originalIndex === null) {
      return lists;
    }

    const result = [...lists];
    const draggedIndex = listDragState.originalIndex;
    const targetIndex = previewDropIndex;

    if (draggedIndex === targetIndex) {
      return lists;
    }

    // Remove the dragged item
    const [draggedItem] = result.splice(draggedIndex, 1);
    // Insert at new position
    result.splice(targetIndex, 0, draggedItem);

    return result;
  }, [lists, listDragState.listId, listDragState.originalIndex, previewDropIndex]);

  // Cleanup auto-scroll on unmount
  useEffect(() => () => {
    if (autoScrollInterval) {
      clearInterval(autoScrollInterval);
    }
  }, [autoScrollInterval]);

  // Get cards for each list with preview support
  const getCardsForList = useCallback((listId: string) => {
    let cards = kanbanCards.orderedData.filter(card => card.listId === listId);

    // Sort cards based on selected sort option
    cards = [...cards].sort((a, b) => {
      switch (sortBy) {
        case "createdAt":
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "dueDate":
          // Cards without due date go to the end
          if (!a.dueDate && !b.dueDate) { return 0; }
          if (!a.dueDate) { return 1; }
          if (!b.dueDate) { return -1; }
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        case "updatedAt":
          return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        default:
          return 0;
      }
    });

    if (!dragState.cardId || !cardDropTargetIndex) {
      return cards;
    }

    // Dragging within same list
    if (dragState.sourceListId === listId && cardDropTargetIndex.listId === listId) {
      const draggedCardIndex = cards.findIndex(c => c.id === dragState.cardId);
      if (draggedCardIndex !== -1 && cardDropTargetIndex.index !== draggedCardIndex) {
        const result = [...cards];
        const [draggedCard] = result.splice(draggedCardIndex, 1);
        result.splice(cardDropTargetIndex.index, 0, draggedCard);
        return result;
      }
    }

    // Dragging from another list TO this list - show preview
    if (dragState.sourceListId !== listId && cardDropTargetIndex.listId === listId) {
      const draggedCard = kanbanCards.get(dragState.cardId);
      if (draggedCard) {
        const result = [...cards];
        // Create a preview card object
        const previewCard = { ...draggedCard, listId };
        result.splice(cardDropTargetIndex.index, 0, previewCard as typeof draggedCard);
        return result;
      }
    }

    // Dragging FROM this list to another - hide the dragged card
    if (dragState.sourceListId === listId && cardDropTargetIndex.listId !== listId) {
      return cards.filter(c => c.id !== dragState.cardId);
    }

    return cards;
  }, [kanbanCards, dragState.cardId, dragState.sourceListId, cardDropTargetIndex, sortBy]);

  // Drag and drop handlers
  const handleDragStart = useCallback((e: DragEvent<HTMLDivElement>, cardId: string, listId: string) => {
    setDragState({ cardId, sourceListId: listId });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", cardId);

    // Add visual feedback
    const target = e.target as HTMLElement;
    setTimeout(() => {
      target.style.opacity = "0.5";
    }, 0);
  }, []);

  const handleDragEnd = useCallback((e: DragEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    target.style.opacity = "1";
    setDragState({ cardId: null, sourceListId: null });
    setDropTargetListId(null);
    setCardDropTargetIndex(null);

    // Clear auto-scroll interval
    if (autoScrollInterval) {
      clearInterval(autoScrollInterval);
      setAutoScrollInterval(null);
    }
  }, [autoScrollInterval]);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDragEnter = useCallback((e: DragEvent<HTMLDivElement>, listId: string) => {
    e.preventDefault();
    if (dragState.cardId && listId !== dragState.sourceListId) {
      setDropTargetListId(listId);
    }
  }, [dragState]);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>, listId: string) => {
    e.preventDefault();
    // Only clear if we're leaving the column entirely
    const relatedTarget = e.relatedTarget as HTMLElement;
    const currentTarget = e.currentTarget as HTMLElement;
    if (!currentTarget.contains(relatedTarget)) {
      if (dropTargetListId === listId) {
        setDropTargetListId(null);
      }
    }
  }, [dropTargetListId]);

  const handleDrop = useCallback(async (e: DragEvent<HTMLDivElement>, targetListId: string) => {
    e.preventDefault();
    setDropTargetListId(null);

    const { cardId, sourceListId } = dragState;

    if (!cardId || !sourceListId) {
      return;
    }

    // Handle card reorder within same list
    if (sourceListId === targetListId && cardDropTargetIndex?.listId === targetListId) {
      const cards = kanbanCards.orderedData.filter(c => c.listId === targetListId);
      const originalIndex = cards.findIndex(c => c.id === cardId);
      const targetIndex = cardDropTargetIndex.index;

      if (originalIndex === targetIndex) {
        setDragState({ cardId: null, sourceListId: null });
        setCardDropTargetIndex(null);
        return;
      }

      try {
        // Reindex cards based on new order
        const reorderedCards = [...cards];
        const [draggedCard] = reorderedCards.splice(originalIndex, 1);
        reorderedCards.splice(targetIndex, 0, draggedCard);

        // Generate new indices
        const updates: Promise<void>[] = [];
        let prev: string | null = null;
        for (const card of reorderedCards) {
          const newIndex = fractionalIndex(prev, null);
          if (card.index !== newIndex) {
            updates.push(kanbanCards.move(card.id, undefined, newIndex));
          }
          prev = newIndex;
        }

        await Promise.all(updates);

        toast.success(t("Card moved"));
      } catch (_error) {
        toast.error(t("Failed to move card"));
      }

      setDragState({ cardId: null, sourceListId: null });
      setCardDropTargetIndex(null);
      return;
    }

    // Handle moving card to different list
    if (sourceListId !== targetListId) {
      try {
        const targetCards = kanbanCards.orderedData.filter(c => c.listId === targetListId);
        const draggedCard = kanbanCards.get(cardId);

        if (!draggedCard) {
          throw new Error("Card not found");
        }

        // If we have a specific drop position, use it
        if (cardDropTargetIndex?.listId === targetListId) {
          // Insert at specific position
          const insertIndex = cardDropTargetIndex.index;
          const newCards = [...targetCards];
          newCards.splice(insertIndex, 0, draggedCard);

          // Generate new indices for all cards in target list
          const updates: Promise<void>[] = [];
          let prev: string | null = null;
          for (const card of newCards) {
            const newIndex = fractionalIndex(prev, null);
            if (card.id === cardId) {
              // Move the dragged card with new listId and index
              updates.push(kanbanCards.move(cardId, targetListId, newIndex));
            } else if (card.index !== newIndex) {
              updates.push(kanbanCards.move(card.id, undefined, newIndex));
            }
            prev = newIndex;
          }

          await Promise.all(updates);
        } else {
          // Just move to end of list
          await kanbanCards.update({
            id: cardId,
            listId: targetListId,
          });
        }

        toast.success(t("Card moved"));
      } catch (_error) {
        toast.error(t("Failed to move card"));
      }
    }

    setDragState({ cardId: null, sourceListId: null });
    setCardDropTargetIndex(null);
  }, [dragState, cardDropTargetIndex, kanbanCards, kanbanBoards, activeBoard, t]);

  // Auto-scroll handler for smooth scrolling
  const handleAutoScroll = useCallback((columnElement: HTMLElement, mouseY: number) => {
    const rect = columnElement.getBoundingClientRect();
    const scrollThreshold = 80; // pixels from edge to start scrolling
    const maxScrollSpeed = 15; // max pixels per frame

    const distanceFromTop = mouseY - rect.top;
    const distanceFromBottom = rect.bottom - mouseY;

    let scrollSpeed = 0;

    if (distanceFromTop < scrollThreshold && distanceFromTop > 0) {
      // Scroll up - speed increases as we get closer to edge
      scrollSpeed = -maxScrollSpeed * (1 - distanceFromTop / scrollThreshold);
    } else if (distanceFromBottom < scrollThreshold && distanceFromBottom > 0) {
      // Scroll down - speed increases as we get closer to edge
      scrollSpeed = maxScrollSpeed * (1 - distanceFromBottom / scrollThreshold);
    }

    if (scrollSpeed !== 0) {
      columnElement.scrollTop += scrollSpeed;
    }

    return scrollSpeed !== 0;
  }, []);

  // Card drag over handler for reordering within list or cross-list
  const handleCardDragOver = useCallback((e: DragEvent<HTMLDivElement>, listId: string, cardId: string, _cardIndex: number) => {
    e.preventDefault();
    e.stopPropagation();

    if (!dragState.cardId || dragState.cardId === cardId) {
      return;
    }

    const targetRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isBefore = e.clientY < targetRect.top + targetRect.height / 2;

    const cards = kanbanCards.orderedData.filter(c => c.listId === listId);
    const cardsWithoutDragged = cards.filter(c => c.id !== dragState.cardId);
    const baseIndex = cardsWithoutDragged.findIndex(c => c.id === cardId);

    if (baseIndex === -1) {
      return;
    }

    const insertIndex = isBefore ? baseIndex : baseIndex + 1;

    setCardDropTargetIndex({ listId, index: Math.min(insertIndex, cardsWithoutDragged.length) });

    // Update drop target list for cross-list moves
    if (dragState.sourceListId !== listId) {
      setDropTargetListId(listId);
    }

    // Auto-scroll the column if dragging near edges
    const columnContent = (e.currentTarget as HTMLElement).closest('.column-content') as HTMLElement;
    if (columnContent) {
      handleAutoScroll(columnContent, e.clientY);
    }
  }, [dragState.cardId, dragState.sourceListId, kanbanCards.orderedData, handleAutoScroll]);

  // List (column) drag and drop handlers
  const handleListDragStart = useCallback((e: DragEvent<HTMLDivElement>, listId: string, index: number) => {
    setListDragState({ listId, originalIndex: index, isDragging: false });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/list-id", listId);
  }, []);

  const handleListDragEnd = useCallback((_e: DragEvent<HTMLDivElement>) => {
    setListDragState({ listId: null, originalIndex: null, isDragging: false });
    setPreviewDropIndex(null);
  }, []);

  const handleListDragOver = useCallback((e: DragEvent<HTMLDivElement>, listId: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (!listDragState.listId) {
      return;
    }

    const targetRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isBefore = e.clientX < targetRect.left + targetRect.width / 2;

    const listsWithoutDragged = lists.filter(l => l.id !== listDragState.listId);
    const baseIndex = listsWithoutDragged.findIndex(l => l.id === listId);
    if (baseIndex === -1) {
      return;
    }

    let insertIndex = isBefore ? baseIndex : baseIndex + 1;
    insertIndex = Math.max(0, Math.min(insertIndex, listsWithoutDragged.length));

    if (!listDragState.isDragging) {
      setListDragState(prev => ({ ...prev, isDragging: true }));
    }

    setPreviewDropIndex(insertIndex);
  }, [listDragState.listId, listDragState.isDragging, lists]);

  const handleListDrop = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const { listId, originalIndex } = listDragState;
    const targetIndex = previewDropIndex;

    // Reset state
    setPreviewDropIndex(null);
    setListDragState({ listId: null, originalIndex: null, isDragging: false });

    if (!listId || originalIndex === null || targetIndex === null || originalIndex === targetIndex) {
      return;
    }

    try {
      // Reindex all lists based on the preview order to avoid null/duplicate indices
      const newIndices = new Map<string, string>();
      let prev: string | null = null;
      for (const item of displayLists) {
        const idx = fractionalIndex(prev, null);
        newIndices.set(item.id, idx);
        prev = idx;
      }

      // Apply updates only where index actually changes
      const updates = displayLists
        .filter(item => item.index !== newIndices.get(item.id))
        .map(item => kanbanLists.move(item.id, newIndices.get(item.id)!));

      await Promise.all(updates);

      toast.success(t("List moved"));
    } catch (_error) {
      toast.error(t("Failed to move list"));
    }
  }, [listDragState, previewDropIndex, displayLists, kanbanLists, kanbanBoards, activeBoard, t]);

  // SVG ICONS
  const AssigneeIcon = () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 17c0-2.7614 3.134-5 7-5s7 2.2386 7 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
  const DueDateIcon = () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="5" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 2v3M13 2v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="12" r="2" fill="currentColor" />
    </svg>
  );
  const PriorityIcon = () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 3L13 9H7L10 3Z" fill="currentColor" />
      <rect x="9" y="9" width="2" height="7" rx="1" fill="currentColor" />
    </svg>
  );

  if (isLoading) {
    return (
      <Scene icon={<TableIcon />} title={t("Kanban")}>
        <Heading>{t("Loading...")}</Heading>
      </Scene>
    );
  }

  if (!activeBoard) {
    return (
      <Scene icon={<TableIcon />} title={t("Kanban")}>
        <Flex column align="center" justify="center" style={{ height: "60vh", gap: "16px" }}>
          <Heading>{t("No boards yet")}</Heading>
          <Button icon={<PlusIcon />} onClick={handleCreateBoard}>
            {t("Create your first board")}
          </Button>
        </Flex>
      </Scene>
    );
  }

  return (
    <KanbanPageWrapper>
      <Scene
        icon={<TableIcon />}
        title={kanbanBoards.get(activeBoard)?.name || t("Kanban")}
        centered={false}
        wide
        left={
          <BoardHeaderTitle>
            {kanbanBoards.get(activeBoard)?.name || t("Kanban")}
          </BoardHeaderTitle>
        }
        actions={
          <Flex gap={8} align="center">
            <SortSelect
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "createdAt" | "dueDate" | "updatedAt")}
              aria-label={t("Sort cards by")}
            >
              <option value="createdAt">{t("Sort by Created")}</option>
              <option value="dueDate">{t("Sort by Due Date")}</option>
              <option value="updatedAt">{t("Sort by Last Modified")}</option>
            </SortSelect>
          </Flex>
        }
      >
        <BoardWrapper>
          <Container>
            <Board>
              {displayLists.map((list, _index) => {
                const cards = getCardsForList(list.id);
                const isDropTarget = dropTargetListId === list.id;
                const isDraggingList = listDragState.listId === list.id && listDragState.isDragging;

                return (
                  <Column
                    key={list.id}
                    draggable
                    $isDropTarget={isDropTarget}
                    $isDraggingList={isDraggingList}
                    onDragStart={(e) => {
                      // Only start list drag if not dragging from card
                      if (!dragState.cardId) {
                        // Find original index in the actual lists array
                        const originalIdx = lists.findIndex(l => l.id === list.id);
                        handleListDragStart(e, list.id, originalIdx);
                      }
                    }}
                    onDragEnd={(e) => {
                      if (listDragState.listId) {
                        handleListDragEnd(e);
                      }
                    }}
                    onDragOver={(e) => {
                      handleDragOver(e);
                      if (listDragState.listId) {
                        handleListDragOver(e, list.id);
                      }
                    }}
                    onDragEnter={(e) => handleDragEnter(e, list.id)}
                    onDragLeave={(e) => handleDragLeave(e, list.id)}
                    onDrop={(e) => {
                      if (listDragState.listId) {
                        void handleListDrop(e);
                      } else {
                        void handleDrop(e, list.id);
                      }
                    }}
                  >
                    <ColumnHeader>
                      <DragHandle title={t("Drag to reorder")}>⋮⋮</DragHandle>
                      <ColumnTitle>{list.name}</ColumnTitle>
                      <ColumnHeaderRight>
                        <CardCount>{cards.length}</CardCount>
                        <AddCardHeaderButton
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowCardForm(prev => ({ ...prev, [list.id]: true }));
                          }}
                          title={t("Add card")}
                        >
                          <PlusIcon size={16} />
                        </AddCardHeaderButton>
                        <DeleteListButton
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteList(list.id);
                          }}
                          title={t("Delete list")}
                        >
                          <TrashIcon size={16} />
                        </DeleteListButton>
                      </ColumnHeaderRight>
                    </ColumnHeader>

                    <ColumnContent
                      className="column-content"
                      onDragOver={(e) => {
                        e.preventDefault();
                        // When hovering over empty area of list, set drop target to end
                        if (dragState.cardId && dragState.sourceListId !== list.id) {
                          const cardsInList = kanbanCards.orderedData.filter(c => c.listId === list.id);
                          setCardDropTargetIndex({ listId: list.id, index: cardsInList.length });
                          setDropTargetListId(list.id);
                        }

                        // Auto-scroll when dragging over empty area
                        const columnContent = e.currentTarget as HTMLElement;
                        handleAutoScroll(columnContent, e.clientY);
                      }}
                    >
                      {cards.map((card, cardIndex) => (
                        <CardWrapper key={card.id}>
                          <Card
                            draggable
                            onClick={() => handleOpenCard(card.id)}
                            onDragStart={(e) => {
                              e.stopPropagation();
                              handleDragStart(e, card.id, list.id);
                            }}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => handleCardDragOver(e, list.id, card.id, cardIndex)}
                            $isDragging={dragState.cardId === card.id}
                          >
                            <CardHeader>
                              <CompleteCheckbox
                                type="checkbox"
                                checked={list.name === "Done"}
                                onChange={() => { }}
                                onClick={(e) => void handleCompleteCard(card.id, list.id, e)}
                                title={list.name === "Done" ? t("Completed") : t("Mark as done")}
                              />
                              <CardTitle>{card.title}</CardTitle>
                              <DeleteCardButton
                                onClick={(e) => void handleDeleteCard(card.id, e)}
                                title={t("Delete card")}
                              >
                                <TrashIcon size={14} />
                              </DeleteCardButton>
                            </CardHeader>
                            {card.description && (
                              <CardDescription>{card.description}</CardDescription>
                            )}
                            {/* Card meta info */}
                            <CardMetaList>
                              {card.members && card.members.length > 0 && (
                                <CardMetaRow>
                                  <MetaIcon><AssigneeIcon /></MetaIcon>
                                  <MetaLabel>{t("Assignee")}:</MetaLabel>
                                  <MetaValue>
                                    <AssigneeInfo>
                                      {card.members[0].avatarUrl ? (
                                        <AssigneeAvatar src={card.members[0].avatarUrl} alt={card.members[0].name} />
                                      ) : (
                                        <AssigneeInitial>{(card.members[0].name || card.members[0].email || "?").charAt(0).toUpperCase()}</AssigneeInitial>
                                      )}
                                      <span>{card.members[0].name || card.members[0].email}</span>
                                      {card.members.length > 1 && (
                                        <MoreAssignees>+{card.members.length - 1}</MoreAssignees>
                                      )}
                                    </AssigneeInfo>
                                  </MetaValue>
                                </CardMetaRow>
                              )}
                              {card.dueDate && (
                                <CardMetaRow>
                                  <MetaIcon><DueDateIcon /></MetaIcon>
                                  <MetaLabel>{t("Due Date")}:</MetaLabel>
                                  <MetaValue $isOverdue={new Date(card.dueDate) < new Date()}>
                                    {new Date(card.dueDate).toLocaleDateString("en-GB")}
                                  </MetaValue>
                                </CardMetaRow>
                              )}
                              {card.priority && (
                                <CardMetaRow>
                                  <MetaIcon><PriorityIcon /></MetaIcon>
                                  <MetaLabel>{t("Priority")}:</MetaLabel>
                                  <MetaValue>
                                    <PriorityBadge $color={card.priorityColor || "#3B82F6"}>
                                      {card.priorityLabel || card.priority}
                                    </PriorityBadge>
                                  </MetaValue>
                                </CardMetaRow>
                              )}
                            </CardMetaList>
                            <ImplementCardButton
                              cardId={card.id}
                              implementStatus={card.implementStatus}
                              implementError={card.implementError ?? null}
                            />
                          </Card>
                        </CardWrapper>
                      ))}

                      {showCardForm[list.id] ? (
                        <NewCardForm>
                          <CardInput
                            autoFocus
                            placeholder={t("Enter card title...")}
                            value={newCardTitle[list.id] || ""}
                            onChange={(e) => setNewCardTitle(prev => ({
                              ...prev,
                              [list.id]: e.target.value,
                            }))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                void handleAddCard(list.id);
                              } else if (e.key === "Escape") {
                                setShowCardForm(prev => ({ ...prev, [list.id]: false }));
                                setNewCardTitle(prev => ({ ...prev, [list.id]: "" }));
                              }
                            }}
                          />
                          <FormActions>
                            <AddButton onClick={() => void handleAddCard(list.id)}>
                              {t("Add card")}
                            </AddButton>
                            <CancelButton onClick={() => {
                              setShowCardForm(prev => ({ ...prev, [list.id]: false }));
                              setNewCardTitle(prev => ({ ...prev, [list.id]: "" }));
                            }}>
                              {t("Cancel")}
                            </CancelButton>
                          </FormActions>
                        </NewCardForm>
                      ) : (
                        <AddCardButton onClick={() => setShowCardForm(prev => ({ ...prev, [list.id]: true }))}>
                          <PlusIcon size={16} />
                          <span>{t("Add a card")}</span>
                        </AddCardButton>
                      )}
                    </ColumnContent>
                  </Column>
                );
              })}

              {/* Add new list column */}
              <AddListColumn>
                {showAddList ? (
                  <NewListForm>
                    <ListInput
                      autoFocus
                      placeholder={t("Enter list name...")}
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          void handleAddList();
                        } else if (e.key === "Escape") {
                          setShowAddList(false);
                          setNewListName("");
                        }
                      }}
                    />
                    <FormActions>
                      <AddButton onClick={() => void handleAddList()}>
                        {t("Add list")}
                      </AddButton>
                      <CancelButton onClick={() => {
                        setShowAddList(false);
                        setNewListName("");
                      }}>
                        {t("Cancel")}
                      </CancelButton>
                    </FormActions>
                  </NewListForm>
                ) : (
                  <AddListButton onClick={() => setShowAddList(true)}>
                    <PlusIcon size={18} />
                    <span>{t("Add another list")}</span>
                  </AddListButton>
                )}
              </AddListColumn>
            </Board>
          </Container>
        </BoardWrapper>
      </Scene>
    </KanbanPageWrapper>
  );
}

const KanbanPageWrapper = styled.div`
  width: 100%;
  height: 100vh;
  overflow: hidden;
`;

const BoardHeaderTitle = styled.span`
  font-size: 22px;
  font-weight: 700;
  color: ${s("text")};
  white-space: nowrap;
  margin-left: 7px;
`;

const BoardWrapper = styled.div`
  padding: 0 32px 0 32px;
  height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const Container = styled.div`
  flex: 1;
  min-height: 0;
  overflow: hidden;
`;

const Board = styled.div`
  display: flex;
  gap: 24px;
  overflow-x: auto;
  overflow-y: hidden;
  height: 100%;
  padding: 0 8px 8px 8px;
`;

const Column = styled.div<{
  $isDropTarget?: boolean;
  $isDraggingList?: boolean;
}>`
  flex: 0 0 330px;
  min-width: 330px;
  background: ${s("backgroundSecondary")};
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  max-height: 100%;
  transition: transform 0.2s ease, opacity 0.2s ease;
  cursor: grab;

  ${({ $isDropTarget }) =>
    $isDropTarget &&
    css`
      background: ${s("accent")}15;
      border: 2px dashed ${s("accent")};
    `}
  
  ${({ $isDraggingList }) =>
    $isDraggingList &&
    css`
      opacity: 0.6;
      cursor: grabbing;
      transform: scale(0.98);
    `}
`;

const ColumnHeader = styled.div`
  padding: 12px 16px;
  font-weight: 600;
  font-size: 14px;
  color: ${s("text")};
  border-bottom: 1px solid ${s("divider")};
  display: flex;
  align-items: center;
  gap: 8px;
`;

const DragHandle = styled.span`
  cursor: grab;
  color: ${s("textSecondary")};
  font-size: 14px;
  user-select: none;
  
  &:hover {
    color: ${s("text")};
  }
  
  &:active {
    cursor: grabbing;
  }
`;

const ColumnTitle = styled.span`
  flex: 1;
`;

const ColumnHeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const CardCount = styled.span`
  background: ${s("background")};
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  color: ${s("textSecondary")};
`;

const AddCardHeaderButton = styled.button`
  background: transparent;
  border: none;
  padding: 4px;
  border-radius: 4px;
  color: ${s("textSecondary")};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.5;
  transition: all 0.15s ease;

  &:hover {
    opacity: 1;
    background: ${s("backgroundTertiary")};
    color: ${s("accent")};
  }
`;

const DeleteListButton = styled.button`
  background: transparent;
  border: none;
  padding: 4px;
  border-radius: 4px;
  color: ${s("textSecondary")};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.5;
  transition: all 0.15s ease;

  &:hover {
    opacity: 1;
    background: ${s("backgroundTertiary")};
    color: ${s("danger")};
  }
`;

const ColumnContent = styled.div`
  padding: 12px;
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: all 0.3s ease;
`;

const Card = styled.div<{ $isDragging?: boolean }>`
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 6px;
  padding: 12px;
  cursor: grab;
  position: relative;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  transform-origin: center;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    transform: translateY(-1px);
  }

  ${({ $isDragging }) =>
    $isDragging &&
    css`
      opacity: 0.5;
      cursor: grabbing;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      transform: scale(1.02);
    `}

  &:hover {
    .delete-card-btn {
      opacity: 1;
    }
  }
`;

const CardHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
`;

const CompleteCheckbox = styled.input`
  width: 16px;
  height: 16px;
  margin: 0;
  cursor: pointer;
  accent-color: ${s("accent")};
  flex-shrink: 0;
  margin-top: 2px;
  border-radius: 50%;
  appearance: none;
  border: 2px solid ${s("textTertiary")};
  position: relative;
  background: ${s("background")};
  transition: all 0.2s ease;

  &:hover {
    border-color: ${s("accent")};
  }

  &:checked {
    background: #22C55E;
    border-color: #22C55E;

    &::after {
      content: "✓";
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: white;
      font-size: 10px;
      font-weight: bold;
    }
  }
`;

const CardTitle = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: ${s("text")};
  flex: 1;
  min-width: 0;
  overflow-wrap: break-word;
  word-break: break-word;
`;

const DeleteCardButton = styled.button.attrs({ className: 'delete-card-btn' })`
  background: transparent;
  border: none;
  padding: 2px;
  border-radius: 4px;
  color: ${s("textSecondary")};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all 0.15s ease;
  flex-shrink: 0;

  &:hover {
    background: ${s("backgroundTertiary")};
    color: ${s("danger")};
  }
`;

const CardDescription = styled.div`
  font-size: 13px;
  color: ${s("textSecondary")};
  margin-top: 4px;
  overflow-wrap: break-word;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;

const NewCardForm = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const CardInput = styled.input`
  background: ${s("background")};
  border: 2px solid ${s("link")};
  border-radius: 6px;
  padding: 12px;
  font-size: 14px;
  color: ${s("text")};
  outline: none;

  &::placeholder {
    color: ${s("textTertiary")};
  }
`;

const FormActions = styled.div`
  display: flex;
  gap: 8px;
`;

const AddButton = styled.button`
  background: ${s("link")};
  color: white;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.1s ease;

  &:hover {
    opacity: 0.9;
  }
`;

const CancelButton = styled.button`
  background: transparent;
  color: ${s("textSecondary")};
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.1s ease;

  &:hover {
    background: ${s("backgroundTertiary")};
  }
`;

const AddCardButton = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px dashed ${s("divider")};
  border-radius: 6px;
  padding: 10px;
  width: 100%;
  font-size: 14px;
  color: ${s("textSecondary")};
  cursor: pointer;
  transition: all 0.1s ease;

  &:hover {
    background: ${s("backgroundTertiary")};
    border-color: ${s("text")};
    color: ${s("text")};
  }
`;

const AddListColumn = styled.div`
  flex: 0 0 320px;
  height: fit-content;
`;

const AddListButton = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  background: ${s("backgroundSecondary")};
  border: 2px dashed ${s("divider")};
  border-radius: 8px;
  padding: 16px;
  width: 100%;
  font-size: 14px;
  font-weight: 500;
  color: ${s("textSecondary")};
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: ${s("backgroundTertiary")};
    border-color: ${s("accent")};
    color: ${s("accent")};
  }
`;

const NewListForm = styled.div`
  background: ${s("backgroundSecondary")};
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const ListInput = styled.input`
  background: ${s("background")};
  border: 2px solid ${s("accent")};
  border-radius: 6px;
  padding: 12px;
  font-size: 14px;
  color: ${s("text")};
  outline: none;
  width: 100%;
  box-sizing: border-box;

  &::placeholder {
    color: ${s("textTertiary")};
  }
`;



const CardMetaList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid ${s("divider")};
`;

const CardMetaRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
`;

const MetaIcon = styled.span`
  font-size: 14px;
  width: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${s("textTertiary")};
`;

const MetaLabel = styled.span`
  color: ${s("textSecondary")};
  min-width: 70px;
`;

const MetaValue = styled.span<{ $isOverdue?: boolean }>`
  color: ${props => props.$isOverdue ? s("danger") : s("text")};
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
`;

const AssigneeInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const AssigneeAvatar = styled.img`
  width: 22px;
  height: 22px;
  border-radius: 50%;
  object-fit: cover;
  background: ${s("accent")};
`;

const AssigneeInitial = styled.div`
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: ${s("accent")};
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
`;

const MoreAssignees = styled.span`
  font-size: 11px;
  color: ${s("textTertiary")};
  margin-left: 2px;
`;











const PriorityBadge = styled.span<{ $color: string }>`
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 4px;
  background: ${props => props.$color || "#3B82F6"};
  color: ${props => {
    // Calculate if text should be light or dark based on background color
    const hex = props.$color?.replace("#", "") || "3B82F6";
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? "#1F2937" : "#FFFFFF";
  }};
`;







const SortSelect = styled.select`
  background: ${s("backgroundSecondary")};
  border: 1px solid ${s("divider")};
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 14px;
  color: ${s("text")};
  cursor: pointer;
  outline: none;
  transition: all 0.2s ease;

  &:hover {
    border-color: ${s("accent")};
  }

  &:focus {
    border-color: ${s("accent")};
    box-shadow: 0 0 0 2px ${s("accent")}20;
  }

  option {
    background: ${s("background")};
    color: ${s("text")};
  }
`;


const CardWrapper = styled.div`
  position: relative;

  ${ImplementButtonWrapper} {
    max-height: 200px;
    overflow: visible;
    opacity: 1;
    margin-top: 8px;
  }
`;

export default observer(Kanban);
