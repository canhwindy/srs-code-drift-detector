// Type declarations for optional message broker dependencies
// These packages are only required if using the corresponding broker type

declare module "amqplib" {
    export function connect(
        url: string,
        options?: Record<string, unknown>
    ): Promise<Connection>;

    export interface Connection {
        createChannel(): Promise<Channel>;
        close(): Promise<void>;
        on(event: string, handler: (arg?: unknown) => void): void;
    }

    export interface Channel {
        assertExchange(
            exchange: string,
            type: string,
            options?: Record<string, unknown>
        ): Promise<void>;
        checkExchange(exchange: string): Promise<void>;
        publish(
            exchange: string,
            routingKey: string,
            content: Buffer,
            options?: Record<string, unknown>
        ): boolean;
        close(): Promise<void>;
    }
}

declare module "kafkajs" {
    export class Kafka {
        constructor(config: KafkaConfig);
        producer(config?: ProducerConfig): Producer;
        admin(): Admin;
    }

    export interface KafkaConfig {
        clientId: string;
        brokers: string[];
        logLevel?: number;
        sasl?: {
            mechanism: string;
            username: string;
            password: string;
        };
    }

    export interface ProducerConfig {
        allowAutoTopicCreation?: boolean;
        transactionTimeout?: number;
    }

    export interface Producer {
        connect(): Promise<void>;
        disconnect(): Promise<void>;
        send(record: ProducerRecord): Promise<RecordMetadata[]>;
    }

    export interface ProducerRecord {
        topic: string;
        messages: Message[];
    }

    export interface Message {
        key?: string;
        value: string;
        headers?: Record<string, string>;
    }

    export interface RecordMetadata {
        topicName: string;
        partition: number;
        errorCode: number;
        offset: string;
        timestamp: string;
    }

    export interface Admin {
        connect(): Promise<void>;
        disconnect(): Promise<void>;
        listTopics(): Promise<string[]>;
    }

    export const logLevel: {
        NOTHING: number;
        ERROR: number;
        WARN: number;
        INFO: number;
        DEBUG: number;
    };
}
