module.exports = {
    // plugins: object chứa danh sách PostCSS plugins
    // Key = tên package, Value = config options (hoặc {} nếu không cần config)
    plugins: {
        // PLUGIN 1: tailwindcss
        // Đọc tailwind.config.js, scan content paths, generate utility CSS
        // @tailwind directives trong CSS file sẽ được replace bởi plugin này
        '@tailwindcss/postcss': {},

        // PLUGIN 2: autoprefixer
        // Đọc browserslist trong package.json ("> 0.25%, not dead")
        // Tự động thêm prefix: -webkit-, -moz-, -ms- cho CSS properties cần thiết
        // Ví dụ: `display: flex` → thêm `display: -webkit-flex` cho Safari cũ
        autoprefixer: {},
    },
};