import Logger from "@server/logging/Logger";
import Redis from "@server/storage/redis";
import type {
    MessageBrokerInterface,
    MessagePayload,
    PublishOptions,
} from "./MessageBrokerInterface";

/**
 * Redis Pub/Sub Message Broker implementation
 * Uses existing Redis connection from Outline
 * This is the simplest option if you already have Redis configured
 */
export default class RedisPubSubBroker implements MessageBrokerInterface {
    private publisher: typeof Redis.defaultClient | null = null;
    private defaultChannel: string;
    private connected = false;

    constructor(defaultChannel = "outline:events") {
        this.defaultChannel = defaultChannel;
    }

    async connect(): Promise<void> {
        try {
            // Use existing Redis client from Outline
            this.publisher = Redis.defaultClient;
            this.connected = true;

            Logger.info("broker", "Connected to Redis Pub/Sub", {
                channel: this.defaultChannel,
            });
        } catch (error) {
            Logger.error("Failed to connect to Redis Pub/Sub", error);
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        // Don't disconnect since we're using the shared Redis client
        this.connected = false;
        Logger.info("broker", "Disconnected from Redis Pub/Sub");
    }

    isConnected(): boolean {
        return this.connected && this.publisher !== null;
    }

    async publish(message: MessagePayload, options?: PublishOptions): Promise<void> {
        if (!this.isConnected() || !this.publisher) {
            throw new Error("Not connected to Redis");
        }

        // Channel format: outline:events:documents.create or custom channel
        const channel = options?.exchange
            ? `${options.exchange}:${message.eventName}`
            : `${this.defaultChannel}:${message.eventName}`;

        try {
            const messageStr = JSON.stringify({
                ...message,
                headers: options?.headers,
            });

            await this.publisher.publish(channel, messageStr);

            Logger.debug("broker", `Published message to Redis`, {
                channel,
                eventName: message.eventName,
            });
        } catch (error) {
            Logger.error("Failed to publish message to Redis", error, {
                channel,
            });
            throw error;
        }
    }

    async publishBatch(
        messages: MessagePayload[],
        options?: PublishOptions
    ): Promise<void> {
        // Redis pub/sub doesn't have native batch support, so we publish sequentially
        for (const message of messages) {
            await this.publish(message, options);
        }
    }

    async healthCheck(): Promise<{ healthy: boolean; details?: string }> {
        if (!this.isConnected() || !this.publisher) {
            return { healthy: false, details: "Not connected to Redis" };
        }

        try {
            await this.publisher.ping();
            return { healthy: true, details: "Redis connection is healthy" };
        } catch (error) {
            return {
                healthy: false,
                details: `Redis health check failed: ${error}`,
            };
        }
    }
}
