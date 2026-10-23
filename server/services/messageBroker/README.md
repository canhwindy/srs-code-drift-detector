# Message Broker - CQRS Event Publishing

This module provides event-driven architecture capabilities for Outline, allowing you to publish events to external message brokers for consumption by other applications.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      OUTLINE APPLICATION                         │
│                                                                  │
│  ┌──────────┐    ┌──────────────┐    ┌─────────────────────────┐│
│  │ Document │───▶│    Event     │───▶│   Message Broker        ││
│  │  Create  │    │   (Redis)    │    │    Processor            ││
│  └──────────┘    └──────────────┘    └───────────┬─────────────┘│
│                                                   │              │
└───────────────────────────────────────────────────┼──────────────┘
                                                    │
                        ┌───────────────────────────▼───────────────┐
                        │          MESSAGE BROKER                    │
                        │  (RabbitMQ / Kafka / Redis Pub/Sub)       │
                        └───────────────────────────┬───────────────┘
                                                    │
                        ┌───────────────────────────▼───────────────┐
                        │      SECOND APPLICATION (YOUR APP)        │
                        │                                           │
                        │  - Consumes events from broker            │
                        │  - Processes and stores in own DB         │
                        │  - Completely independent from Outline    │
                        └───────────────────────────────────────────┘
```

## Configuration

Add the following environment variables to your `.env` file:

```bash
# Enable message broker
MESSAGE_BROKER_ENABLED=true

# Broker type: rabbitmq, kafka, or redis_pubsub
MESSAGE_BROKER_TYPE=rabbitmq

# Connection URL (not needed for redis_pubsub)
MESSAGE_BROKER_URL=amqp://user:password@localhost:5672

# Exchange/Topic name (default: outline-events)
MESSAGE_BROKER_EXCHANGE=outline-events

# Optional authentication
MESSAGE_BROKER_USERNAME=myuser
MESSAGE_BROKER_PASSWORD=mypassword
```

## Supported Brokers

### 1. RabbitMQ (Recommended for most use cases)

```bash
MESSAGE_BROKER_ENABLED=true
MESSAGE_BROKER_TYPE=rabbitmq
MESSAGE_BROKER_URL=amqp://user:password@localhost:5672
MESSAGE_BROKER_EXCHANGE=outline.events
```

**Required npm package:** `amqplib`

```bash
npm install amqplib
# or
yarn add amqplib
```

### 2. Apache Kafka (For high-throughput scenarios)

```bash
MESSAGE_BROKER_ENABLED=true
MESSAGE_BROKER_TYPE=kafka
MESSAGE_BROKER_URL=kafka://localhost:9092,localhost:9093
MESSAGE_BROKER_EXCHANGE=outline-events
```

**Required npm package:** `kafkajs`

```bash
npm install kafkajs
# or
yarn add kafkajs
```

### 3. Redis Pub/Sub (Simplest option)

```bash
MESSAGE_BROKER_ENABLED=true
MESSAGE_BROKER_TYPE=redis_pubsub
MESSAGE_BROKER_EXCHANGE=outline:events
```

No additional packages needed - uses existing Redis connection.

## Published Events

The following events are published to the message broker:

### Document Events
- `documents.create` - New document created
- `documents.update` - Document updated
- `documents.publish` - Document published
- `documents.unpublish` - Document unpublished
- `documents.archive` - Document archived
- `documents.unarchive` - Document unarchived
- `documents.restore` - Document restored
- `documents.delete` - Document deleted
- `documents.permanent_delete` - Document permanently deleted
- `documents.move` - Document moved
- `documents.title_change` - Document title changed

### Collection Events
- `collections.create` - Collection created
- `collections.update` - Collection updated
- `collections.delete` - Collection deleted

### User Events
- `users.create` - User created
- `users.update` - User updated
- `users.delete` - User deleted

### Comment Events
- `comments.create` - Comment created
- `comments.update` - Comment updated
- `comments.delete` - Comment deleted

### Revision Events
- `revisions.create` - Revision created

## Message Format

All messages follow this structure:

```json
{
  "eventName": "documents.create",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "source": "outline",
  "version": "1.0",
  "event": {
    "name": "documents.create",
    "teamId": "team-uuid",
    "actorId": "user-uuid",
    "documentId": "document-uuid",
    "collectionId": "collection-uuid",
    "data": { ... },
    "changes": { ... }
  }
}
```

## Consuming Events (Second Application)

### RabbitMQ Consumer Example (Node.js)

```javascript
const amqp = require('amqplib');

async function consumeEvents() {
  const connection = await amqp.connect('amqp://localhost:5672');
  const channel = await connection.createChannel();
  
  const exchange = 'outline.events';
  const queue = 'my-app-queue';
  
  // Bind to specific events
  await channel.assertExchange(exchange, 'topic', { durable: true });
  await channel.assertQueue(queue, { durable: true });
  
  // Listen to all document events
  await channel.bindQueue(queue, exchange, 'documents.*');
  
  // Or specific events
  // await channel.bindQueue(queue, exchange, 'documents.create');
  
  channel.consume(queue, (msg) => {
    const event = JSON.parse(msg.content.toString());
    console.log('Received event:', event.eventName);
    
    // Process and store in your database
    processEvent(event);
    
    channel.ack(msg);
  });
}

async function processEvent(event) {
  // Store in your own database
  switch (event.eventName) {
    case 'documents.create':
      await saveDocumentToMyDB(event.event);
      break;
    case 'documents.update':
      await updateDocumentInMyDB(event.event);
      break;
    // ... handle other events
  }
}
```

### Kafka Consumer Example (Node.js)

```javascript
const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'my-app',
  brokers: ['localhost:9092']
});

const consumer = kafka.consumer({ groupId: 'my-app-group' });

async function consumeEvents() {
  await consumer.connect();
  await consumer.subscribe({ topic: 'outline-events', fromBeginning: true });
  
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const event = JSON.parse(message.value.toString());
      console.log('Received event:', event.eventName);
      
      await processEvent(event);
    },
  });
}
```

### Redis Pub/Sub Consumer Example (Node.js)

```javascript
const Redis = require('ioredis');

const redis = new Redis('redis://localhost:6379');

async function consumeEvents() {
  // Subscribe to all document events
  await redis.psubscribe('outline:events:documents.*');
  
  redis.on('pmessage', (pattern, channel, message) => {
    const event = JSON.parse(message);
    console.log('Received event:', event.eventName);
    
    processEvent(event);
  });
}
```

## Adding Custom Events

You can programmatically add or remove events from the publishable list:

```typescript
import messageBrokerService from "@server/services/messageBroker";

// Add custom event
messageBrokerService.addPublishableEvent("custom.event");

// Remove event
messageBrokerService.removePublishableEvent("documents.update");
```

## Health Check

Check the message broker connection status:

```typescript
const health = await messageBrokerService.healthCheck();
console.log(health);
// { healthy: true, details: "RabbitMQ connection is healthy" }
```

## Docker Compose Example

```yaml
version: '3.8'

services:
  outline:
    image: outlinewiki/outline
    environment:
      MESSAGE_BROKER_ENABLED: 'true'
      MESSAGE_BROKER_TYPE: 'rabbitmq'
      MESSAGE_BROKER_URL: 'amqp://user:password@rabbitmq:5672'
      MESSAGE_BROKER_EXCHANGE: 'outline.events'
    depends_on:
      - rabbitmq
  
  rabbitmq:
    image: rabbitmq:3-management
    ports:
      - "5672:5672"
      - "15672:15672"
    environment:
      RABBITMQ_DEFAULT_USER: user
      RABBITMQ_DEFAULT_PASS: password
  
  # Your second application
  my-app:
    image: my-consumer-app
    environment:
      RABBITMQ_URL: 'amqp://user:password@rabbitmq:5672'
    depends_on:
      - rabbitmq
```

## Best Practices

1. **Idempotency**: Design your consumer to handle duplicate messages
2. **Error Handling**: Implement dead-letter queues for failed messages
3. **Monitoring**: Monitor queue depth and consumer lag
4. **Schema Evolution**: Use the `version` field for backward compatibility
5. **Filtering**: Subscribe only to events you need to minimize load

## Troubleshooting

### Events not being published
1. Check `MESSAGE_BROKER_ENABLED=true` is set
2. Verify connection URL is correct
3. Check worker logs for connection errors

### Consumer not receiving messages
1. Verify queue bindings are correct
2. Check routing keys match event names
3. Ensure consumer is acknowledging messages

### High latency
1. Consider using Kafka for high-throughput scenarios
2. Increase consumer parallelism
3. Optimize message processing in consumer
