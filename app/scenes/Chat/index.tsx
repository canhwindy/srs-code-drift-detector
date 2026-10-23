import React from "react";

// Component chính cho trang Chat
// Được render khi user truy cập route /chat
// const Chat: React.FC = () => {
//     return (
//         <div>
//             {/* Tiêu đề chào mừng hiển thị ở phần nội dung chính */}
//             <h1>Happy New Year</h1>
//         </div>
//     );
// };

// export default Chat;

// ============================================================
// FILE: app/scenes/Chat/index.tsx
// ACTION: EDIT_EXISTING — thay toàn bộ nội dung cũ
// DESCRIPTION: Re-export BAChatPage làm default export của scene Chat
// ============================================================

// IMPORT: Lấy BAChatPage từ thư mục con ba-chat/page
// BAChatPage chứa đầy đủ:
//   - NavigationSidebar (menu bên trái)
//   - ChatHistorySidebar (danh sách hội thoại, có collapse)
//   - ChatConversation   (khu vực chat chính, input, messages)
export { default } from "./ba-chat/page";