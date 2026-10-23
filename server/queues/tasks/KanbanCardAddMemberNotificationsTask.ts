import { NotificationEventType } from "@shared/types";
import Logger from "@server/logging/Logger";
import { Notification, User, KanbanCard } from "@server/models";
import { BaseTask, TaskPriority } from "./base/BaseTask";

interface KanbanCardAddMemberEvent {
  name: string;
  modelId: string;
  teamId: string;
  actorId: string;
  userId: string;
  cardId: string;
}

/**
 * Task that creates notifications when a user is added to a Kanban card.
 */
export default class KanbanCardAddMemberNotificationsTask extends BaseTask<KanbanCardAddMemberEvent> {
  public async perform(event: KanbanCardAddMemberEvent) {
    const recipient = await User.findByPk(event.userId);
    if (
      !recipient ||
      recipient.isSuspended ||
      !recipient.subscribedToEventType(NotificationEventType.AddUserToKanbanCard)
    ) {
      return;
    }

    // Don't notify if user is adding themselves
    if (event.userId === event.actorId) {
      Logger.debug(
        "task",
        `Suppressing notification for user ${event.userId} as they added themselves to the card`,
        {
          cardId: event.cardId,
          userId: event.userId,
        }
      );
      return;
    }

    const card = await KanbanCard.findByPk(event.cardId);
    if (!card) {
      Logger.warn(`Card not found for notification: ${event.cardId}`);
      return;
    }

    await Notification.create({
      event: NotificationEventType.AddUserToKanbanCard,
      userId: event.userId,
      actorId: event.actorId,
      teamId: event.teamId,
      data: {
        cardId: event.cardId,
        cardTitle: card.title,
      },
    });

    Logger.info(
      "task",
      `Created notification for user ${event.userId} being added to card ${event.cardId}`
    );
  }

  public get options() {
    return {
      priority: TaskPriority.Background,
    };
  }
}
