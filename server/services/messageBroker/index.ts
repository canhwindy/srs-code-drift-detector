/**
 * Message Broker Module
 *
 * This module provides a unified interface for publishing Outline events to
 * external message brokers for CQRS-style architecture and event-driven systems.
 *
 * Supported Brokers:
 * - RabbitMQ (AMQP 0-9-1)
 * - Apache Kafka
 * - Redis Pub/Sub (uses existing Redis connection)
 *
 * Usage:
 * ```typescript
 * import messageBrokerService from "@server/services/messageBroker";
 *
 * // Initialize (called during app startup)
 * await messageBrokerService.initialize();
 *
 * // Publish an event
 * await messageBrokerService.publishEvent(event);
 *
 * // Check health
 * const health = await messageBrokerService.healthCheck();
 * ```
 */

export { default } from "./MessageBrokerService";
export { MessageBrokerService } from "./MessageBrokerService";
export * from "./MessageBrokerInterface";
export { default as RabbitMQBroker } from "./RabbitMQBroker";
export { default as KafkaBroker } from "./KafkaBroker";
export { default as RedisPubSubBroker } from "./RedisPubSubBroker";
