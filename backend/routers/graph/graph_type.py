


# ── Pydantic Request Model ──────────────────────────────────────────────────

from pydantic import BaseModel, Field


class EntityMergeRequest(BaseModel):
    """
    Request body cho endpoint POST /api/graph/entities/merge.

    entities_to_change:    Danh sách tên entities nguồn sẽ bị xóa sau merge.
                           Phải có ít nhất 1 phần tử.
    entity_to_change_into: Tên entity đích nhận toàn bộ relationships.
                           Có thể là entity có sẵn hoặc entity mới (LightRAG tự tạo).
    """
    entities_to_change: list[str] = Field(
        ...,
        min_length=1,
        description="Danh sách entity name nguồn sẽ bị merge và xóa.",
        examples=[["Elon Msk", "Ellon Musk"]],
    )
    entity_to_change_into: str = Field(
        ...,
        min_length=1,
        description="Tên entity đích nhận toàn bộ relationships.",
        examples=["Elon Musk"],
    )


class SemanticDedupRequest(BaseModel):
    """
    Request body cho endpoint POST /api/graph/semantic-dedup.

    threshold:   Cosine similarity threshold cho embedding clustering (0.0-1.0).
    apply_merge: True = thực sự merge entities. False = dry run chỉ xem kết quả.
    """
    threshold: float = Field(
        default=0.9,
        ge=0.0,
        le=1.0,
        description="Cosine similarity threshold cho entity name clustering.",
    )
    apply_merge: bool = Field(
        default=False,
        description="True = apply merges. False = dry run (chỉ xem, không sửa DB).",
    )
