/**
 * Outbox Relay — Poll event_outbox table và publish pending records lên RabbitMQ.
 *
 * Flow:
 *   1. Mỗi POLL_INTERVAL_MS, đọc batch record có status='pending' từ event_outbox
 *   2. Publish payload lên RabbitMQ exchange tương ứng với queue_name
 *   3. Thành công  → status='published', set published_at
 *   4. Thất bại    → retry_count++
 *                  → nếu retry_count >= MAX_RETRIES → status='failed'
 *                  → ngược lại giữ status='pending' cho lần poll tiếp theo
 */

import Logger from "@server/logging/Logger";
import ShutdownHelper, { ShutdownOrder } from "@server/utils/ShutdownHelper";
import EventOutbox from "@server/models/EventOutbox";

const POLL_INTERVAL_MS = parseInt(
  process.env.OUTBOX_RELAY_POLL_INTERVAL_MS ?? "5000"
);
const MAX_RETRIES = parseInt(process.env.OUTBOX_RELAY_MAX_RETRIES ?? "10");
const BATCH_SIZE = parseInt(process.env.OUTBOX_RELAY_BATCH_SIZE ?? "20");

// =============================================================================
// RabbitMQ publish
// =============================================================================

async function _publishToRabbit(
  queueName: string,
  payload: Record<string, unknown>
): Promise<void> {
  const url = process.env.RABBITMQ_URL;
  if (!url) { throw new Error("RABBITMQ_URL not set"); }

  const amqp = await import("amqplib");
  const connection = await amqp.connect(url, { heartbeat: 60 });
  try {
    const channel = (await connection.createChannel()) as any;
    await channel.assertExchange(queueName, "direct", { durable: true });
    await channel.assertQueue(queueName, { durable: true });
    await channel.bindQueue(queueName, queueName, queueName);

    // publishedAt thêm vào đây để consumer biết thời điểm message thực sự
    // được đưa lên queue (khác với createdAt là lúc action xảy ra).
    channel.publish(
      queueName,
      queueName,
      Buffer.from(
        JSON.stringify({ ...payload, publishedAt: new Date().toISOString() })
      ),
      { persistent: true, contentType: "application/json" }
    );
    await channel.close();
  } finally {
    await connection.close();
  }
}

// =============================================================================
// Single poll cycle
// =============================================================================

async function _runOnce(): Promise<void> {
  const records = await EventOutbox.findAll({
    where: { status: "pending" },
    order: [["createdAt", "ASC"]],
    limit: BATCH_SIZE,
  });

  for (const record of records) {
    try {
      // Use .get('payload') to unwrap Sequelize instance wrapper and return
      // the raw JSONB object. Directly reading record.payload sometimes returns
      // a proxy/wrapper that doesn't spread correctly, losing fields on wire.
      const plainPayload = record.get("payload") as Record<string, unknown>;
      Logger.info(
        "task",
        `[OutboxRelay] Publishing id=${record.id} payload keys=${Object.keys(plainPayload || {}).join(",")}`
      );
      await _publishToRabbit(record.queueName, plainPayload);
      await EventOutbox.update(
        { status: "published", publishedAt: new Date() },
        { where: { id: record.id } }
      );
      Logger.info(
        "task",
        `[OutboxRelay] Published id=${record.id} queue=${record.queueName}`
      );
    } catch (err) {
      const newRetryCount = (record.retryCount ?? 0) + 1;
      const newStatus =
        newRetryCount >= MAX_RETRIES ? "failed" : "pending";
      await EventOutbox.update(
        { retryCount: newRetryCount, status: newStatus },
        { where: { id: record.id } }
      );

      if (newStatus === "failed") {
        Logger.error(
          `[OutboxRelay] id=${record.id} queue=${record.queueName} failed after ${MAX_RETRIES} retries`,
          err as Error
        );
      } else {
        Logger.warn(
          `[OutboxRelay] id=${record.id} queue=${record.queueName} ` +
            `retry ${newRetryCount}/${MAX_RETRIES}: ${(err as Error).message}`
        );
      }
    }
  }
}

// =============================================================================
// Poll loop — dùng setTimeout đệ quy thay vì setInterval để tránh overlap
// nếu một cycle chạy lâu hơn POLL_INTERVAL_MS.
// =============================================================================

let _timer: ReturnType<typeof setTimeout> | null = null;

function _schedule(): void {
  _timer = setTimeout(async () => {
    try {
      await _runOnce();
    } catch (err) {
      Logger.error(
        "[OutboxRelay] Unexpected error in poll cycle",
        err as Error
      );
    }
    _schedule();
  }, POLL_INTERVAL_MS);
}

// =============================================================================
// Service entry point
// =============================================================================

export default async function init(): Promise<void> {
  const url = process.env.RABBITMQ_URL;
  if (!url) {
    Logger.info("task", "[OutboxRelay] RABBITMQ_URL not set — relay disabled");
    return;
  }

  Logger.info(
    "task",
    `[OutboxRelay] Started — poll=${POLL_INTERVAL_MS}ms batch=${BATCH_SIZE} maxRetries=${MAX_RETRIES}`
  );
  _schedule();

  ShutdownHelper.add("outboxRelay", ShutdownOrder.normal, async () => {
    if (_timer) {
      clearTimeout(_timer);
      _timer = null;
    }
    Logger.info("task", "[OutboxRelay] Shut down");
  });
}
