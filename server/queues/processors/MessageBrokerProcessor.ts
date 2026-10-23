import type { Event } from "@server/types";
import { Document, Collection, User } from "@server/models";
import env from "@server/env";
import messageBrokerService from "@server/services/messageBroker";
import BaseProcessor from "./BaseProcessor";
import Logger from "@server/logging/Logger";

/**
 * MessageBrokerProcessor - Publishes events to external message brokers
 *
 * This processor listens to all events (using "*") and publishes them to
 * configured message brokers (RabbitMQ, Kafka, Redis Pub/Sub, etc.) for
 * consumption by external systems.
 *
 * Use case: CQRS architecture where a second application needs to process
 * and store data from Outline events without affecting the main application.
 *
 * Configuration:
 * - MESSAGE_BROKER_ENABLED=true to enable
 * - MESSAGE_BROKER_TYPE=rabbitmq|kafka|redis_pubsub
 * - MESSAGE_BROKER_URL=<connection_url>
 * - MESSAGE_BROKER_EXCHANGE=<exchange_or_topic_name>
 */
export default class MessageBrokerProcessor extends BaseProcessor {
    /**
     * Listen to all events - filtering is done in MessageBrokerService
     */
    static applicableEvents: (Event["name"] | "*")[] = ["*"];

    /**
     * Enrich event with full entity data for CQRS consumers
     */
    private async enrichEventData(event: Event): Promise<Record<string, any>> {
        const enrichedData: Record<string, any> = {};

        // For document events, include full document data
        if (event.name.startsWith("documents.") && "documentId" in event && event.documentId) {
            try {
                const document = await Document.findByPk(event.documentId, {
                    includeState: true, // Include document state/content
                });
                if (document) {
                    enrichedData.document = {
                        id: document.id,
                        title: document.title,
                        text: document.text, // Markdown content
                        urlId: document.urlId,
                        collectionId: document.collectionId,
                        parentDocumentId: document.parentDocumentId,
                        createdById: document.createdById,
                        lastModifiedById: document.lastModifiedById,
                        publishedAt: document.publishedAt,
                        archivedAt: document.archivedAt,
                        deletedAt: document.deletedAt,
                        template: document.template,
                        fullWidth: document.fullWidth,
                        createdAt: document.createdAt,
                        updatedAt: document.updatedAt,
                    };
                }
            } catch (error) {
                // Log but don't fail - event will still be published without enrichment
                Logger.error(`[MessageBroker] Failed to enrich document data:`, error);
            }
        }

        // For collection events, include collection data
        if (event.name.startsWith("collections.") && "collectionId" in event && event.collectionId) {
            try {
                const collection = await Collection.findByPk(event.collectionId);
                if (collection) {
                    enrichedData.collection = {
                        id: collection.id,
                        name: collection.name,
                        description: collection.description,
                        color: collection.color,
                        icon: collection.icon,
                        permission: collection.permission,
                        sharing: collection.sharing,
                        createdAt: collection.createdAt,
                        updatedAt: collection.updatedAt,
                    };
                }
            } catch (error) {
                Logger.error(`[MessageBroker] Failed to enrich collection data:`, error);
            }
        }

        // For user events, include user data (excluding sensitive fields)
        if (event.name.startsWith("users.") && "userId" in event && event.userId) {
            try {
                const user = await User.findByPk(event.userId);
                if (user) {
                    enrichedData.user = {
                        id: user.id,
                        name: user.name,
                        email: user.email,
                        avatarUrl: user.avatarUrl,
                        role: user.role,
                        createdAt: user.createdAt,
                        updatedAt: user.updatedAt,
                        lastActiveAt: user.lastActiveAt,
                        suspendedAt: user.suspendedAt,
                    };
                }
            } catch (error) {
                Logger.error(`[MessageBroker] Failed to enrich user data:`, error);
            }
        }

        return enrichedData;
    }

    /**
     * Perform the event publishing with optional enriched data
     */
    async perform(event: Event): Promise<void> {
        // Only enrich if MESSAGE_BROKER_INCLUDE_DATA is enabled
        // Otherwise, consumer should fetch data via API using the IDs in the event
        const enrichedData = env.MESSAGE_BROKER_INCLUDE_DATA
            ? await this.enrichEventData(event)
            : undefined;

        // The service handles filtering of publishable events internally
        await messageBrokerService.publishEvent(event, enrichedData);
    }

    /**
     * Handle failure - log but don't retry indefinitely for non-critical broker events
     */
    async onFailed(): Promise<void> {
        // Message broker publishing failures shouldn't affect main app functionality
        // The service already logs errors, so we just acknowledge the failure

        return Promise.resolve();
    }
}
