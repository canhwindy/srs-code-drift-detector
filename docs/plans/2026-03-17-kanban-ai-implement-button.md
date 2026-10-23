# Kanban AI-driven Document Operations — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Thêm nút "Implement" vào Kanban card — khi click, AI (Claude CLI) phân tích nội dung card và tự động thực hiện document operation (create/update/delete), sau đó card tự chuyển sang cột "Reviewing".

**Architecture:** Frontend gọi Koa API `kanban.cards.implement` → Koa gọi Python FastAPI `/kanban/implement` → Python gọi `_call_claude_cli_async` → Claude CLI phân tích card → trả về JSON action → Koa thực thi document operation (via existing commands) → move card sang "Reviewing" list.

**Tech Stack:** TypeScript (Koa, Sequelize, React, MobX, Styled Components), Python (FastAPI, Pydantic), Claude CLI, PostgreSQL, Zod schema validation.

---

## Pre-flight Check

Trước khi bắt đầu, xác nhận:
- `PYTHON_BACKEND_URL` đã tồn tại trong `server/env.ts:114` — **SKIP bước env var**
- `backend/rag_state.py` chứa `_call_claude_cli_async` tại dòng 194 — sẽ dùng trực tiếp
- `server/migrations/` có migration kanban mới nhất: `20260312000000-add-related-documents-to-kanban-cards.js`

---

## Task 1: Tạo Claude CLI Skill cho kanban-implement

**Files:**
- Create: `.claude/skills/kanban-implement/SKILL.md`

**Step 1: Tạo thư mục và file skill**

```bash
mkdir -p .claude/skills/kanban-implement
```

**Step 2: Tạo file SKILL.md với nội dung**

```markdown
---
name: kanban-implement
description: Phân tích Kanban card và xác định document operation cần thực hiện (create/update/delete). Luôn dùng skill này khi nhận prompt chứa "[KANBAN IMPLEMENT TASK]".
---

# Kanban Implement Skill

## Nhiệm vụ

Phân tích nội dung Kanban card và xác định:
1. **Action**: create_document, update_document, hoặc delete_document
2. **Document details**: title, content (Markdown), target document ID

## ⚠️ Quy tắc QUAN TRỌNG nhất

**Chỉ trả về JSON. KHÔNG thêm bất kỳ text, giải thích, hay markdown wrapper nào.**

Output phải là JSON thuần, bắt đầu bằng `{` và kết thúc bằng `}`.

## Format output bắt buộc

```json
{
  "action": "create_document",
  "documentTitle": "Tiêu đề document cần tạo",
  "documentContent": "# Nội dung\n\nViết bằng Markdown...",
  "targetDocumentId": null,
  "collectionId": null,
  "reasoning": "Giải thích ngắn tại sao chọn action này"
}
```

## Quy tắc xác định action

### create_document
Dùng khi title/description chứa: "tạo", "viết", "create", "write", "new doc", "tài liệu mới"
- `documentContent`: Sinh nội dung Markdown đầy đủ từ description
- `targetDocumentId`: null

### update_document
Dùng khi chứa: "cập nhật", "update", "sửa", "chỉnh sửa" VÀ có relatedDocuments
- `documentContent`: Nội dung MỚI hoàn chỉnh
- `targetDocumentId`: relatedDocuments[0].id

### delete_document
Dùng khi chứa: "xóa", "delete", "remove" VÀ có relatedDocuments
- `documentContent`: null
- `targetDocumentId`: relatedDocuments[0].id

## Quy tắc viết documentContent

- Viết bằng **Markdown chuẩn**, bắt đầu bằng `# [Tiêu đề]`
- Nội dung phải liên quan trực tiếp đến description trong card
- Viết cùng ngôn ngữ với title/description của card
```

**Step 3: Verify file tồn tại**

```bash
cat .claude/skills/kanban-implement/SKILL.md | head -5
```

Expected: dòng đầu là `---`

**Step 4: Test skill với Claude CLI**

```bash
echo "[KANBAN IMPLEMENT TASK]

Analyze this Kanban card:
Card Title: Tạo tài liệu API Specification
Card Description: Tài liệu cần có endpoints, request/response format

Return ONLY a JSON object." | claude -p
```

Expected: JSON hợp lệ với `"action": "create_document"`

**Step 5: Commit**

```bash
git add .claude/skills/kanban-implement/SKILL.md
git commit -m "feat: add kanban-implement Claude CLI skill"
```

---

## Task 2: Tạo Python backend module `backend/routers/kanban/`

**Files:**
- Create: `backend/routers/kanban/__init__.py`
- Create: `backend/routers/kanban/kanban_implement.py`

### Step 1: Tạo thư mục

```bash
mkdir -p backend/routers/kanban
```

### Step 2: Tạo `backend/routers/kanban/kanban_implement.py`

```python
# backend/routers/kanban/kanban_implement.py

import json
import logging
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.rag_state import _call_claude_cli_async

logger = logging.getLogger(__name__)


class RelatedDocument(BaseModel):
    id: str
    title: str
    url: str


class KanbanImplementRequest(BaseModel):
    card_id: str = Field(..., description="ID của Kanban card")
    card_title: str = Field(..., description="Tiêu đề của card")
    card_description: str | None = Field(None, description="Mô tả chi tiết của card")
    related_documents: list[RelatedDocument] = Field(
        default_factory=list,
        description="Danh sách documents được link vào card",
    )


class KanbanImplementResponse(BaseModel):
    action: Literal["create_document", "update_document", "delete_document"]
    document_title: str
    document_content: str | None = None
    target_document_id: str | None = None
    collection_id: str | None = None
    reasoning: str


router = APIRouter(
    prefix="/kanban",
    tags=["kanban"],
)


def _build_implement_prompt(
    card_title: str,
    card_description: str | None,
    related_documents: list[RelatedDocument],
) -> str:
    docs_section = ""
    if related_documents:
        docs_list = "\n".join(
            f"  - ID: {doc.id}, Title: {doc.title}, URL: {doc.url}"
            for doc in related_documents
        )
        docs_section = f"\nRelated Documents:\n{docs_list}"

    description_section = ""
    if card_description and card_description.strip():
        description_section = f"\nCard Description:\n{card_description}"

    return (
        f"[KANBAN IMPLEMENT TASK]\n\n"
        f"Analyze this Kanban card and determine the document operation to perform:\n\n"
        f"Card Title: {card_title}"
        f"{description_section}"
        f"{docs_section}\n\n"
        f"Return ONLY a JSON object with the required fields."
    )


def _parse_ai_response(response_text: str, card_title: str) -> KanbanImplementResponse:
    text = response_text.strip()

    if "```json" in text:
        start = text.find("```json") + 7
        end = text.find("```", start)
        if end != -1:
            text = text[start:end].strip()
    elif "```" in text:
        start = text.find("```") + 3
        end = text.find("```", start)
        if end != -1:
            text = text[start:end].strip()

    if not text.startswith("{"):
        brace_start = text.find("{")
        if brace_start != -1:
            text = text[brace_start:]

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(
            f"Claude CLI trả về response không phải JSON hợp lệ: {e}\n"
            f"Raw response (100 chars): {response_text[:100]}"
        ) from e

    action = data.get("action")
    if action not in ("create_document", "update_document", "delete_document"):
        raise ValueError(
            f"Action không hợp lệ: {action!r}. "
            f"Phải là: create_document, update_document, hoặc delete_document"
        )

    return KanbanImplementResponse(
        action=action,
        document_title=data.get("documentTitle") or card_title,
        document_content=data.get("documentContent"),
        target_document_id=data.get("targetDocumentId"),
        collection_id=data.get("collectionId"),
        reasoning=data.get("reasoning", "No reasoning provided"),
    )


@router.post(
    "/implement",
    response_model=KanbanImplementResponse,
    summary="AI phân tích Kanban card và xác định document operation",
)
async def implement_kanban_card(
    request: KanbanImplementRequest,
) -> KanbanImplementResponse:
    logger.info(
        f"[KanbanImplement] Analyzing card: id={request.card_id!r}, "
        f"title={request.card_title!r}"
    )

    prompt = _build_implement_prompt(
        card_title=request.card_title,
        card_description=request.card_description,
        related_documents=request.related_documents,
    )

    try:
        raw_response = await _call_claude_cli_async(prompt=prompt)
    except RuntimeError as e:
        logger.error(f"[KanbanImplement] Claude CLI failed: {e}")
        raise HTTPException(
            status_code=503,
            detail=f"Claude CLI không available: {str(e)}",
        ) from e

    logger.debug(
        f"[KanbanImplement] AI raw response (100 chars): {raw_response[:100]!r}"
    )

    try:
        result = _parse_ai_response(raw_response, request.card_title)
    except ValueError as e:
        logger.error(f"[KanbanImplement] Parse failed: {e}")
        raise HTTPException(
            status_code=422,
            detail=f"Không thể phân tích response từ AI: {str(e)}",
        ) from e

    logger.info(
        f"[KanbanImplement] AI decision: action={result.action!r}, "
        f"title={result.document_title!r}"
    )

    return result
```

### Step 3: Tạo `backend/routers/kanban/__init__.py`

```python
# backend/routers/kanban/__init__.py

from .kanban_implement import router as kanban_implement_router

__all__ = ["kanban_implement_router"]
```

### Step 4: Viết unit test cho `_parse_ai_response`

Tạo file `backend/routers/kanban/test_kanban_implement.py`:

```python
# backend/routers/kanban/test_kanban_implement.py

import pytest
from backend.routers.kanban.kanban_implement import (
    _parse_ai_response,
    _build_implement_prompt,
    KanbanImplementResponse,
    RelatedDocument,
)


def test_parse_clean_json():
    raw = '{"action": "create_document", "documentTitle": "Test", "reasoning": "ok"}'
    result = _parse_ai_response(raw, "fallback_title")
    assert result.action == "create_document"
    assert result.document_title == "Test"


def test_parse_json_in_markdown_block():
    raw = '```json\n{"action": "update_document", "documentTitle": "Doc", "targetDocumentId": "abc", "reasoning": "r"}\n```'
    result = _parse_ai_response(raw, "fallback")
    assert result.action == "update_document"
    assert result.target_document_id == "abc"


def test_parse_json_with_extra_text():
    raw = 'Here is the result: {"action": "delete_document", "documentTitle": "Old Doc", "targetDocumentId": "xyz", "reasoning": "r"}'
    result = _parse_ai_response(raw, "fallback")
    assert result.action == "delete_document"


def test_parse_invalid_action_raises():
    raw = '{"action": "unknown_action", "documentTitle": "T", "reasoning": "r"}'
    with pytest.raises(ValueError, match="Action không hợp lệ"):
        _parse_ai_response(raw, "fallback")


def test_parse_invalid_json_raises():
    with pytest.raises(ValueError, match="JSON hợp lệ"):
        _parse_ai_response("not json at all", "fallback")


def test_fallback_title_used_when_missing():
    raw = '{"action": "create_document", "documentTitle": null, "reasoning": "r"}'
    result = _parse_ai_response(raw, "My Fallback Title")
    assert result.document_title == "My Fallback Title"


def test_build_prompt_contains_trigger_prefix():
    prompt = _build_implement_prompt("Card Title", None, [])
    assert "[KANBAN IMPLEMENT TASK]" in prompt
    assert "Card Title: Card Title" in prompt


def test_build_prompt_includes_related_docs():
    docs = [RelatedDocument(id="d1", title="Doc One", url="/doc/1")]
    prompt = _build_implement_prompt("Title", "Description", docs)
    assert "ID: d1" in prompt
    assert "Doc One" in prompt
```

### Step 5: Chạy tests để verify chúng pass

```bash
cd backend && python -m pytest routers/kanban/test_kanban_implement.py -v
```

Expected: `8 passed`

### Step 6: Commit

```bash
git add backend/routers/kanban/
git commit -m "feat: add Python FastAPI endpoint for kanban implement"
```

---

## Task 3: Đăng ký kanban router trong `backend/main.py`

**Files:**
- Modify: `backend/main.py`

### Step 1: Đọc file để xác định vị trí đúng

Tìm dòng `app.include_router(srs_router)` (dòng 123 hiện tại) — thêm import và router registration ngay sau nó.

### Step 2: Thêm import

Trong `backend/main.py`, tìm phần import các router (khoảng dòng 119–123), thêm:

```python
from backend.routers.kanban import kanban_implement_router
```

### Step 3: Đăng ký router

Ngay sau `app.include_router(srs_router)`, thêm:

```python
app.include_router(kanban_implement_router)
```

### Step 4: Verify endpoint được đăng ký

```bash
cd backend && python -c "from main import app; routes = [r.path for r in app.routes]; print([r for r in routes if 'kanban' in r])"
```

Expected: `['/kanban/implement']`

### Step 5: Commit

```bash
git add backend/main.py
git commit -m "feat: register kanban implement router in FastAPI app"
```

---

## Task 4: Tạo Database Migration

**Files:**
- Create: `server/migrations/20260317000000-add-implement-to-kanban-cards.js`

### Step 1: Tạo migration file

```javascript
// server/migrations/20260317000000-add-implement-to-kanban-cards.js
"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("kanban_cards", "implementStatus", {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: "idle",
    });

    await queryInterface.addColumn("kanban_cards", "implementError", {
      type: Sequelize.TEXT,
      allowNull: true,
      defaultValue: null,
    });

    await queryInterface.addColumn("kanban_cards", "implementedDocumentId", {
      type: Sequelize.UUID,
      allowNull: true,
      defaultValue: null,
      references: {
        model: "documents",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("kanban_cards", "implementedDocumentId");
    await queryInterface.removeColumn("kanban_cards", "implementError");
    await queryInterface.removeColumn("kanban_cards", "implementStatus");
  },
};
```

### Step 2: Chạy migration

```bash
yarn db:migrate
```

Expected: `20260317000000-add-implement-to-kanban-cards: migrated`

### Step 3: Verify columns tồn tại trong DB

```bash
yarn db:migrate --check
```

Expected: No pending migrations

### Step 4: Commit

```bash
git add server/migrations/20260317000000-add-implement-to-kanban-cards.js
git commit -m "feat: add implement tracking columns to kanban_cards table"
```

---

## Task 5: Cập nhật Server Model `server/models/KanbanCard.ts`

**Files:**
- Modify: `server/models/KanbanCard.ts`

### Step 1: Đọc file hiện tại để xác định vị trí insert

Tìm field `relatedDocuments` — thêm implement fields ngay sau nó. Tìm association `@BelongsTo(() => KanbanList` — thêm `implementedDocument` association sau phần associations hiện có.

### Step 2: Thêm enum `KanbanImplementStatus` sau enum `KanbanPriority` hiện có

```typescript
export enum KanbanImplementStatus {
  Idle = "idle",
  Running = "running",
  Completed = "completed",
  Failed = "failed",
}
```

### Step 3: Thêm 3 fields vào class `KanbanCard` sau field `relatedDocuments`

```typescript
// ── Implement tracking fields ──────────────────────────────

@Column({
  type: DataTypes.STRING(20),
  defaultValue: KanbanImplementStatus.Idle,
})
implementStatus: string;

@Column(DataTypes.TEXT)
implementError: string | null;

@ForeignKey(() => Document)
@Column(DataTypes.UUID)
implementedDocumentId: string | null;

@BelongsTo(() => Document, "implementedDocumentId")
implementedDocument: Document | null;
```

### Step 4: Thêm import `Document` nếu chưa có

Kiểm tra đầu file xem `import Document from "./Document";` đã có chưa. Nếu chưa, thêm vào cùng chỗ với các model imports.

### Step 5: TypeScript compile check

```bash
npx tsc --noEmit 2>&1 | grep -i "KanbanCard"
```

Expected: no errors liên quan tới KanbanCard.ts

### Step 6: Commit

```bash
git add server/models/KanbanCard.ts
git commit -m "feat: add implement tracking fields to KanbanCard model"
```

---

## Task 6: Cập nhật Schema Validation

**Files:**
- Modify: `server/routes/api/kanban/schema.ts`

### Step 1: Đọc file schema.ts để xem pattern hiện tại

Tìm các exports hiện có (dạng `export const KanbanCards...Schema`).

### Step 2: Thêm schema cho endpoint implement vào CUỐI file

```typescript
// ── Kanban Cards Implement ────────────────────────────────────

export const KanbanCardsImplementSchema = BaseSchema.extend({
  body: z.object({
    id: z.string().uuid(),
  }),
});

export type KanbanCardsImplementReq = z.infer<typeof KanbanCardsImplementSchema>;
```

### Step 3: TypeScript check

```bash
npx tsc --noEmit 2>&1 | grep -i "schema"
```

Expected: no errors

### Step 4: Commit

```bash
git add server/routes/api/kanban/schema.ts
git commit -m "feat: add KanbanCardsImplementSchema for implement endpoint"
```

---

## Task 7: Thêm Koa API Endpoint `kanban.cards.implement`

**Files:**
- Modify: `server/routes/api/kanban.ts`

### Step 1: Đọc file kanban.ts để xác định imports hiện có

Cần biết: imports nào đã có (`Document`, `documentCreator`, `documentUpdater`, `KanbanList`, `KanbanBoard`), và tìm dòng `export default router;` để chèn endpoint trước đó.

### Step 2: Thêm imports còn thiếu vào đầu file

Kiểm tra và thêm nếu chưa có:
```typescript
import documentCreator from "@server/commands/documentCreator";
import documentUpdater from "@server/commands/documentUpdater";
```

Import `T.KanbanCardsImplementSchema` đã được auto-exported qua `import * as T` nếu pattern đó đang dùng.

### Step 3: Thêm endpoint trước dòng `export default router;`

Xem toàn bộ code endpoint từ guide (Bước 7, Phần 7b) — copy y hệt vào file ngay trước `export default router;`.

Key sections của endpoint:
1. Load card với authorization check
2. Prevent concurrent implements (`implementStatus === "running"`)
3. Set `implementStatus = "running"` (optimistic)
4. Fetch Python backend `POST /kanban/implement` (timeout 120s)
5. Execute document operation (`create_document` / `update_document` / `delete_document`)
6. Find or create "Reviewing" list
7. Move card to "Reviewing" list, set `implementStatus = "completed"`
8. Create Event log
9. Return `{ data: presentKanbanCard(card), reviewingListId: ... }`

Helper function `getDocumentCollection` thêm sau endpoint:
```typescript
async function getDocumentCollection(
  documentId: string,
  teamId: string
): Promise<string | null> {
  const doc = await Document.findOne({
    where: { id: documentId, teamId },
    attributes: ["collectionId"],
  });
  return doc?.collectionId ?? null;
}
```

### Step 4: TypeScript compile check

```bash
npx tsc --noEmit 2>&1 | grep -i "kanban.ts"
```

Expected: no errors

### Step 5: Commit

```bash
git add server/routes/api/kanban.ts
git commit -m "feat: add kanban.cards.implement Koa API endpoint"
```

---

## Task 8: Cập nhật Presenter `server/presenters/kanban.ts`

**Files:**
- Modify: `server/presenters/kanban.ts`

### Step 1: Đọc file để tìm function `presentKanbanCard`

### Step 2: Thêm 3 fields vào return object của `presentKanbanCard`

Tìm dòng `relatedDocuments: card.relatedDocuments ?? [],` và thêm ngay sau:

```typescript
implementStatus: card.implementStatus ?? "idle",
implementError: card.implementError ?? null,
implementedDocumentId: card.implementedDocumentId ?? null,
```

### Step 3: TypeScript check

```bash
npx tsc --noEmit 2>&1 | grep -i "presenter"
```

Expected: no errors

### Step 4: Commit

```bash
git add server/presenters/kanban.ts
git commit -m "feat: expose implement fields in kanban card presenter"
```

---

## Task 9: Cập nhật Frontend Model `app/models/KanbanCard.ts`

**Files:**
- Modify: `app/models/KanbanCard.ts`

### Step 1: Đọc file để xác định pattern hiện có

Tìm field `relatedDocuments` — thêm implement fields ngay sau nó.

### Step 2: Thêm 3 MobX observable fields

```typescript
/** Trạng thái AI implement: idle | running | completed | failed */
@Field
@observable
implementStatus: string = "idle";

/** Error message nếu implement failed */
@Field
@observable
implementError: string | null = null;

/** ID của document đã được tạo/update/delete bởi AI */
@Field
@observable
implementedDocumentId: string | null = null;
```

### Step 3: TypeScript check

```bash
npx tsc --noEmit 2>&1 | grep -i "KanbanCard"
```

Expected: no errors

### Step 4: Commit

```bash
git add app/models/KanbanCard.ts
git commit -m "feat: add implement tracking fields to frontend KanbanCard model"
```

---

## Task 10: Thêm `implement()` action vào `KanbanCardsStore.ts`

**Files:**
- Modify: `app/stores/KanbanCardsStore.ts`

### Step 1: Đọc file để xác định vị trí

Tìm cuối class `KanbanCardsStore` (trước dấu `}` đóng class cuối cùng). Xác nhận `runInAction` đã có trong import mobx hay chưa.

### Step 2: Thêm `runInAction` vào import nếu chưa có

Tìm dòng `import { ... } from "mobx";` và thêm `runInAction` nếu thiếu.

### Step 3: Thêm method `implement` vào cuối class

```typescript
@action
implement = async (cardId: string): Promise<void> => {
  const card = this.get(cardId);
  if (!card) {
    return;
  }

  runInAction(() => {
    card.implementStatus = "running";
    card.implementError = null;
  });

  try {
    const res = await client.post("/kanban.cards.implement", { id: cardId });
    invariant(res?.data, "Data should be available");
    this.add(res.data);
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Implement failed";

    runInAction(() => {
      card.implementStatus = "failed";
      card.implementError = errorMessage;
    });

    throw error;
  }
};
```

### Step 4: TypeScript check

```bash
npx tsc --noEmit 2>&1 | grep -i "KanbanCardsStore"
```

Expected: no errors

### Step 5: Commit

```bash
git add app/stores/KanbanCardsStore.ts
git commit -m "feat: add implement() action to KanbanCardsStore"
```

---

## Task 11: Thêm Implement Button vào `app/scenes/Kanban.tsx`

**Files:**
- Modify: `app/scenes/Kanban.tsx`

### Step 1: Đọc file để hiểu cấu trúc

File khoảng 1300 dòng. Cần tìm:
1. Phần styled components cuối file
2. Phần render card (tìm `card.title` hoặc `cardTitle`)
3. Import hiện có (`useStores`, `useToasts`, `observer`, `React`)

### Step 2: Thêm styled components vào cuối phần styled components

```typescript
const ImplementButtonWrapper = styled.div`
  position: absolute;
  bottom: 8px;
  right: 8px;
  opacity: 0;
  transition: opacity 0.15s ease;
  z-index: 10;
`;

const ImplementButton = styled.button<{ $status: string }>`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  border: none;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;

  background-color: ${({ $status, theme }) => {
    if ($status === "completed") return theme.success;
    if ($status === "failed") return theme.danger;
    if ($status === "running") return theme.primary;
    return theme.buttonNeutralBackground;
  }};

  color: ${({ $status, theme }) => {
    if ($status === "idle") return theme.text;
    return "white";
  }};

  &:disabled {
    cursor: not-allowed;
    opacity: 0.7;
  }

  &:hover:not(:disabled) {
    filter: brightness(0.9);
  }
`;

const ImplementStatusBadge = styled.span<{ $status: string }>`
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 10px;

  background-color: ${({ $status, theme }) => {
    if ($status === "completed") return `${theme.success}22`;
    if ($status === "failed") return `${theme.danger}22`;
    if ($status === "running") return `${theme.primary}22`;
    return "transparent";
  }};

  color: ${({ $status, theme }) => {
    if ($status === "completed") return theme.success;
    if ($status === "failed") return theme.danger;
    if ($status === "running") return theme.primary;
    return "transparent";
  }};
`;

const CardWrapper = styled.div`
  position: relative;

  &:hover ${ImplementButtonWrapper} {
    opacity: 1;
  }
`;
```

### Step 3: Thêm `ImplementCardButton` component trước component scene chính

```typescript
interface ImplementCardButtonProps {
  cardId: string;
  implementStatus: string;
  implementError: string | null;
}

const ImplementCardButton = observer(function ImplementCardButton({
  cardId,
  implementStatus,
  implementError,
}: ImplementCardButtonProps) {
  const { kanbanCards } = useStores();
  const { showToast } = useToasts();
  const [isLoading, setIsLoading] = React.useState(false);

  const isRunning = implementStatus === "running" || isLoading;
  const isCompleted = implementStatus === "completed";
  const isFailed = implementStatus === "failed";

  const handleImplementClick = async (
    e: React.MouseEvent<HTMLButtonElement>
  ): Promise<void> => {
    e.stopPropagation();
    e.preventDefault();

    if (isRunning) {
      return;
    }

    setIsLoading(true);

    try {
      await kanbanCards.implement(cardId);
      showToast("Implement thành công! Card đã chuyển sang Reviewing.", {
        type: "success",
      });
    } catch (_err: unknown) {
      showToast("Implement thất bại. Kiểm tra lại nội dung card.", {
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getButtonLabel = (): string => {
    if (isRunning) return "⏳ Đang xử lý...";
    if (isCompleted) return "✓ Implemented";
    if (isFailed) return "✗ Retry";
    return "⚡ Implement";
  };

  return (
    <ImplementButtonWrapper>
      <ImplementButton
        $status={implementStatus}
        onClick={handleImplementClick}
        disabled={isRunning}
        title={
          isFailed && implementError
            ? `Lỗi: ${implementError}`
            : isCompleted
            ? "Click để implement lại"
            : "AI sẽ đọc nội dung card và thực hiện document operation"
        }
      >
        {getButtonLabel()}
      </ImplementButton>
    </ImplementButtonWrapper>
  );
});
```

### Step 4: Wrap card render trong `CardWrapper` và thêm components

Tìm phần render card (nơi `card.title` được hiển thị, thường là `<div key={card.id}` hoặc tương tự). Wrap trong `CardWrapper` và thêm:

```typescript
<CardWrapper key={card.id}>
  {/* Nội dung card hiện có - GIỮ NGUYÊN */}
  <div onClick={handleCardClick}>
    {/* ... tất cả nội dung card hiện tại ... */}

    {card.implementStatus !== "idle" && (
      <ImplementStatusBadge $status={card.implementStatus}>
        {card.implementStatus === "running" && "⏳ AI đang xử lý"}
        {card.implementStatus === "completed" && "✓ Implemented"}
        {card.implementStatus === "failed" && "✗ Failed"}
      </ImplementStatusBadge>
    )}
  </div>

  <ImplementCardButton
    cardId={card.id}
    implementStatus={card.implementStatus}
    implementError={card.implementError ?? null}
  />
</CardWrapper>
```

**Lưu ý:** Adjust theo cấu trúc thực tế của file. Nếu card không dùng `<div>` mà là component khác, wrap tương tự.

### Step 5: Verify imports

Đảm bảo file có các imports:
- `import React from "react";` (hoặc `import * as React`)
- `import { observer } from "mobx-react";`
- `import { useStores } from "~/hooks/useStores";`
- `import useToasts from "~/hooks/useToasts";`

### Step 6: TypeScript + ESLint check

```bash
npx tsc --noEmit 2>&1 | grep -i "Kanban.tsx"
yarn lint app/scenes/Kanban.tsx
```

Expected: 0 errors, 0 warnings

### Step 7: Commit

```bash
git add app/scenes/Kanban.tsx
git commit -m "feat: add Implement button with AI-driven document operations to Kanban cards"
```

---

## Task 12: Final Verification

### Step 1: Full TypeScript compile

```bash
npx tsc --noEmit
```

Expected: `0 errors`

### Step 2: ESLint full check

```bash
yarn lint
```

Expected: `0 errors, 0 warnings`

### Step 3: Run DB migration (nếu chưa chạy)

```bash
yarn db:migrate
```

### Step 4: Manual E2E test

**Test A — Create Document:**
1. Mở Kanban board
2. Tạo card: title = "Tạo tài liệu API Specification cho module Authentication"
3. Hover vào card → nút "⚡ Implement" xuất hiện
4. Click "⚡ Implement"
5. Verify: Card chuyển sang cột "Reviewing" (tự tạo nếu chưa có)
6. Verify: Badge "✓ Implemented" hiển thị
7. Verify: Document mới có trong workspace

**Test B — Error handling:**
1. Tắt Python backend
2. Click Implement trên bất kỳ card nào
3. Verify: Badge "✗ Failed" + toast error hiển thị

**Test C — Concurrent prevent:**
1. Click Implement khi card đang ở trạng thái "running"
2. Verify: Nút disabled, không gửi request thứ 2

### Step 5: Final commit

```bash
git add -A
git commit -m "feat: complete AI-driven document operations for Kanban cards

- Claude CLI skill analyzes card content and returns JSON action
- Python FastAPI endpoint bridges Claude CLI to TypeScript backend
- DB migration adds implementStatus/implementError/implementedDocumentId
- Koa endpoint executes create/update/delete document operations
- Auto-creates 'Reviewing' column when card is implemented
- React component shows Implement button on card hover with status feedback"
```

---

## Checklist tổng

- [ ] Task 1: `.claude/skills/kanban-implement/SKILL.md`
- [ ] Task 2: `backend/routers/kanban/kanban_implement.py` + tests pass
- [ ] Task 3: `backend/main.py` đăng ký router
- [ ] Task 4: DB migration chạy thành công
- [ ] Task 5: `server/models/KanbanCard.ts` có implement fields
- [ ] Task 6: `server/routes/api/kanban/schema.ts` có KanbanCardsImplementSchema
- [ ] Task 7: `server/routes/api/kanban.ts` có endpoint `kanban.cards.implement`
- [ ] Task 8: `server/presenters/kanban.ts` expose implement fields
- [ ] Task 9: `app/models/KanbanCard.ts` có implement observable fields
- [ ] Task 10: `KanbanCardsStore.ts` có `implement()` action
- [ ] Task 11: `Kanban.tsx` có Implement button + status badge
- [ ] Task 12: `npx tsc --noEmit` = 0 errors, `yarn lint` = 0 errors
