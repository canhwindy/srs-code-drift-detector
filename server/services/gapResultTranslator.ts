/**
 * Message Translator — gap_results queue
 *
 * Converts the wire format published by the Python gap-finding module
 * into the internal GapResultInput type used by gapFindingConsumer.
 *
 * Rule: only this file knows the Python wire format.
 * If Python renames a field, update only this file — the consumer is unaffected.
 */

// =============================================================================
// Wire format — exactly what Python publishes to gap_results queue
// =============================================================================

export interface GapResultMessage {
  pr_id: number;
  team_id?: string;
  repo: string;
  repo_type: string;
  pr_title?: string;
  verdict_summary?: {
    total?: number;
    matching?: number;
    mismatch?: number;
    missing?: number;
  };
  surplus_count?: number;
  error_summary?: string;
  llm_cost_usd?: number;
  run_at?: string;
  source?: string;
  // New structured format
  business_gaps?: WireGap[];
  frontend_gaps?: WireGap[];
  backend_gaps?: WireGap[];
  // Legacy flat format
  test_verdicts?: WireGap[];
  surplus_items?: WireSurplus[];
}

interface WireGap {
  name?: string;
  step_number?: number;
  tag?: string;
  drift_label?: string;
  drift_detail?: string;
  requirement_id?: string;
  requirement_description?: string;
  srs_section?: string;
  error_message?: string;
  assertion_logic?: string;
  tag_reason?: string;
  duration_ms?: number;
  // EAS — SRS side
  srs_actor?: string;
  srs_event?: string;
  srs_action?: string;
  srs_state?: string;
  srs_guard_br?: string;
  // EAS — Code side
  code_actor?: string;
  code_event?: string;
  code_action?: string;
  code_state?: string;
  code_guard?: string;
  // References
  srs_references?: SrsReference[];
  code_references?: CodeReference[];
  // Legacy field used by importPipelineResult path
  test_code?: string;
}

export interface SrsReference {
  quote?: string;
  file_path?: string;
  /** Outline Document UUID resolved by Python from LightRAG chunks. */
  document_id?: string;
  /** SRS-REF block index from the LightRAG prompt (LLM-provided). */
  reference_id?: number | string;
  /** Outline document title — enriched server-side from `document_id`. */
  document_title?: string;
  /** Outline frontend path (e.g. `/doc/{slug}-{urlId}`) — enriched server-side. */
  document_url?: string;
}

export interface CodeReference {
  file_path?: string;
  line?: number;
  snippet?: string;
  repo?: string;
  url?: string;
}

interface WireSurplus {
  id?: string;
  title?: string;
  reason?: string;
  reason_surplus?: string;
  confidence?: string;
  actor?: string;
  event?: string;
  action?: string;
  state?: string;
  guard?: string;
  code_references?: CodeReference[];
}

// =============================================================================
// Internal format — what gapFindingConsumer uses
// =============================================================================

export interface GapResultInput {
  prId: number;
  teamId: string | null;
  repo: string;
  repoType: string;
  prTitle: string;
  verdictSummary: {
    total: number;
    matching: number;
    mismatch: number;
    missing: number;
  };
  surplusCount: number;
  errorSummary: string;
  llmCostUsd: number;
  runAt: string;
  allGaps: GapItem[];
  surplusItems: SurplusItem[];
}

export interface GapItem {
  name: string;
  stepNumber: number | null;
  tag: string;
  driftLabel: string;
  driftDetail: string;
  requirementId: string;
  requirementDescription: string;
  srsSection: string;
  errorMessage: string;
  assertionLogic: string;
  tagReason: string;
  testCode: string | null;
  durationMs: number;
  // EAS — SRS side
  srsActor: string;
  srsEvent: string;
  srsAction: string;
  srsState: string;
  srsGuardBr: string;
  // EAS — Code side
  codeActor: string;
  codeEvent: string;
  codeAction: string;
  codeState: string;
  codeGuard: string;
  // References
  srsReferences: SrsReference[];
  codeReferences: CodeReference[];
}

export interface SurplusItem {
  id: string;
  title: string;
  reason: string;
  confidence: string;
  actor: string;
  event: string;
  action: string;
  state: string;
  guard: string;
  codeReferences: CodeReference[];
}

// =============================================================================
// Translator
// =============================================================================

/** Coalesce trả về giá trị đầu tiên không phải null/undefined/"" (empty string). */
function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const v of values) {
    if (v !== null && v !== undefined && v !== "") { return v; }
  }
  return "";
}

/**
 * Parse and translate a raw queue message into a typed GapResultInput.
 * Throws if required fields (pr_id, repo) are missing.
 */
export function translateGapMessage(raw: unknown): GapResultInput {
  if (!raw || typeof raw !== "object") {
    throw new Error("Gap result message must be a non-null object");
  }

  const msg = raw as GapResultMessage;

  if (!msg.pr_id) {
    throw new Error("Gap result message missing required field: pr_id");
  }
  if (!msg.repo) {
    throw new Error("Gap result message missing required field: repo");
  }

  const businessGaps = msg.business_gaps ?? [];
  const frontendGaps = msg.frontend_gaps ?? [];
  const backendGaps  = msg.backend_gaps  ?? [];

  // Support legacy flat test_verdicts array
  let allWireGaps = [...businessGaps, ...frontendGaps, ...backendGaps];
  if (allWireGaps.length === 0 && msg.test_verdicts?.length) {
    allWireGaps = msg.test_verdicts;
  }

  const allGaps: GapItem[] = allWireGaps.map((v) => ({
    name:                   firstNonEmpty(v.name, v.srs_action, v.code_action),
    stepNumber:             typeof v.step_number === "number" ? v.step_number : null,
    tag:                    v.tag ?? "missing",
    driftLabel:             v.drift_label  ?? "",
    driftDetail:            v.drift_detail ?? "",
    requirementId:          v.requirement_id          ?? "",
    requirementDescription: v.requirement_description ?? "",
    srsSection:             v.srs_section             ?? "",
    errorMessage:           v.error_message           ?? "",
    assertionLogic:         v.assertion_logic         ?? "",
    tagReason:              v.tag_reason              ?? "",
    testCode:               v.test_code               ?? null,
    durationMs:             v.duration_ms             ?? 0,
    // EAS — SRS
    srsActor:    v.srs_actor    ?? "",
    srsEvent:    v.srs_event    ?? "",
    srsAction:   v.srs_action   ?? "",
    srsState:    v.srs_state    ?? "",
    srsGuardBr:  v.srs_guard_br ?? "",
    // EAS — Code
    codeActor:   v.code_actor   ?? "",
    codeEvent:   v.code_event   ?? "",
    codeAction:  v.code_action  ?? "",
    codeState:   v.code_state   ?? "",
    codeGuard:   v.code_guard   ?? "",
    // References
    srsReferences:  Array.isArray(v.srs_references)  ? v.srs_references  : [],
    codeReferences: Array.isArray(v.code_references) ? v.code_references : [],
  }));

  const surplusItems: SurplusItem[] = (msg.surplus_items ?? []).map((s) => ({
    id:             s.id ?? "",
    title:          firstNonEmpty(s.title, s.action, s.id),
    reason:         firstNonEmpty(s.reason_surplus, s.reason),
    confidence:     s.confidence ?? "",
    actor:          s.actor  ?? "",
    event:          s.event  ?? "",
    action:         s.action ?? "",
    state:          s.state  ?? "",
    guard:          s.guard  ?? "",
    codeReferences: Array.isArray(s.code_references) ? s.code_references : [],
  }));

  const vs = msg.verdict_summary ?? {};

  return {
    prId:         msg.pr_id,
    teamId:       msg.team_id ?? null,
    repo:         msg.repo,
    repoType:     msg.repo_type ?? "unknown",
    prTitle:      msg.pr_title ?? "",
    verdictSummary: {
      total:    vs.total    ?? allGaps.length,
      matching: vs.matching ?? 0,
      mismatch: vs.mismatch ?? 0,
      missing:  vs.missing  ?? 0,
    },
    surplusCount: msg.surplus_count ?? surplusItems.length,
    errorSummary: msg.error_summary ?? "",
    llmCostUsd:   msg.llm_cost_usd  ?? 0,
    runAt:        msg.run_at        ?? new Date().toISOString(),
    allGaps,
    surplusItems,
  };
}
