import Logger from "@server/logging/Logger";
import ShutdownHelper, { ShutdownOrder } from "@server/utils/ShutdownHelper";
import Document from "@server/models/Document";
import GapFinding from "@server/models/GapFinding";
import TestResult from "@server/models/TestResult";
import GapDlqAlertEmail from "@server/emails/templates/GapDlqAlertEmail";
import env from "@server/env";
import {
  translateGapMessage,
  type GapResultInput,
  type SrsReference,
} from "./gapResultTranslator";

const QUEUE_NAME = "gap_results";
const EXCHANGE_NAME = "gap_results";
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 30_000;
const DLQ_NAME = "gap_results.dlq";
const DLQ_EXCHANGE = "gap_results.dlx";

let connection: any = null;
let channel: any = null;
let reconnectAttempts = 0;
let isShuttingDown = false;

/**
 * Save a gap result to DB using the typed internal format.
 * Has no knowledge of the Python wire format — that is handled by translateGapMessage.
 */
function repoTypeLabel(repoType: string): string {
  switch (repoType) {
    case "frontend":  return "FE";
    case "backend":   return "BE";
    case "fullstack": return "FS";
    default:          return "??";
  }
}

/**
 * Title hiển thị trên UI cho 1 TestResult row.
 * Ưu tiên: "Step {n}: {action}" → "{action}" → "Step {n}" → "(unnamed)"
 */
function buildRowTitle(v: GapResultInput["allGaps"][number]): string {
  const action = v.name || v.srsAction || v.codeAction;
  const step = v.stepNumber;
  if (step !== null && action) { return `Step ${step}: ${action}`; }
  if (action)                  { return action; }
  if (step !== null)           { return `Step ${step}`; }
  return "(unnamed)";
}

/**
 * Description hiển thị cho 1 TestResult row: giải thích drift thay vì UC name.
 */
function buildRowDescription(v: GapResultInput["allGaps"][number]): string {
  return v.driftDetail || v.tagReason || v.errorMessage || v.requirementDescription || "";
}

/**
 * Mutate srsReferences in-place: resolve document_url + document_title từ Outline
 * Document table dựa vào document_id mà Python đã lookup từ LightRAG chunks.
 *
 * Batch query 1 lần cho toàn bộ message để tránh N+1.
 */
async function enrichSrsReferencesWithDocs(allGaps: GapResultInput["allGaps"]): Promise<void> {
  const docIds = new Set<string>();
  for (const g of allGaps) {
    for (const r of g.srsReferences ?? []) {
      const id = (r as SrsReference).document_id;
      if (id) { docIds.add(id); }
    }
  }
  if (docIds.size === 0) { return; }

  const docs = await Document.findAll({
    where: { id: Array.from(docIds) },
    attributes: ["id", "title", "urlId"],
    paranoid: false,
  });
  const docById = new Map(docs.map((d) => [d.id, d]));

  for (const g of allGaps) {
    for (const r of g.srsReferences ?? []) {
      const ref = r as SrsReference;
      const doc = ref.document_id ? docById.get(ref.document_id) : undefined;
      if (doc) {
        ref.document_title = doc.title;
        ref.document_url = Document.getPath({ title: doc.title, urlId: doc.urlId });
      }
    }
  }
}

async function saveGapResult(input: GapResultInput): Promise<void> {
  const { prId, teamId, repo, repoType, prTitle, verdictSummary, surplusCount,
          errorSummary, llmCostUsd, runAt, allGaps, surplusItems } = input;

  let severity = "Low";
  if (verdictSummary.mismatch > 0) { severity = "High"; }
  else if (verdictSummary.missing > 0 || surplusCount > 0) { severity = "Medium"; }

  const title = `[${repoTypeLabel(repoType)}] PR #${prId} — ${repo}`;

  const descriptionData = {
    pr_id: prId, repo, repo_type: repoType, pr_title: prTitle,
    test_counts: verdictSummary,
    surplus_count: surplusCount,
    error_summary: errorSummary,
    llm_cost_usd: llmCostUsd,
    run_at: runAt,
  };

  // Upsert by title
  const existing = await GapFinding.findAll({
    where: { title },
    order: [["created_at", "DESC"]],
  });

  let gapFinding: GapFinding;
  if (existing.length > 0) {
    gapFinding = existing[0];
    if (existing.length > 1) {
      const oldIds = existing.slice(1).map((g) => g.id);
      await TestResult.destroy({ where: { gapFindingId: oldIds } });
      await GapFinding.destroy({ where: { id: oldIds } });
    }
    await gapFinding.update({
      pullRequestId: String(prId),
      description: JSON.stringify(descriptionData),
      severity,
      teamId: teamId,
    } as any);
    await TestResult.destroy({ where: { gapFindingId: gapFinding.id } });
  } else {
    gapFinding = await GapFinding.create({
      title,
      pullRequestId: String(prId),
      description: JSON.stringify(descriptionData),
      severity,
      status: "pending",
      documentId: null,
      teamId: teamId,
    } as any);
  }

  const tagToCodeToSrs = (tag: string): "match" | "mismatch" | "missing" | "surplus" => {
    if (tag === "matching") { return "match"; }
    if (tag === "mismatch") { return "mismatch"; }
    return "missing";
  };

  // Enrich srs_references với document_url/title trước khi persist.
  // Sai sót ở bước này không nên block consumer — log và tiếp tục.
  try {
    await enrichSrsReferencesWithDocs(allGaps);
  } catch (err) {
    Logger.warn("Gap consumer: enrich srs_references failed", { error: (err as Error).message });
  }

  const verdictRecords = allGaps.map((v) => ({
    gapFindingId:   gapFinding.id,
    title:          buildRowTitle(v),
    description:    buildRowDescription(v),
    codeToSrs:      tagToCodeToSrs(v.tag),
    testCode:       v.testCode,
    stepNumber:     v.stepNumber,
    requirementId:  v.requirementId || null,
    srsSection:     v.srsSection    || null,
    errorMessage:   v.errorMessage  || null,
    tagReason:      v.tagReason     || null,
    assertionLogic: v.assertionLogic || null,
    durationMs:     v.durationMs    || null,
    // EAS — SRS
    srsActor:   v.srsActor   || null,
    srsEvent:   v.srsEvent   || null,
    srsAction:  v.srsAction  || null,
    srsState:   v.srsState   || null,
    srsGuardBr: v.srsGuardBr || null,
    // EAS — Code
    codeActor:  v.codeActor  || null,
    codeEvent:  v.codeEvent  || null,
    codeAction: v.codeAction || null,
    codeState:  v.codeState  || null,
    codeGuard:  v.codeGuard  || null,
    // References
    srsReferences:  v.srsReferences  ?? [],
    codeReferences: v.codeReferences ?? [],
  }));

  const surplusRecords = surplusItems.map((s) => ({
    gapFindingId: gapFinding.id,
    title:        s.title || "(surplus)",
    description:  `[SURPLUS] ${s.reason}${s.confidence ? ` (confidence: ${s.confidence})` : ""}`,
    codeToSrs:    "surplus" as const,
    // Surplus không có SRS side; chỉ có code side (nếu LLM trả về)
    codeActor:    s.actor  || null,
    codeEvent:    s.event  || null,
    codeAction:   s.action || null,
    codeState:    s.state  || null,
    codeGuard:    s.guard  || null,
    codeReferences: s.codeReferences ?? [],
  }));

  await TestResult.bulkCreate([...verdictRecords, ...surplusRecords] as any[]);

  Logger.info("task", "Gap result saved from queue", {
    gapFindingId: gapFinding.id,
    prId,
    repo,
  });
}

async function _publishToRetry(msg: any, retryCount: number, error: Error): Promise<void> {
  const delay = RETRY_BASE_DELAY_MS * retryCount + Math.random() * RETRY_BASE_DELAY_MS * 0.3;
  Logger.info("task", `Gap consumer: retrying in ${Math.round(delay / 1000)}s (attempt ${retryCount}/${MAX_RETRIES})`, { error: error.message });
  await new Promise((resolve) => setTimeout(resolve, delay));
  const headers = { ...(msg.properties.headers || {}), "x-retry-count": retryCount };
  channel.publish(EXCHANGE_NAME, QUEUE_NAME, msg.content, {
    persistent: true,
    headers,
    contentType: "application/json",
  });
}

async function _publishToDlq(msg: any, error: Error): Promise<void> {
  await channel.assertExchange(DLQ_EXCHANGE, "direct", { durable: true });
  await channel.assertQueue(DLQ_NAME, { durable: true });
  await channel.bindQueue(DLQ_NAME, DLQ_EXCHANGE, DLQ_NAME);
  const failedAt = new Date().toISOString();
  const original = JSON.parse(msg.content.toString());
  const dlqPayload = Buffer.from(JSON.stringify({
    original,
    failed_at: failedAt,
    error: error.message,
    retry_count: MAX_RETRIES,
  }));
  channel.publish(DLQ_EXCHANGE, DLQ_NAME, dlqPayload, { persistent: true });
  Logger.warn("Gap consumer: message moved to DLQ after max retries", { error: error.message });

  const alertTo = process.env.DLQ_ALERT_EMAIL ?? env.SMTP_FROM_EMAIL;
  if (alertTo) {
    try {
      await new GapDlqAlertEmail({
        to: alertTo,
        prId: original.pr_id ?? 0,
        repo: original.repo ?? "",
        prTitle: original.pr_title ?? "",
        error: error.message,
        failedAt,
        retryCount: MAX_RETRIES,
      }).send();
    } catch (emailErr) {
      Logger.warn("Gap consumer: failed to send DLQ alert email", { error: (emailErr as Error).message });
    }
  }
}

async function connect(url: string): Promise<void> {
  const amqp = await import("amqplib");
  connection = await amqp.connect(url, { heartbeat: 60 });

  connection.on("error", (err: Error) => {
    Logger.error("Gap findings consumer: RabbitMQ connection error", err);
  });

  connection.on("close", () => {
    if (!isShuttingDown) {
      Logger.warn("Gap findings consumer: connection closed, reconnecting...");
      void scheduleReconnect(url);
    }
  });

  channel = await connection.createChannel();
  await channel.assertExchange(EXCHANGE_NAME, "direct", { durable: true });
  await channel.assertQueue(QUEUE_NAME, { durable: true });
  await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, QUEUE_NAME);
  channel.prefetch(1);

  await channel.consume(QUEUE_NAME, async (msg: any) => {
    if (!msg) { return; }
    try {
      const raw = JSON.parse(msg.content.toString());
      const input = translateGapMessage(raw);
      await saveGapResult(input);
      channel.ack(msg);
    } catch (err) {
      const error = err as Error;
      const retryCount = (msg.properties.headers?.["x-retry-count"] ?? 0) + 1;
      Logger.error("Gap findings consumer: failed to process message", error);
      channel.ack(msg); // ack trước để tránh requeue tự động
      if (retryCount <= MAX_RETRIES) {
        await _publishToRetry(msg, retryCount, error);
      } else {
        await _publishToDlq(msg, error);
      }
    }
  });

  reconnectAttempts = 0;
  Logger.info("task", `Gap findings consumer started on queue "${QUEUE_NAME}"`);
}

async function scheduleReconnect(url: string): Promise<void> {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    Logger.error(
      "Gap findings consumer: max reconnect attempts reached",
      new Error("Reconnect failed")
    );
    return;
  }
  reconnectAttempts++;
  const delay = RECONNECT_DELAY_MS * reconnectAttempts;
  Logger.info("task", `Gap findings consumer: reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
  setTimeout(() => { void connect(url); }, delay);
}

export default async function init(): Promise<void> {
  const url = process.env.RABBITMQ_URL;
  if (!url) {
    Logger.info("task", "Gap findings consumer: RABBITMQ_URL not set, skipping");
    return;
  }

  try {
    await connect(url);
  } catch (err) {
    Logger.error("Gap findings consumer: initial connection failed", err as Error);
    void scheduleReconnect(url);
  }

  ShutdownHelper.add("gapFindingConsumer", ShutdownOrder.normal, async () => {
    isShuttingDown = true;
    try {
      if (channel) { await channel.close(); }
      if (connection) { await connection.close(); }
      Logger.info("task", "Gap findings consumer shut down");
    } catch (err) {
      Logger.error("Gap findings consumer: error during shutdown", err as Error);
    }
  });
}
