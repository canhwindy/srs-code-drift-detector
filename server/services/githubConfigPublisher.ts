import Logger from "@server/logging/Logger";
import EventOutbox from "@server/models/EventOutbox";

const QUEUE_NAME = "github_config_events";
const TEAM_QUEUE_NAME = "team_events";

type ConfigEvent = "config.upserted" | "config.deleted";
type TeamEvent = "team.deleted" | "team.suspended" | "team.reactivated";

// _publish() — COMMENTED OUT: replaced by Outbox Pattern.
//
// Lý do: hàm này publish thẳng lên RabbitMQ ngay tại thời điểm action được
// thực thi (tạo/sửa GitHub config, xóa team...). Nếu RabbitMQ tạm thời không
// sẵn sàng, event bị mất hoàn toàn và Python side sẽ không nhận được —
// dẫn đến config không đồng bộ hoặc team đã xóa vẫn còn active trong gap-finding.
//
// Thay vào đó, event được lưu vào bảng event_outbox trong cùng Outline DB.
// outboxRelay.ts chạy ngầm, đọc record pending và publish lên RabbitMQ khi
// sẵn sàng, với cơ chế retry tự động lên đến MAX_RETRIES lần.
//
// async function _publish(
//   exchangeName: string,
//   queueName: string,
//   payload: Record<string, unknown>
// ): Promise<void> {
//   const url = process.env.RABBITMQ_URL;
//   if (!url) {
//     Logger.info("task", "githubConfigPublisher: RABBITMQ_URL not set, skipping");
//     return;
//   }
//   let connection: any;
//   try {
//     const amqp = await import("amqplib");
//     connection = await amqp.connect(url, { heartbeat: 60 });
//     const channel = await connection.createChannel();
//     await channel.assertExchange(exchangeName, "direct", { durable: true });
//     await channel.assertQueue(queueName, { durable: true });
//     await channel.bindQueue(queueName, exchangeName, queueName);
//     channel.publish(
//       exchangeName,
//       queueName,
//       Buffer.from(JSON.stringify({ ...payload, publishedAt: new Date().toISOString() })),
//       { persistent: true, contentType: "application/json" }
//     );
//     await channel.close();
//     await connection.close();
//     Logger.info("task", `githubConfigPublisher: published '${payload.event}' for team ${payload.teamId}`);
//   } catch (err) {
//     Logger.warn(
//       `githubConfigPublisher: failed to publish '${payload.event}'`,
//       { error: (err as Error).message }
//     );
//     try { await connection?.close(); } catch { /* ignore */ }
//   }
// }

async function _saveToOutbox(
  queueName: string,
  payload: Record<string, unknown>
): Promise<void> {
  await EventOutbox.create({
    queueName,
    payload: payload as object,
  } as any);
}

/**
 * Publish full github config payload to gap-finding module queue.
 * The gap-finding module's Content Filter will extract what it needs.
 */
export async function publishGithubConfigEvent(payload: {
  event: ConfigEvent;
  teamId: string;
  apiKey?: string;
  repositories?: unknown[];
  claudeProjectDir?: string | null;
  userId?: string;
}): Promise<void> {
  try {
    await _saveToOutbox(QUEUE_NAME, payload as Record<string, unknown>);
    Logger.info(
      "task",
      `githubConfigPublisher: saved '${payload.event}' for team ${payload.teamId} to outbox`
    );
  } catch (err) {
    Logger.warn("githubConfigPublisher: failed to save config event to outbox", {
      error: (err as Error).message,
    });
  }
}

/**
 * Publish a team lifecycle event to notify the gap-finding module.
 */
export async function publishTeamEvent(payload: {
  event: TeamEvent;
  teamId: string;
}): Promise<void> {
  try {
    await _saveToOutbox(TEAM_QUEUE_NAME, payload as Record<string, unknown>);
    Logger.info(
      "task",
      `githubConfigPublisher: saved team event '${payload.event}' for team ${payload.teamId} to outbox`
    );
  } catch (err) {
    Logger.warn("githubConfigPublisher: failed to save team event to outbox", {
      error: (err as Error).message,
    });
  }
}
