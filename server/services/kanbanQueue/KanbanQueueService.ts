import env from "@server/env";
import Logger from "@server/logging/Logger";
import { KanbanCard, KanbanList, KanbanBoard, User, Event, Document } from "@server/models";
import ShutdownHelper, { ShutdownOrder } from "@server/utils/ShutdownHelper";

const QUEUE_REQUESTS = "kanban.implement.requests";
const QUEUE_RESULTS = "kanban.implement.results";

const RECONNECT_DELAY_BASE = 5_000;
const RECONNECT_DELAY_MAX = 60_000;

// ─── Payload types ────────────────────────────────────────────────────────────

type KanbanResultPayload = {
  cardId: string;
  userId: string;
  ip: string;
  success: boolean;
  // success=true
  action?: string;
  reasoning?: string;
  documentsToCreate?: Array<{ title: string; content: string; collection_id: string | null }> | null;
  targetDocumentId?: string | null;
  documentChanges?: Array<{
    documentId: string;
    documentTitle: string;
    changesSummary: string[];
    isUserProvided: boolean;
    textEdits?: Array<{ oldString: string; newString: string; description: string }>;
  }> | null;
  deleteDocumentIds?: string[] | null;
  deleteDocumentTitles?: string[] | null;
  // success=false
  error?: string;
};

// ─── Singleton service ────────────────────────────────────────────────────────

export class KanbanQueueService {
  private static instance: KanbanQueueService | null = null;

  private connection: any = null;
  private publishChannel: any = null;
  private reconnecting = false;
  private shuttingDown = false;
  private reconnectDelay = RECONNECT_DELAY_BASE;

  static getInstance(): KanbanQueueService {
    if (!KanbanQueueService.instance) {
      KanbanQueueService.instance = new KanbanQueueService();
    }
    return KanbanQueueService.instance;
  }

  // ─── Connect ───────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    const url = env.MESSAGE_BROKER_URL;
    if (!url) {
      Logger.warn(
        "MESSAGE_BROKER_URL not set — kanban queue disabled"
      );
      return;
    }

    try {
      const amqp = await import("amqplib");
      this.connection = await amqp.connect(url, { heartbeat: 60 });

      this.connection.on("error", (err: Error) => {
        Logger.error("KanbanQueue connection error", err);
      });

      this.connection.on("close", () => {
        if (!this.shuttingDown) {
          Logger.warn("KanbanQueue connection closed — reconnecting…");
          void this.scheduleReconnect();
        }
      });

      this.publishChannel = await this.connection.createChannel();

      // Declare both queues — idempotent, safe on restart
      await this.publishChannel.assertQueue(QUEUE_REQUESTS, { durable: true });
      await this.publishChannel.assertQueue(QUEUE_RESULTS, { durable: true });

      this.reconnectDelay = RECONNECT_DELAY_BASE;
      Logger.info("queue", "KanbanQueue connected to RabbitMQ");
    } catch (err) {
      Logger.error(
        "KanbanQueue failed to connect",
        err instanceof Error ? err : new Error(String(err))
      );
      void this.scheduleReconnect();
    }
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.reconnecting || this.shuttingDown) {
      return;
    }
    this.reconnecting = true;

    Logger.warn(
      `KanbanQueue reconnecting in ${this.reconnectDelay / 1000}s…`
    );
    await new Promise((r) => setTimeout(r, this.reconnectDelay));
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      RECONNECT_DELAY_MAX
    );
    this.reconnecting = false;

    await this.connect();
  }

  async disconnect(): Promise<void> {
    this.shuttingDown = true;
    try {
      if (this.publishChannel) {
        await this.publishChannel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
      Logger.info("queue", "KanbanQueue disconnected");
    } catch (err) {
      Logger.error(
        "KanbanQueue error during disconnect",
        err instanceof Error ? err : new Error(String(err))
      );
    }
  }

  isConnected(): boolean {
    return this.connection !== null && this.publishChannel !== null;
  }

  // ─── Consume results ───────────────────────────────────────────────────────

  async startConsuming(): Promise<void> {
    if (!this.isConnected()) {
      Logger.warn("KanbanQueue not connected — result consumer not started");
      return;
    }

    // Dùng channel riêng để consume, tránh ảnh hưởng publishChannel
    const consumeChannel = await this.connection.createChannel();
    await consumeChannel.assertQueue(QUEUE_RESULTS, { durable: true });
    await consumeChannel.prefetch(5);

    await consumeChannel.consume(
      QUEUE_RESULTS,
      async (msg: any) => {
        if (!msg) {
          return;
        }
        try {
          const payload = JSON.parse(
            msg.content.toString("utf8")
          ) as KanbanResultPayload;

          Logger.info("queue", "KanbanQueue received result", {
            cardId: payload.cardId,
            success: payload.success,
          });

          await handleKanbanResult(payload);
          consumeChannel.ack(msg);
        } catch (err) {
          Logger.error(
            "KanbanQueue error processing result message",
            err instanceof Error ? err : new Error(String(err))
          );
          // nack without requeue — tránh infinite loop
          consumeChannel.nack(msg, false, false);
        }
      },
      { noAck: false }
    );

    Logger.info(
      "queue",
      `KanbanQueue result consumer started — listening on ${QUEUE_RESULTS}`
    );
  }
}

// ─── Result handler ───────────────────────────────────────────────────────────

async function handleKanbanResult(payload: KanbanResultPayload): Promise<void> {
  const card = await KanbanCard.findByPk(payload.cardId, {
    include: [
      { model: User, as: "createdBy" },
      { model: User, as: "members" },
      {
        model: KanbanList,
        as: "list",
        include: [{ model: KanbanBoard, as: "board" }],
      },
    ],
  });

  if (!card) {
    Logger.warn("KanbanQueue card not found for result", {
      cardId: payload.cardId,
    });
    return;
  }

  const teamId = card.list?.board?.teamId;

  if (!payload.success) {
    await card.update({
      implementStatus: "failed",
      implementError: payload.error ?? "AI backend error",
      implementHistory: [
        ...((card as any).implementHistory ?? []),
        {
          at: new Date().toISOString(),
          status: "failed",
          error: payload.error,
          userId: payload.userId,
        },
      ],
    });

    if (teamId) {
      await Event.create({
        name: "kanban_cards.implement.failed",
        modelId: card.id,
        teamId,
        actorId: payload.userId,
        ip: payload.ip,
      });
    }
    return;
  }

  // ── Enrich delete document URLs ──────────────────────────────────────────
  let deleteDocumentUrls: (string | null)[] | undefined;
  const deleteDocumentIds = payload.deleteDocumentIds ?? null;
  const deleteDocumentTitles = payload.deleteDocumentTitles ?? null;

  if (
    payload.action === "delete_document" &&
    deleteDocumentIds &&
    deleteDocumentIds.length > 0
  ) {
    const deleteDocs = await Document.findAll({
      where: { id: deleteDocumentIds },
      attributes: ["id", "title", "urlId"],
    });

    deleteDocumentUrls = deleteDocumentIds.map((id) => {
      const doc = deleteDocs.find((d) => d.id === id);
      if (!doc) {
        return null;
      }
      return Document.getPath({ title: doc.title, urlId: doc.urlId });
    });
  }

  const documentsToCreate = (payload.documentsToCreate ?? []).map((d) => ({
    title: d.title,
    content: d.content,
    collectionId: d.collection_id ?? null,
  }));

  await card.update({
    implementStatus: "preview_ready",
    implementError: null,
    implementPreview: {
      action: (payload.action as any) ?? "none",
      documentsToCreate: documentsToCreate.length > 0 ? documentsToCreate : undefined,
      targetDocumentId: payload.targetDocumentId ?? null,
      collectionId: null,
      reasoning: payload.reasoning ?? "",
      documentChanges: payload.documentChanges ?? null,
      ...(deleteDocumentIds !== null && { deleteDocumentIds }),
      ...(deleteDocumentTitles !== null && { deleteDocumentTitles }),
      ...(deleteDocumentUrls !== undefined && { deleteDocumentUrls }),
    },
  });

  if (!teamId) {
    Logger.warn("KanbanQueue cannot determine teamId", {
      cardId: payload.cardId,
    });
    return;
  }

  await Event.create({
    name: "kanban_cards.implement.preview_ready",
    modelId: card.id,
    teamId,
    actorId: payload.userId,
    ip: payload.ip,
  });

  Logger.info("queue", "KanbanQueue preview_ready emitted", {
    cardId: payload.cardId,
    action: payload.action,
  });
}

// ─── Public starter (called from worker.ts) ───────────────────────────────────

export async function startKanbanResultConsumer(): Promise<void> {
  const service = KanbanQueueService.getInstance();
  await service.connect();
  await service.startConsuming();

  ShutdownHelper.add("kanbanQueue", ShutdownOrder.normal, async () => {
    await service.disconnect();
  });
}
