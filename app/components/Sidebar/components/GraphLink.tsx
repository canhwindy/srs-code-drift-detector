import { observer } from "mobx-react";
import { useTranslation } from "react-i18next";

// Import hàm helper trả về "/graph"
import { graphPath } from "~/utils/routeHelpers";

// Import component SidebarLink dùng chung cho mọi mục sidebar
import SidebarLink from "./SidebarLink";

// ============================================================
// SECTION 1: Custom Graph Icon (SVG inline)
// ============================================================

/**
 * GraphIcon - Icon dạng node-graph (mạng lưới nút kết nối)
 * Dùng SVG inline vì outline-icons không có sẵn GraphIcon
 *
 * Mô tả hình vẽ:
 * - 3 hình tròn nhỏ (circles) đại diện cho các node
 * - 2 đường thẳng (lines) nối các node lại với nhau
 */
const GraphIcon = () => (
    <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ display: "block" }}
    >
        {/* Node trung tâm (giữa) */}
        <circle cx="12" cy="12" r="3" />

        {/* Node trên bên trái */}
        <circle cx="4" cy="6" r="2" />

        {/* Node dưới bên phải */}
        <circle cx="20" cy="18" r="2" />

        {/* Đường nối node trung tâm với node trên-trái */}
        <line x1="6" y1="7" x2="10" y2="10" />

        {/* Đường nối node trung tâm với node dưới-phải */}
        <line x1="14" y1="14" x2="18" y2="17" />
    </svg>
);

// ============================================================
// SECTION 2: GraphLink Component
// ============================================================

/**
 * GraphLink - Sidebar navigation item điều hướng đến trang Graph.
 *
 * Hiển thị GraphIcon và label "Graph" trong sidebar.
 * Khi click, React Router điều hướng đến "/graph" (DocumentToGraph scene).
 *
 * Pattern giống ChatLink, HomeLink, KanbanLink.
 */
export const GraphLink = observer(() => {
    // Hook i18n: t() bao label để hỗ trợ đa ngôn ngữ
    const { t } = useTranslation();

    return (
        <SidebarLink
            // to: React Router sẽ điều hướng đến /graph khi click
            to={graphPath()}
            // icon: hiển thị bên trái label
            icon={<GraphIcon />}
            // exact=true: chỉ highlight khi URL khớp chính xác /graph
            exact={true}
            // label: text hiển thị, bọc trong t() để dịch nếu cần
            label={t("Graph")}
        />
    );
});