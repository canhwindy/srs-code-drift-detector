import Logger from "@server/logging/Logger";
import type {
    MessageBrokerInterface,
    MessagePayload,
    PublishOptions,
    BrokerConnectionOptions,
} from "./MessageBrokerInterface";

/**
 * Apache Kafka Message Broker implementation
 * Uses kafkajs for Kafka protocol
 */
export default class KafkaBroker implements MessageBrokerInterface {
    private kafka: any = null;
    private producer: any = null;
    private options: BrokerConnectionOptions;
    private defaultTopic: string;
    private connected = false;

    constructor(
        options: BrokerConnectionOptions,
        defaultTopic = "outline-events"
    ) {
        this.options = options;
        this.defaultTopic = defaultTopic;
    }

    async connect(): Promise<void> {
        try {
            // Dynamic import to avoid requiring kafkajs if not used
            const { Kafka, logLevel } = await import("kafkajs");

            // Parse brokers from URL (format: kafka://host1:9092,host2:9092)
            const brokers = this.options.url
                .replace("kafka://", "")
                .split(",")
                .map((b) => b.trim());

            this.kafka = new Kafka({
                clientId: "outline-producer",
                brokers,
                logLevel: logLevel.ERROR,
                ...(this.options.options || {}),
                ...(this.options.username && this.options.password
                    ? {
                        sasl: {
                            mechanism: "plain",
                            username: this.options.username,
                            password: this.options.password,
                        },
                    }
                    : {}),
            });

            this.producer = this.kafka.producer({
                allowAutoTopicCreation: true,
                transactionTimeout: 30000,
            });

            await this.producer.connect();
            this.connected = true;

            Logger.info("broker", "Connected to Kafka", {
                brokers,
                topic: this.defaultTopic,
            });
        } catch (error) {
            Logger.error("Failed to connect to Kafka", error);
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        try {
            if (this.producer) {
                await this.producer.disconnect();
            }
            this.connected = false;
            Logger.info("broker", "Disconnected from Kafka");
        } catch (error) {
            Logger.error("Error disconnecting from Kafka", error);
        }
    }

    isConnected(): boolean {
        return this.connected;
    }

    async publish(message: MessagePayload, options?: PublishOptions): Promise<void> {
        if (!this.isConnected()) {
            throw new Error("Not connected to Kafka");
        }

        const topic = options?.exchange || this.defaultTopic;

        // Use event name parts as partition key for ordering (e.g., "documents" from "documents.create")
        const key = message.eventName.split(".")[0];

        try {
            await this.producer.send({
                topic,
                messages: [
                    {
                        key,
                        value: JSON.stringify(message),
                        headers: {
                            eventName: message.eventName,
                            source: message.source,
                            version: message.version,
                            timestamp: message.timestamp,
                            ...options?.headers,
                        },
                    },
                ],
            });

            Logger.debug("broker", `Published message to Kafka`, {
                topic,
                key,
                eventName: message.eventName,
            });
        } catch (error) {
            Logger.error("Failed to publish message to Kafka", error, {
                topic,
                key,
            });
            throw error;
        }
    }

    async publishBatch(
        messages: MessagePayload[],
        options?: PublishOptions
    ): Promise<void> {
        if (!this.isConnected()) {
            throw new Error("Not connected to Kafka");
        }

        const topic = options?.exchange || this.defaultTopic;

        const kafkaMessages = messages.map((message) => ({
            key: message.eventName.split(".")[0],
            value: JSON.stringify(message),
            headers: {
                eventName: message.eventName,
                source: message.source,
                version: message.version,
                timestamp: message.timestamp,
                ...options?.headers,
            },
        }));

        try {
            await this.producer.send({
                topic,
                messages: kafkaMessages,
            });

            Logger.debug("broker", `Published batch to Kafka`, {
                topic,
                count: messages.length,
            });
        } catch (error) {
            Logger.error("Failed to publish batch to Kafka", error, {
                topic,
                count: messages.length,
            });
            throw error;
        }
    }

    async healthCheck(): Promise<{ healthy: boolean; details?: string }> {
        if (!this.isConnected()) {
            return { healthy: false, details: "Not connected to Kafka" };
        }

        try {
            const admin = this.kafka.admin();
            await admin.connect();
            await admin.listTopics();
            await admin.disconnect();
            return { healthy: true, details: "Kafka connection is healthy" };
        } catch (error) {
            return {
                healthy: false,
                details: `Kafka health check failed: ${error}`,
            };
        }
    }
}
