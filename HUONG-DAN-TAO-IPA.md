# Hướng dẫn tạo file .ipa và cài lên iPhone

Không cần máy Mac, không cần trả phí Apple. GitHub build ra file `.ipa` **chưa ký**, sau đó
máy tính Windows dùng **Sideloadly** ký bằng Apple ID thường và cài thẳng vào iPhone qua cáp.

> Giới hạn của Apple ID miễn phí: app chạy được **7 ngày**, hết hạn thì cài lại bằng Sideloadly
> (dữ liệu trong app vẫn giữ). Mỗi Apple ID cài tối đa 3 app kiểu này. Muốn dùng lâu dài
> không phải cài lại → cần tài khoản Apple Developer (99 USD/năm).

## Phần 1 — Tạo file .ipa trên GitHub (làm mỗi khi có bản mới)

1. Tải file `.github/workflows/build-ios.yml` lên repo, đúng thư mục `.github/workflows/`
   (cạnh `build-apk.yml`). Trên GitHub: vào thư mục `.github/workflows` → **Add file → Upload files**.
2. Vào tab **Actions** → bên trái chọn **Build IPA (iOS)** → bấm **Run workflow** → **Run workflow**.
3. Chờ khoảng 8–15 phút đến khi có dấu ✅ xanh.
4. Bấm vào lần chạy đó → kéo xuống **Artifacts** → tải **KhoLanhAnAn-IPA** (file .zip) →
   giải nén ra file `KhoLanhAnAn-…-chua-ky.ipa`.

> Repo đang để Private: máy macOS của GitHub tính phút gấp 10 lần. Gói miễn phí vẫn đủ khoảng
> 15–20 lần build mỗi tháng. Workflow này chỉ chạy khi bạn bấm nút (không tự chạy như bản APK).

## Phần 2 — Cài lên iPhone bằng Sideloadly (máy tính Windows)

**Chuẩn bị (làm 1 lần):**
1. Cài **iTunes** và **iCloud** bản tải từ trang của Apple (apple.com), **không** dùng bản trên
   Microsoft Store — Sideloadly cần bản này để nhận iPhone.
2. Tải và cài **Sideloadly** từ trang chính thức `sideloadly.io`.
3. Cắm iPhone vào máy tính bằng cáp → trên iPhone bấm **Tin cậy** (Trust) → nhập mật mã.

**Cài app:**
1. Mở Sideloadly → kéo file `.ipa` vào cửa sổ.
2. Ô **iDevice**: chọn iPhone của bạn. Ô **Apple account**: nhập Apple ID (nên dùng 1 Apple ID
   riêng cho việc này).
3. Bấm **Start** → nhập mật khẩu Apple ID (và mã xác minh 2 lớp nếu được hỏi) → chờ báo **Done**.

**Mở app lần đầu trên iPhone:**
1. **Cài đặt → Cài đặt chung → Quản lý VPN & Thiết bị** → chọn Apple ID vừa dùng → **Tin cậy**.
2. iOS 16 trở lên: **Cài đặt → Quyền riêng tư & Bảo mật → Chế độ nhà phát triển** → bật →
   iPhone khởi động lại → xác nhận **Bật**.
3. Mở app **Kho Lạnh An An** → vào **Cài đặt** (bánh răng) → nhập đường dẫn Web App và mã truy cập
   giống bản Android.

**File phiếu xuất** lưu trong app **Tệp (Files) → Trên iPhone → Kho Lạnh An An**, hoặc gửi thẳng
qua Zalo/Mail bằng nút chia sẻ trong app.

## Khi app hết hạn 7 ngày / khi có bản mới

Cắm iPhone → mở Sideloadly → kéo file `.ipa` (bản cũ hoặc bản mới vừa build) → **Start**.
Không cần xoá app cũ; số liệu và cài đặt trong app vẫn còn.

## Lỗi thường gặp

| Lỗi | Cách xử lý |
|---|---|
| Sideloadly không thấy iPhone | Cài lại iTunes bản từ apple.com, cắm lại cáp, bấm Tin cậy trên iPhone |
| "Không thể xác minh app" khi mở | Làm bước **Tin cậy** trong Quản lý VPN & Thiết bị |
| App không mở được trên iOS 16+ | Bật **Chế độ nhà phát triển** |
| Báo quá số app / App ID | Apple ID miễn phí chỉ 3 app, 10 App ID mỗi tuần — xoá bớt app sideload khác hoặc chờ vài ngày |
| Workflow đỏ ở bước "Đặt icon" | Thiếu `icons/icon-1024.png` trên repo — tải thư mục `icons/` lên |
