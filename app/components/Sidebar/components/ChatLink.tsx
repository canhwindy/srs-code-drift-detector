import { observer } from "mobx-react";
import { useTranslation } from "react-i18next";
import { chatPath } from "~/utils/routeHelpers";
import SidebarLink from "./SidebarLink";

// ============================================================
// SECTION 1: Custom Chat Icon (SVG inline)
// ============================================================

// Icon chat dạng bubble (bong bóng hội thoại)
// Dùng SVG inline vì outline-icons có thể không có sẵn ChatIcon
const ChatIcon = () => (
    <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="currentColor"
        style={{ display: "block" }}
    >
        {/*
      Path này vẽ hình bong bóng chat:
      - Hình chữ nhật bo góc phía trên
      - Đuôi nhọn phía dưới bên trái
    */}
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
    </svg>
);


/**
 * ChatLink - Sidebar navigation item cho trang Chat.
 *
 * Hiển thị icon chat và nhãn "Chat" trong sidebar.
 * Khi click, dùng`to` prop của SidebarLink để điều hướng
    * đến đường dẫn `/chat` thông qua React Router.
 *
 * Pattern giống các SidebarLink trực tiếp trong App.tsx
    * (Home, Kanban, BA Agent).
 */
export const ChatLink = observer(() => {
    // Hook lấy hàm dịch i18n (hiện tại chỉ dùng cho label)
    const { t } = useTranslation();

    return (
        <SidebarLink
            // `to` prop: React Router sẽ điều hướng đến /chat khi click
            to={chatPath()}
            // Icon hiển thị bên trái nhãn
            icon={<ChatIcon />}
            // exact=true: chỉ highlight link khi URL khớp chính xác /chat
            exact={true}
            // Label hiển thị — bọc trong t() để hỗ trợ đa ngôn ngữ
            label={t("Chat")}
        />
    );
});