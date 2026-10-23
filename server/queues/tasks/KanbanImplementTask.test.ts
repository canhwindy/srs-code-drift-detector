import { KanbanBoard, KanbanCard, KanbanList, EventOutbox } from "@server/models";
import { buildTeam, buildUser } from "@server/test/factories";
import KanbanImplementTask from "./KanbanImplementTask";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type ImpactAnalysis = KanbanCard["impactAnalysis"];

async function buildKanbanCard(overrides: {
  teamId: string;
  createdById: string;
  implementStatus?: string;
  relatedDocuments?: Array<{ id: string; title: string; url: string }>;
  impactAnalysis?: ImpactAnalysis;
}) {
  const board = await KanbanBoard.create({
    name: "Test Board",
    teamId: overrides.teamId,
    createdById: overrides.createdById,
  } as any);

  const list = await KanbanList.create({
    name: "To Do",
    boardId: board.id,
    index: "a",
  } as any);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const card = await KanbanCard.create({
    title: "Test Card",
    listId: list.id,
    index: "a",
    implementStatus: overrides.implementStatus ?? "running",
    relatedDocuments: overrides.relatedDocuments ?? null,
    impactAnalysis: overrides.impactAnalysis ?? null,
    createdById: overrides.createdById,
  } as any);

  return { board, list, card };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("KanbanImplementTask", () => {
  let mockOutboxCreate: jest.SpyInstance;

  beforeEach(() => {
    mockOutboxCreate = jest
      .spyOn(EventOutbox, "create")
      .mockResolvedValue({} as any);
  });

  afterEach(() => {
    mockOutboxCreate.mockRestore();
  });

  it("tạo outbox record đúng payload với card không có related docs", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const { card } = await buildKanbanCard({
      teamId: team.id,
      createdById: user.id,
    });

    const task = new KanbanImplementTask();
    await task.perform({ cardId: card.id, userId: user.id, ip: "127.0.0.1" });

    expect(mockOutboxCreate).toHaveBeenCalledTimes(1);

    const createArg = mockOutboxCreate.mock.calls[0][0];
    expect(createArg.queueName).toBe("kanban.implement.requests");

    const payload = createArg.payload;
    expect(payload.cardId).toBe(card.id);
    expect(payload.userId).toBe(user.id);
    expect(payload.ip).toBe("127.0.0.1");
    expect(payload.cardTitle).toBe("Test Card");
    expect(payload.cardDescription).toBeNull();
    expect(Array.isArray(payload.relatedDocuments)).toBe(true);
    expect(Array.isArray(payload.relatedDocumentsWithContent)).toBe(true);
    expect(Array.isArray(payload.impactAnalysisItems)).toBe(true);
    expect(payload.impactAnalysisItems).toHaveLength(0);
  });

  it("tạo outbox record kèm impactAnalysisItems khi card có impactAnalysis", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const { card } = await buildKanbanCard({
      teamId: team.id,
      createdById: user.id,
      impactAnalysis: {
        hasImpacts: true,
        impacts: [
          {
            affectedDocumentId: null,
            affectedDocumentTitle: "Use Case A",
            description: "Bị ảnh hưởng bởi thay đổi này",
          },
        ],
      },
    });

    const task = new KanbanImplementTask();
    await task.perform({ cardId: card.id, userId: user.id, ip: "127.0.0.1" });

    expect(mockOutboxCreate).toHaveBeenCalledTimes(1);

    const { impactAnalysisItems } = mockOutboxCreate.mock.calls[0][0].payload;
    expect(impactAnalysisItems).toHaveLength(1);
    expect(impactAnalysisItems[0].affected_document_title).toBe("Use Case A");
    expect(impactAnalysisItems[0].description).toBe("Bị ảnh hưởng bởi thay đổi này");
    expect(impactAnalysisItems[0].content).toBeNull();
  });

  it("không tạo outbox record nếu card không ở trạng thái running", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const { card } = await buildKanbanCard({
      teamId: team.id,
      createdById: user.id,
      implementStatus: "preview_ready",
    });

    const task = new KanbanImplementTask();
    await task.perform({ cardId: card.id, userId: user.id, ip: "127.0.0.1" });

    expect(mockOutboxCreate).not.toHaveBeenCalled();
  });

  it("không tạo outbox record nếu card không tồn tại", async () => {
    const task = new KanbanImplementTask();
    await task.perform({
      cardId: "00000000-0000-0000-0000-000000000000",
      userId: "00000000-0000-0000-0000-000000000001",
      ip: "127.0.0.1",
    });

    expect(mockOutboxCreate).not.toHaveBeenCalled();
  });

  it("mark card failed khi EventOutbox.create ném lỗi", async () => {
    mockOutboxCreate.mockRejectedValueOnce(new Error("DB connection lost"));

    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const { card } = await buildKanbanCard({
      teamId: team.id,
      createdById: user.id,
    });

    const task = new KanbanImplementTask();
    await task.perform({ cardId: card.id, userId: user.id, ip: "127.0.0.1" });

    await card.reload();
    expect(card.implementStatus).toBe("failed");
    expect(card.implementError).toContain("DB connection lost");
  });
});
