// ============================================================
// FILE: tailwind.config.js
// ACTION: CREATE_NEW
// DESCRIPTION: Cấu hình Tailwind CSS — khai báo content paths
// ============================================================

/** @type {import('tailwindcss').Config} */
module.exports = {
    // Dark mode via class strategy — toggled by PageTheme.ts on <html>
    darkMode: 'class',

    // ============================================================
    // SECTION 1: Content — các file Tailwind sẽ scan để tìm class names
    // ============================================================
    content: [
        // Scan tất cả tsx/ts/jsx/js files trong thư mục app/
        // Dấu ** nghĩa là đệ quy vào tất cả thư mục con
        "./app/**/*.{js,jsx,ts,tsx}",

        // Scan thư mục shared/ — phòng trường hợp shared components dùng Tailwind
        "./shared/**/*.{js,jsx,ts,tsx}",

        // Scan thư mục plugins/ — nếu plugins có UI dùng Tailwind
        "./plugins/**/*.{js,jsx,ts,tsx}",
    ],

    // ============================================================
    // SECTION 2: Theme — tùy chỉnh design tokens (màu, font, spacing...)
    // ============================================================
    theme: {
        // extend: {} — dùng để MỞ RỘNG theme mặc định (không override)
        // Ví dụ: thêm màu brand, font custom, breakpoint custom
        extend: {},
    },

    // ============================================================
    // SECTION 3: Plugins — mở rộng Tailwind với plugin của bên thứ 3
    // ============================================================
    plugins: [
        // Hiện tại chưa cần plugin nào
        // Ví dụ sau này có thể thêm:
        // require('@tailwindcss/typography'),   — cho rich text
        // require('@tailwindcss/forms'),        — cho form elements
        // require('@tailwindcss/line-clamp'),   — giới hạn số dòng text
    ],
};