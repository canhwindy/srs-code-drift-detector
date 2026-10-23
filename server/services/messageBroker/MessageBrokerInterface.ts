import type { Event } from "@server/types";

/**
 * Payload structure for document-related events sent to external systems
 */
export interface DocumentEventPayload {
    /** Event type (e.g., documents.create, documents.update) */
    eventType: string;
    /** Timestamp when the event occurred */
    timestamp: string;
    /** Team ID where the document belongs */
    teamId: string;
    /** User ID who triggered the event */
    actorId: string | null;
    /** Document ID */
    documentId: string;
    /** Collection ID where the document belongs */
    collectionId: string | null;
    /** Additional event data */
    data?: Record<string, any>;
    /** Model changes if any */
    changes?: Record<string, any> | null;
}

/**
 * Generic message payload for all events
 */
export interface MessagePayload {
    /** Event name */
    eventName: string;
    /** Event timestamp */
    timestamp: string;
    /** The full event object */
    event: Event;
    /** Source application identifier */
    source: string;
    /** Message version for schema evolution */
    version: string;
    /** Enriched entity data (full document/collection/user data) for CQRS consumers */
    data?: Record<string, any>;
}

/**
 * Connection options for message brokers
 */
export interface BrokerConnectionOptions {
    /** Connection URL or host */
    url: string;
    /** Username for authentication */
    username?: string;
    /** Password for authentication */
    password?: string;
    /** Additional broker-specific options */
    options?: Record<string, any>;
}

/**
 * Message publish options
 */
export interface PublishOptions {
    /** Exchange/Topic name */
    exchange?: string;
    /** Routing key for message routing */
    routingKey?: string;
    /** Message priority (0-9) */
    priority?: number;
    /** Message persistence */
    persistent?: boolean;
    /** Custom headers */
    headers?: Record<string, string>;
    /** Message TTL in milliseconds */
    ttl?: number;
}

/**
 * Interface for message broker implementations
 * Supports RabbitMQ, Kafka, Azure Service Bus, etc.
 */
export interface MessageBrokerInterface {
    /**
     * Connect to the message broker
     */
    connect(): Promise<void>;

    /**
     * Disconnect from the message broker
     */
    disconnect(): Promise<void>;

    /**
     * Check if connected to the broker
     */
    isConnected(): boolean;

    /**
     * Publish a message to the broker
     * @param message - The message payload to publish
     * @param options - Publishing options (exchange, routing key, etc.)
     */
    publish(message: MessagePayload, options?: PublishOptions): Promise<void>;

    /**
     * Publish a batch of messages
     * @param messages - Array of message payloads
     * @param options - Publishing options
     */
    publishBatch(
        messages: MessagePayload[],
        options?: PublishOptions
    ): Promise<void>;

    /**
     * Get broker health status
     */
    healthCheck(): Promise<{ healthy: boolean; details?: string }>;
}

/**
 * Supported message broker types
 */
export enum BrokerType {
    RABBITMQ = "rabbitmq",
    KAFKA = "kafka",
    AZURE_SERVICE_BUS = "azure_service_bus",
    AWS_SQS = "aws_sqs",
    REDIS_PUBSUB = "redis_pubsub",
}

/**
 * Events that should be published to external systems
 */
export const PUBLISHABLE_EVENTS = [
    // Document events
    "documents.create",
    "documents.update",
    "documents.publish",
    "documents.unpublish",
    "documents.archive",
    "documents.unarchive",
    "documents.restore",
    "documents.delete",
    "documents.permanent_delete",
    "documents.move",
    "documents.title_change",
    // Collection events
    "collections.create",
    "collections.update",
    "collections.delete",
    // User events
    "users.create",
    "users.update",
    "users.delete",
    // Comment events
    "comments.create",
    "comments.update",
    "comments.delete",
    // Revision events
    "revisions.create",
] as const;

export type PublishableEvent = (typeof PUBLISHABLE_EVENTS)[number];
