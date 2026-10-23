// import { readFile, mkdir } from "fs/promises";
// import path from "path";

// import Router from "koa-router";

// import auth from "@server/middlewares/authentication";
// import type { APIContext } from "@server/types";


// import { CompositeDuplicateChecker } from "@shared/documentUpload/checkers/CompositeDuplicateChecker";
// import { ContentDuplicateChecker } from "@shared/documentUpload/checkers/ContentDuplicateChecker";
// import { FilenameDuplicateChecker } from "@shared/documentUpload/checkers/FilenameDuplicateChecker";
// import { LocalFileStorage } from "@shared/documentUpload/storage/LocalFileStorage";
// import type { UploadResult } from "@shared/documentUpload/types";
// import { FileValidator } from "@shared/documentUpload/validators/FileValidator";
// import {
//     ALLOWED_FILE_EXTENSIONS,
//     MAX_FILE_SIZE,
// } from "@shared/documentUpload/constants";


// // ============================================================
// // CONSTANTS: Thư mục lưu file upload
// // process.cwd() trả về thư mục gốc của project khi chạy Node
// // ============================================================
// const UPLOAD_DIR = path.join(process.cwd(), "input_document");

// // ============================================================
// // VALIDATOR: Khởi tạo một lần, tái sử dụng cho mọi request
// // Dùng constants dùng chung với frontend để đảm bảo nhất quán
// // ============================================================
// const validator = new FileValidator({
//     maxFileSize: MAX_FILE_SIZE,
//     allowedExtensions: [...ALLOWED_FILE_EXTENSIONS],
// });


// // Khởi tạo Koa Router theo pattern chuẩn của dự án
// const router = new Router();


// router.post(
//     // ROUTE NAME: "upload-document" → URL thực tế là /api/upload-document
//     // (vì router này được mount tại "/" trong api/index.ts)
//     "upload-document",

//     // MIDDLEWARE: Yêu cầu người dùng đã đăng nhập
//     auth(),

//     // HANDLER: Xử lý upload
//     async (ctx: APIContext) => {
//         // BƯỚC 1: Lấy files từ request
//         // koa-body (formidable) parse multipart form và đặt files vào ctx.request.files
//         const files = ctx.request.files;

//         if (!files || Object.keys(files).length === 0) {
//             // Trả 400 nếu không có file nào được gửi lên
//             ctx.status = 400;
//             ctx.body = { error: "No files provided" };
//             return;
//         }

//         // BƯỚC 2: Đảm bảo thư mục upload tồn tại
//         // { recursive: true } không throw error nếu thư mục đã tồn tại
//         await mkdir(UPLOAD_DIR, { recursive: true });

//         // BƯỚC 3: Thu thập tất cả file objects từ request
//         // Object.values(files).flat() xử lý cả trường hợp một field
//         // chứa một file (File) hoặc nhiều file (File[])
//         const fileList = Object.values(files).flat();

//         // BƯỚC 4: Khởi tạo storage và duplicate checker cho request này
//         const storage = new LocalFileStorage(UPLOAD_DIR);
//         const duplicateChecker = new CompositeDuplicateChecker([
//             // Kiểm tra trùng tên file trước (nhanh hơn)
//             new FilenameDuplicateChecker(UPLOAD_DIR),
//             // Nếu tên khác nhau nhưng nội dung giống nhau, vẫn reject
//             new ContentDuplicateChecker(UPLOAD_DIR),
//         ]);

//         // BƯỚC 5: Xử lý từng file tuần tự
//         const results: UploadResult[] = [];

//         for (const file of fileList) {
//             // Lấy tên file gốc (formidable v3 dùng originalFilename)
//             // newFilename là tên tạm do formidable tự đặt — không dùng
//             const fileName = file.originalFilename ?? file.newFilename ?? "unknown";
//             const fileSize = file.size ?? 0;

//             // --- PHASE 1: VALIDATION ---
//             // Kiểm tra extension và kích thước file
//             const validation = validator.validate(fileName, fileSize);

//             if (!validation.isValid) {
//                 // File không hợp lệ — ghi nhận lỗi và xử lý file tiếp theo
//                 results.push({
//                     fileName,
//                     size: fileSize,
//                     savedPath: "",
//                     success: false,
//                     error: validation.error,
//                 });
//                 continue; // Bỏ qua các bước còn lại cho file này
//             }

//             try {
//                 // --- PHASE 2: READ BUFFER ---
//                 // Đọc nội dung file từ đường dẫn tạm của formidable
//                 // file.filepath là nơi formidable lưu file tạm trên disk
//                 const buffer = await readFile(file.filepath);

//                 // --- PHASE 3: DUPLICATE CHECK ---
//                 // CompositeDuplicateChecker chạy FilenameDuplicateChecker trước,
//                 // nếu không trùng tên thì chạy ContentDuplicateChecker
//                 const duplicateCheck = await duplicateChecker.check(fileName, buffer);

//                 if (duplicateCheck.isDuplicate) {
//                     // File trùng — ghi nhận và bỏ qua
//                     results.push({
//                         fileName,
//                         size: fileSize,
//                         savedPath: "",
//                         success: false,
//                         isDuplicate: true,
//                         duplicateReason: duplicateCheck.reason,
//                         error:
//                             duplicateCheck.reason === "filename"
//                                 ? `File with name already exists: ${duplicateCheck.existingFilePath}`
//                                 : `File with identical content already exists: ${duplicateCheck.existingFilePath}`,
//                     });
//                     continue;
//                 }

//                 // --- PHASE 4: SAVE TO DISK ---
//                 // LocalFileStorage.save() ghi buffer vào UPLOAD_DIR/fileName
//                 await storage.save(fileName, buffer);

//                 // --- PHASE 5: RECORD SUCCESS ---
//                 results.push({
//                     fileName,
//                     size: fileSize,
//                     savedPath: path.join(UPLOAD_DIR, fileName),
//                     success: true,
//                 });
//             } catch (err) {
//                 // Xử lý lỗi bất ngờ (disk full, permission denied, ...)
//                 results.push({
//                     fileName,
//                     size: fileSize,
//                     savedPath: "",
//                     success: false,
//                     error: err instanceof Error ? err.message : "Unknown error",
//                 });
//             }
//         }

//         // BƯỚC 6: Trả kết quả — frontend đọc data.results[]
//         ctx.body = { results };
//     }
// );

// export default router;