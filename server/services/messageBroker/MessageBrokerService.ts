import env from "@server/env";
import Logger from "@server/logging/Logger";
import type { Event } from "@server/types";
import ShutdownHelper, { ShutdownOrder } from "@server/utils/ShutdownHelper";
import type {
    MessageBrokerInterface,
    MessagePayload,
    PublishOptions,
} from "./MessageBrokerInterface";
import { BrokerType, PUBLISHABLE_EVENTS } from "./MessageBrokerInterface";
import KafkaBroker from "./KafkaBroker";
import RabbitMQBroker from "./RabbitMQBroker";
import RedisPubSubBroker from "./RedisPubSubBroker";

/**
 * MessageBrokerService - Singleton service for publishing events to external message brokers
 *
 * This service provides a unified interface for publishing Outline events to various
 * message brokers (RabbitMQ, Kafka, Redis Pub/Sub, etc.) for CQRS-style architecture.
 *
 * Configuration via environment variables:
 * - MESSAGE_BROKER_ENABLED: Enable/disable the message broker (default: false)
 * - MESSAGE_BROKER_TYPE: Type of broker (rabbitmq, kafka, redis_pubsub)
 * - MESSAGE_BROKER_URL: Connection URL for the broker
 * - MESSAGE_BROKER_EXCHANGE: Default exchange/topic name
 * - MESSAGE_BROKER_USERNAME: Username for authentication (optional)
 * - MESSAGE_BROKER_PASSWORD: Password for authentication (optional)
 *
 * Usage:
 * ```typescript
 * import messageBrokerService from "@server/services/messageBroker";
 *
 * // Publish an event
 * await messageBrokerService.publishEvent(event);
 * ```
 */
class MessageBrokerService {
    private static instance: MessageBrokerService;
    private broker: MessageBrokerInterface | null = null;
    private initialized = false;
    private publishableEvents: Set<string>;
    private applicationId: string;
    private messageVersion = "1.0";

    private constructor() {
        this.publishableEvents = new Set(PUBLISHABLE_EVENTS);
        this.applicationId = "outline";
    }

    /**
     * Get the singleton instance of MessageBrokerService
     */
    static getInstance(): MessageBrokerService {
        if (!MessageBrokerService.instance) {
            MessageBrokerService.instance = new MessageBrokerService();
        }
        return MessageBrokerService.instance;
    }

    /**
     * Check if the message broker is enabled via environment configuration
     */
    isEnabled(): boolean {
        return env.MESSAGE_BROKER_ENABLED === true;
    }

    /**
     * Initialize the message broker connection based on configuration
     */
    async initialize(): Promise<void> {
        Logger.info("broker", "Initializing message broker service");
        if (this.initialized) {
            return;
        }

        if (!this.isEnabled()) {
            Logger.info("broker", "Message broker is disabled");
            return;
        }

        const brokerType = (env.MESSAGE_BROKER_TYPE || "redis_pubsub") as BrokerType;
        const brokerUrl = env.MESSAGE_BROKER_URL;
        const exchange = env.MESSAGE_BROKER_EXCHANGE || "outline-events";

        try {
            switch (brokerType) {
                case BrokerType.RABBITMQ:
                    if (!brokerUrl) {
                        throw new Error("MESSAGE_BROKER_URL is required for RabbitMQ");
                    }
                    this.broker = new RabbitMQBroker(
                        {
                            url: brokerUrl,
                            username: env.MESSAGE_BROKER_USERNAME,
                            password: env.MESSAGE_BROKER_PASSWORD,
                        },
                        exchange
                    );
                    break;

                case BrokerType.KAFKA:
                    if (!brokerUrl) {
                        throw new Error("MESSAGE_BROKER_URL is required for Kafka");
                    }
                    this.broker = new KafkaBroker(
                        {
                            url: brokerUrl,
                            username: env.MESSAGE_BROKER_USERNAME,
                            password: env.MESSAGE_BROKER_PASSWORD,
                        },
                        exchange
                    );
                    break;

                case BrokerType.REDIS_PUBSUB:
                default:
                    // Use existing Redis connection
                    this.broker = new RedisPubSubBroker(exchange);
                    break;
            }

            await this.broker.connect();
            this.initialized = true;

            // Register shutdown handler
            ShutdownHelper.add(
                "messageBroker",
                ShutdownOrder.normal,
                async () => {
                    await this.shutdown();
                }
            );

            Logger.info("broker", `Message broker initialized`, {
                type: brokerType,
                exchange,
            });
        } catch (error) {
            Logger.error("Failed to initialize message broker", error);
            // Don't throw - we don't want to break the app if broker is unavailable
            this.broker = null;
        }
    }

    /**
     * Shutdown the message broker connection
     */
    async shutdown(): Promise<void> {
        if (this.broker) {
            await this.broker.disconnect();
            this.broker = null;
            this.initialized = false;
            Logger.info("broker", "Message broker shut down");
        }
    }

    /**
     * Check if an event should be published
     */
    shouldPublishEvent(eventName: string): boolean {
        return this.publishableEvents.has(eventName);
    }

    /**
     * Add custom events to the publishable events list
     */
    addPublishableEvent(eventName: string): void {
        this.publishableEvents.add(eventName);
    }

    /**
     * Remove events from the publishable events list
     */
    removePublishableEvent(eventName: string): void {
        this.publishableEvents.delete(eventName);
    }

    /**
     * Publish an event to the message broker
     * @param event - The Outline event to publish
     * @param enrichedData - Optional enriched data (full document/collection/user data)
     * @param options - Optional publish options
     */
    async publishEvent(
        event: Event,
        enrichedData?: Record<string, any>,
        options?: PublishOptions
    ): Promise<void> {
        if (!this.isEnabled() || !this.broker) {
            return;
        }

        if (!this.shouldPublishEvent(event.name)) {
            Logger.debug("broker", `Skipping non-publishable event: ${event.name}`);
            return;
        }

        const message: MessagePayload = {
            eventName: event.name,
            timestamp: new Date().toISOString(),
            source: this.applicationId,
            version: this.messageVersion,
            event: this.sanitizeEvent(event),
            // Include enriched entity data for CQRS consumers
            ...(enrichedData && Object.keys(enrichedData).length > 0 && { data: enrichedData }),
        };

        try {
            await this.broker.publish(message, {
                routingKey: event.name,
                persistent: true,
                ...options,
            });

            Logger.debug("broker", `Event published: ${event.name}`, {
                teamId: event.teamId,
                actorId: event.actorId,
            });
        } catch (error) {
            Logger.error(`Failed to publish event: ${event.name}`, error, {
                teamId: event.teamId,
            });
            // Don't throw - we don't want to break the app if publishing fails
        }
    }

    /**
     * Publish multiple events in batch
     */
    async publishEvents(events: Event[], options?: PublishOptions): Promise<void> {
        if (!this.isEnabled() || !this.broker) {
            return;
        }

        const messages: MessagePayload[] = events
            .filter((event) => this.shouldPublishEvent(event.name))
            .map((event) => ({
                eventName: event.name,
                timestamp: new Date().toISOString(),
                source: this.applicationId,
                version: this.messageVersion,
                event: this.sanitizeEvent(event),
            }));

        if (messages.length === 0) {
            return;
        }

        try {
            await this.broker.publishBatch(messages, options);
            Logger.debug("broker", `Batch published: ${messages.length} events`);
        } catch (error) {
            Logger.error("Failed to publish event batch", error);
        }
    }

    /**
     * Get health status of the message broker
     */
    async healthCheck(): Promise<{ healthy: boolean; details?: string }> {
        if (!this.isEnabled()) {
            return { healthy: true, details: "Message broker is disabled" };
        }

        if (!this.broker) {
            return { healthy: false, details: "Message broker not initialized" };
        }

        return this.broker.healthCheck();
    }

    /**
     * Sanitize event data before publishing (remove sensitive information)
     */
    private sanitizeEvent(event: Event): Event {
        // Remove potentially sensitive data
        const sanitized = { ...event };

        // Remove IP addresses if privacy is a concern
        // You can customize this based on your needs
        if ("ip" in sanitized && sanitized.ip) {
            (sanitized as { ip: string | null }).ip = null;
        }

        return sanitized;
    }
}

// Export singleton instance
const messageBrokerService = MessageBrokerService.getInstance();
export default messageBrokerService;
export { MessageBrokerService };
