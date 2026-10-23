from pydantic import BaseModel
from typing import List


class DeleteDocumentsRequest(BaseModel):
    """
    Request body cho DELETE /api/documents/delete.

    doc_ids: List[str]
        - Danh sách LightRAG doc_id cần xóa
        - Ví dụ: ["doc-d062a9e8ac8c570e401e2b88b147c644"]
        - Frontend lấy từ doc.id — đây ĐÃ là doc_id thực trong KV store
        - KHÔNG phải filename — không cần lookup

    delete_file: bool (default True)
        - True: xóa cả file vật lý trong input_document/
        - False: chỉ xóa khỏi LightRAG storage, giữ file trên disk
    """
    doc_ids: List[str]
    delete_file: bool = True


