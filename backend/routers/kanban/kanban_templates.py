import logging
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.kanban_template import KanbanTemplate

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/kanban",
    tags=["kanban-templates"],
)


# ─── Pydantic Schemas ─────────────────────────────────────────────────────────

class TemplateCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    content: str = Field(..., min_length=1)
    user_id: str
    team_id: str


class TemplateUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    content: str = Field(..., min_length=1)


class TemplateResponse(BaseModel):
    id: str
    name: str
    content: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _name_exists(
    db: AsyncSession,
    name: str,
    user_id: str,
    team_id: str,
    exclude_id: str | None = None,
) -> bool:
    stmt = select(KanbanTemplate).where(
        KanbanTemplate.name == name,
        KanbanTemplate.user_id == user_id,
        KanbanTemplate.team_id == team_id,
    )
    if exclude_id:
        stmt = stmt.where(KanbanTemplate.id != exclude_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none() is not None


async def _deactivate_all(db: AsyncSession, user_id: str, team_id: str) -> None:
    await db.execute(
        update(KanbanTemplate)
        .where(
            KanbanTemplate.user_id == user_id,
            KanbanTemplate.team_id == team_id,
        )
        .values(is_active=False)
    )


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get(
    "/templates",
    response_model=list[TemplateResponse],
    summary="Lấy danh sách templates của user trong workspace",
)
async def list_templates(
    user_id: str,
    team_id: str,
    db: AsyncSession = Depends(get_db),
) -> list[TemplateResponse]:
    result = await db.execute(
        select(KanbanTemplate)
        .where(
            KanbanTemplate.user_id == user_id,
            KanbanTemplate.team_id == team_id,
        )
        .order_by(KanbanTemplate.created_at.asc())
    )
    templates = result.scalars().all()
    return [TemplateResponse.model_validate(t) for t in templates]


@router.post(
    "/templates",
    response_model=TemplateResponse,
    status_code=201,
    summary="Tạo template mới (tự động set active)",
)
async def create_template(
    body: TemplateCreate,
    db: AsyncSession = Depends(get_db),
) -> TemplateResponse:
    if await _name_exists(db, body.name, body.user_id, body.team_id):
        raise HTTPException(
            status_code=400,
            detail=f"Template với tên '{body.name}' đã tồn tại.",
        )

    try:
        await _deactivate_all(db, body.user_id, body.team_id)

        template = KanbanTemplate(
            id=str(uuid4()),
            name=body.name,
            content=body.content,
            user_id=body.user_id,
            team_id=body.team_id,
            is_active=True,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(template)
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    await db.refresh(template)
    return TemplateResponse.model_validate(template)


@router.put(
    "/templates/{template_id}",
    response_model=TemplateResponse,
    summary="Cập nhật name/content của template",
)
async def update_template(
    template_id: str,
    body: TemplateUpdate,
    db: AsyncSession = Depends(get_db),
) -> TemplateResponse:
    result = await db.execute(
        select(KanbanTemplate).where(KanbanTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()
    if template is None:
        raise HTTPException(status_code=404, detail="Template không tồn tại.")

    if await _name_exists(db, body.name, template.user_id, template.team_id, exclude_id=template_id):
        raise HTTPException(
            status_code=400,
            detail=f"Template với tên '{body.name}' đã tồn tại.",
        )

    try:
        template.name = body.name
        template.content = body.content
        template.updated_at = datetime.utcnow()
        db.add(template)
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    await db.refresh(template)
    return TemplateResponse.model_validate(template)


@router.delete(
    "/templates/{template_id}",
    status_code=204,
    summary="Xóa template (không cho xóa nếu đang active)",
)
async def delete_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(
        select(KanbanTemplate).where(KanbanTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()
    if template is None:
        raise HTTPException(status_code=404, detail="Template không tồn tại.")

    if template.is_active:
        raise HTTPException(
            status_code=400,
            detail="Không thể xóa template đang được sử dụng. Vui lòng chọn template khác trước.",
        )

    try:
        await db.delete(template)
        await db.commit()
    except Exception:
        await db.rollback()
        raise


@router.post(
    "/templates/{template_id}/select",
    response_model=TemplateResponse,
    summary="Chọn template làm active (deactivate tất cả template khác của user)",
)
async def select_template(
    template_id: str,
    user_id: str,
    team_id: str,
    db: AsyncSession = Depends(get_db),
) -> TemplateResponse:
    result = await db.execute(
        select(KanbanTemplate).where(
            KanbanTemplate.id == template_id,
            KanbanTemplate.user_id == user_id,
            KanbanTemplate.team_id == team_id,
        )
    )
    template = result.scalar_one_or_none()
    if template is None:
        raise HTTPException(status_code=404, detail="Template không tồn tại.")

    try:
        await _deactivate_all(db, user_id, team_id)
        template.is_active = True
        template.updated_at = datetime.utcnow()
        db.add(template)
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    await db.refresh(template)
    return TemplateResponse.model_validate(template)


@router.post(
    "/templates/deselect-active",
    status_code=204,
    summary="Bỏ chọn tất cả templates (quay về system default)",
)
async def deselect_active_template(
    user_id: str,
    team_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    try:
        await _deactivate_all(db, user_id, team_id)
        await db.commit()
    except Exception:
        await db.rollback()
        raise
