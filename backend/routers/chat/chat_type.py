from pydantic import BaseModel
from typing import Optional

class CreateConversationRequest(BaseModel):
    """Body cho POST /api/conversations."""
    # title là optional — nếu không truyền, dùng default "New conversation"
    title: Optional[str] = "New conversation"
    # user_id và workspace_id được Node.js proxy forward vào
    user_id: str
    workspace_id: str


class SendMessageRequest(BaseModel):
    """Body cho POST /api/conversations/{id}/messages."""
    content: str
    # user_id và workspace_id được Node.js proxy forward vào để verify ownership
    user_id: str
    workspace_id: str


class RenameConversationRequest(BaseModel):
    """Body cho PATCH /api/conversations/{id} — đổi tên conversation."""
    # title bắt buộc phải có — user phải nhập tên mới
    title: str