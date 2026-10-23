import Logger from "@server/logging/Logger";
import type {
    MessageBrokerInterface,
    MessagePayload,
    PublishOptions,
    BrokerConnectionOptions,
} from "./MessageBrokerInterface";

/**
 * RabbitMQ Message Broker implementation
 * Uses amqplib for AMQP 0-9-1 protocol
 */
export default class RabbitMQBroker implements MessageBrokerInterface {
    private connection: any = null;
    private channel: any = null;
    private options: BrokerConnectionOptions;
    private defaultExchange: string;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectDelay = 5000;

    constructor(
        options: BrokerConnectionOptions,
        defaultExchange = "outline.events"
    ) {
        this.options = options;
        this.defaultExchange = defaultExchange;
    }

    async connect(): Promise<void> {
        try {
            // Dynamic import to avoid requiring amqplib if not used
            const amqp = await import("amqplib");

            this.connection = await amqp.connect(this.options.url, {
                heartbeat: 60,
                ...this.options.options,
            });

            this.connection.on("error", (err: Error) => {
                Logger.error("RabbitMQ connection error", err);
            });

            this.connection.on("close", () => {
                Logger.warn("RabbitMQ connection closed, attempting reconnect...");
                void this.reconnect();
            });

            this.channel = await this.connection.createChannel();

            // Declare the default exchange (topic exchange for flexible routing)
            await this.channel.assertExchange(this.defaultExchange, "topic", {
                durable: true,
            });

            this.reconnectAttempts = 0;
            Logger.info("broker", "Connected to RabbitMQ", {
                exchange: this.defaultExchange,
            });
        } catch (error) {
            Logger.error("Failed to connect to RabbitMQ", error);
            throw error;
        }
    }

    private async reconnect(): Promise<void> {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            Logger.error(
                "Max reconnect attempts reached for RabbitMQ",
                new Error("Reconnect failed")
            );
            return;
        }

        this.reconnectAttempts++;
        Logger.info(
            "broker",
            `Attempting to reconnect to RabbitMQ (${this.reconnectAttempts}/${this.maxReconnectAttempts})`
        );

        setTimeout(() => {
            void this.connect();
        }, this.reconnectDelay * this.reconnectAttempts);
    }

    async disconnect(): Promise<void> {
        try {
            if (this.channel) {
                await this.channel.close();
            }
            if (this.connection) {
                await this.connection.close();
            }
            Logger.info("broker", "Disconnected from RabbitMQ");
        } catch (error) {
            Logger.error("Error disconnecting from RabbitMQ", error);
        }
    }

    isConnected(): boolean {
        return this.connection !== null && this.channel !== null;
    }

    async publish(message: MessagePayload, options?: PublishOptions): Promise<void> {
        if (!this.isConnected()) {
            throw new Error("Not connected to RabbitMQ");
        }

        const exchange = options?.exchange || this.defaultExchange;
        // Use event name as routing key (e.g., "documents.create" -> "documents.create")
        const routingKey = options?.routingKey || message.eventName;

        const messageBuffer = Buffer.from(JSON.stringify(message));

        const publishOptions = {
            persistent: options?.persistent ?? true,
            contentType: "application/json",
            timestamp: Date.now(),
            headers: {
                eventName: message.eventName,
                source: message.source,
                version: message.version,
                ...options?.headers,
            },
            priority: options?.priority,
            expiration: options?.ttl?.toString(),
        };

        try {
            this.channel.publish(exchange, routingKey, messageBuffer, publishOptions);

            Logger.debug("broker", `Published message to RabbitMQ`, {
                exchange,
                routingKey,
                eventName: message.eventName,
            });
        } catch (error) {
            Logger.error("Failed to publish message to RabbitMQ", error, {
                exchange,
                routingKey,
            });
            throw error;
        }
    }

    async publishBatch(
        messages: MessagePayload[],
        options?: PublishOptions
    ): Promise<void> {
        for (const message of messages) {
            await this.publish(message, options);
        }
    }

    async healthCheck(): Promise<{ healthy: boolean; details?: string }> {
        if (!this.isConnected()) {
            return { healthy: false, details: "Not connected to RabbitMQ" };
        }

        try {
            // Try to check the exchange
            await this.channel.checkExchange(this.defaultExchange);
            return { healthy: true, details: "RabbitMQ connection is healthy" };
        } catch (error) {
            return {
                healthy: false,
                details: `RabbitMQ health check failed: ${error}`,
            };
        }
    }
}
