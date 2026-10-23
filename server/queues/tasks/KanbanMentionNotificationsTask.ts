import { NotificationEventType } from "@shared/types";
import Logger from "@server/logging/Logger";
import { Notification, User, KanbanCard } from "@server/models";
import { BaseTask, TaskPriority } from "./base/BaseTask";

interface KanbanMentionEvent {
  name: string;
  modelId: string;
  teamId: string;
  actorId: string;
  mentionedUserIds: string[];
  cardId: string;
  commentId?: string;
  content: string;
}

/**
 * Task that creates notifications when users are mentioned in Kanban comments or descriptions.
 */
export default class KanbanMentionNotificationsTask extends BaseTask<KanbanMentionEvent> {
  public async perform(event: KanbanMentionEvent) {
    const card = await KanbanCard.findByPk(event.cardId);
    if (!card) {
      Logger.warn(`Card not found for mention notification: ${event.cardId}`);
      return;
    }

    for (const userId of event.mentionedUserIds) {
      // Don't notify if user mentions themselves
      if (userId === event.actorId) {
        continue;
      }

      const recipient = await User.findByPk(userId);
      if (
        !recipient ||
        recipient.isSuspended ||
        !recipient.subscribedToEventType(NotificationEventType.MentionedInKanbanComment)
      ) {
        continue;
      }

      await Notification.create({
        event: NotificationEventType.MentionedInKanbanComment,
        userId,
        actorId: event.actorId,
        teamId: event.teamId,
        data: {
          cardId: event.cardId,
          cardTitle: card.title,
          contentPreview: event.content.substring(0, 255), // Truncate for preview
        },
      });

      Logger.info(
        "task",
        `Created mention notification for user ${userId} in card ${event.cardId}`
      );
    }
  }

  public get options() {
    return {
      priority: TaskPriority.Background,
    };
  }
}
