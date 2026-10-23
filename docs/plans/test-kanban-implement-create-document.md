# Manual Test Case: Kanban Implement — Create Document

## Mục tiêu

Xác minh rằng khi click nút **"⚡ Implement"** trên một Kanban card có title/description mô tả việc tạo tài liệu mới, hệ thống sẽ:
1. Gọi AI (Claude CLI) để phân tích nội dung card
2. Tạo một document mới trong workspace
3. Tự động chuyển card sang cột **"Reviewing"**

---

## Điều kiện tiên quyết

Trước khi test, đảm bảo:

- [ ] Server TypeScript đang chạy: `yarn dev:backend`
- [ ] Frontend đang chạy: `yarn vite:dev`
- [ ] Python backend đang chạy: `cd backend && uvicorn main:app --reload`
- [ ] Database đã migrate: `yarn db:migrate`
- [ ] Đã đăng nhập vào Outline với tài khoản có quyền tạo document

---

## Bước 1 — Tạo Kanban Board

1. Mở trình duyệt tại `http://localhost:3000`
2. Vào **Sidebar → Kanban** (hoặc tìm trang Kanban hiện có)
3. Tạo một board mới (nếu chưa có), ví dụ: **"Test Board"**
4. Board mặc định có sẵn các cột: **"To Do"**, **"In Progress"**, **"Done"**

> ✅ Expected: Board hiển thị với ít nhất 1 cột "To Do"

---

## Bước 2 — Tạo Kanban Card với nội dung "Tạo tài liệu"

1. Trong cột **"To Do"**, click **"+ Add card"** (hoặc nút tương tự)
2. Điền thông tin card:

   **Title:**
   ```
   Tạo tài liệu API Specification cho module Authentication
   ```

   **Description** (nếu form hỗ trợ):
   ```
   Tài liệu cần bao gồm:
   - Tổng quan về Authentication flow (JWT + Refresh Token)
   - Danh sách endpoints: POST /auth/login, POST /auth/logout, POST /auth/refresh
   - Request/Response format với ví dụ JSON
   - Mã lỗi và cách xử lý (401, 403, 422)
   - Hướng dẫn tích hợp cho frontend developer
   ```

3. Lưu card

> ✅ Expected: Card xuất hiện trong cột "To Do" với title đã nhập

---

## Bước 3 — Kích hoạt Implement Button

1. Di chuột (**hover**) lên card vừa tạo
2. Quan sát góc dưới-phải của card

> ✅ Expected: Nút **"⚡ Implement"** xuất hiện (màu neutral, opacity transition in)

3. Click nút **"⚡ Implement"**

> ✅ Expected ngay lập tức:
> - Nút đổi thành **"⏳ Đang xử lý..."** và bị disabled
> - Badge **"⏳ AI đang xử lý"** xuất hiện trong card

---

## Bước 4 — Chờ AI xử lý

AI (Claude CLI) cần khoảng **10–60 giây** để phân tích card và tạo document.

Trong lúc chờ, bạn có thể mở **DevTools → Network** để quan sát:
- Request `POST /api/kanban.cards.implement` → trạng thái `pending`
- Sau đó `200 OK` khi hoàn thành

> ✅ Expected khi hoàn thành:
> - Toast notification: **"Implement thành công! Card đã chuyển sang Reviewing."**
> - Card **biến mất** khỏi cột "To Do"

---

## Bước 5 — Kiểm tra cột "Reviewing"

Nhìn sang phần cuối board (bên phải):

> ✅ Expected:
> - Cột **"Reviewing"** xuất hiện (tự tạo nếu chưa có)
> - Card **"Tạo tài liệu API Specification..."** nằm trong cột "Reviewing"
> - Card hiển thị badge **"✓ Implemented"** (màu xanh lá)

---

## Bước 6 — Kiểm tra Document đã được tạo

1. Vào **Sidebar → Documents** (hoặc trang chủ Workspace)
2. Tìm document mới tạo bởi AI

> ✅ Expected:
> - Có document mới với title tương tự: **"API Specification cho module Authentication"** (hoặc tên AI đặt)
> - Document ở trạng thái **Draft** (chưa publish, để user review)
> - Nội dung document là **Markdown** có cấu trúc:
>   - Heading `# ...`
>   - Các sections: Overview, Endpoints, Request/Response format, Error codes, Integration guide
>   - Nội dung liên quan đến Authentication

---

## Bước 7 — Kiểm tra hover lại sau khi Implemented

1. Hover lên card trong cột "Reviewing"

> ✅ Expected:
> - Nút hiển thị **"✓ Implemented"** (màu xanh lá)
> - Tooltip: **"Click để implement lại"**
> - Có thể click lại để re-implement (tạo document mới)

---

## Kết quả Test

| Bước | Mô tả | Pass/Fail |
|------|-------|-----------|
| 1 | Board hiển thị với cột "To Do" | ☐ |
| 2 | Card tạo thành công | ☐ |
| 3 | Nút "⚡ Implement" hiện khi hover | ☐ |
| 3 | Click → nút đổi thành loading state | ☐ |
| 4 | Toast success xuất hiện | ☐ |
| 5 | Cột "Reviewing" tự tạo | ☐ |
| 5 | Card chuyển sang "Reviewing" | ☐ |
| 5 | Badge "✓ Implemented" hiển thị | ☐ |
| 6 | Document mới được tạo trong workspace | ☐ |
| 6 | Document là Draft với nội dung Markdown | ☐ |
| 7 | Hover lại hiện "✓ Implemented" | ☐ |

---

## Test Case Phụ — Error Handling

### Test Error: Python backend down

1. Tắt Python backend (`Ctrl+C` trong terminal uvicorn)
2. Tạo card mới: **"Tạo tài liệu Testing Guide"**
3. Hover → click **"⚡ Implement"**

> ✅ Expected:
> - Toast error: **"Implement thất bại. Kiểm tra lại nội dung card."**
> - Badge đổi thành **"✗ Failed"** (màu đỏ)
> - Hover lại nút hiện **"✗ Retry"**
> - Tooltip trên nút hiện message lỗi cụ thể

### Test Error: Concurrent prevent

1. Click **"⚡ Implement"** trên một card đang xử lý
2. Ngay khi nút đang **"⏳ Đang xử lý..."**, click lại

> ✅ Expected: Nút disabled, không gửi request thứ 2

---

## Troubleshooting

| Vấn đề | Nguyên nhân | Giải pháp |
|--------|-------------|-----------|
| Nút "⚡ Implement" không xuất hiện khi hover | Frontend chưa rebuild | Restart `yarn vite:dev` |
| Toast error "Claude CLI không available" | Claude CLI chưa cài hoặc không có trong PATH | Chạy `claude --version` để kiểm tra |
| Badge "✗ Failed" với lỗi "Card not found" | DB migration chưa chạy | Chạy `yarn db:migrate` |
| Document không tạo được, lỗi "Collection not found" | Card không có relatedDocuments và không có collection mặc định | Thêm bất kỳ document nào vào `relatedDocuments` của card |
| Python backend lỗi `Import error: rag_state` | Đang chạy từ sai thư mục | Chạy `uvicorn` từ thư mục `backend/` |
