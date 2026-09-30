# Tạo file APK bằng GitHub (không cần cài Android Studio)

GitHub build APK miễn phí trên máy chủ của họ. Chỉ cần 1 tài khoản GitHub (miễn phí) và trình
duyệt Chrome trên máy tính. Làm 1 lần mất khoảng 10 phút; các lần sau chỉ cần bấm 1 nút.

## A. Tải code lên GitHub (1 lần)

1. Đăng ký/đăng nhập https://github.com
2. Bấm dấu **+** góc trên phải → **New repository**
   - Repository name: `kho-lanh-an-an-dien-thoai`
   - Chọn **Private** (chỉ cần APK) hoặc **Public** (nếu muốn dùng thêm mục D bên dưới)
   - Bấm **Create repository**
3. Ở trang repo vừa tạo, bấm dòng chữ **uploading an existing file**.
4. Giải nén file `ban-dien-thoai-github.zip`, mở thư mục vừa giải nén, **chọn TẤT CẢ** bên
   trong (`.github`, `apps-script`, `www`, `package.json`, …) rồi **kéo thả** vào trang GitHub.
   - Phải thấy trong danh sách có dòng `.github/workflows/build-apk.yml`. Không thấy thì xem
     mục "Không thấy thư mục .github" ở cuối.
5. Bấm **Commit changes**.

## B. Build APK

1. Trong repo, bấm tab **Actions**.
   - Nếu GitHub hỏi "I understand my workflows, go ahead and enable them" → bấm đồng ý.
2. Bên trái chọn **Build APK** → bên phải bấm **Run workflow** → **Run workflow** (nút xanh).
   (Lần tải code đầu tiên ở mục A thường đã tự chạy sẵn 1 lần.)
3. Chờ 5–8 phút đến khi có dấu ✅ xanh. Bấm vào lần chạy đó.
4. Kéo xuống mục **Artifacts** → bấm **KhoLanhAnAn-APK** → tải về 1 file .zip → giải nén ra
   file `KhoLanhAnAn-1.apk`.

Dấu ❌ đỏ: bấm vào lần chạy → bấm bước báo đỏ → chụp màn hình phần chữ đỏ gửi lại để sửa.

## C. Cài lên điện thoại Android

1. Chép file `.apk` sang điện thoại (Zalo gửi file cho chính mình, cáp USB, Google Drive…).
2. Mở file trên điện thoại → Android hỏi "cho phép cài ứng dụng không rõ nguồn gốc" → **Cài đặt**
   → bật cho phép với ứng dụng đang mở file (Zalo/Files/Drive) → quay lại → **Cài đặt**.
3. Nếu Google Play Protect cảnh báo "ứng dụng chưa được xác minh" → **Vẫn cài đặt**
   (bình thường với app tự build, chưa đưa lên cửa hàng).
4. Mở app **Kho Lạnh An An** → nhập **URL Web App**, **APP_TOKEN**, **tên người gửi**.

Cập nhật app sau này: sửa file trong `www/` trên GitHub (hoặc tải file mới đè lên) → Actions tự
build lại → cài APK mới đè lên bản cũ, không mất cài đặt.

## D. (Tuỳ chọn) Thử ngay bằng trình duyệt — không cần APK, dùng được cả iPhone

Chỉ làm được khi repo để **Public**.

1. Repo → **Settings** → **Pages** → mục *Source* chọn **GitHub Actions**.
2. Tab **Actions** → chọn **Web preview** → **Run workflow**.
3. Chạy xong, bấm vào lần chạy → thấy đường link dạng
   `https://<tên-tài-khoản>.github.io/kho-lanh-an-an-dien-thoai/`
4. Mở link đó bằng Chrome (Android) hoặc Safari (iPhone) → menu → **Thêm vào màn hình chính**.

Repo public vẫn an toàn: trong code không có mã truy cập nào — `APP_TOKEN`/`PC_TOKEN` chỉ nằm
trong Thuộc tính tập lệnh của Apps Script.

## Không thấy thư mục .github sau khi kéo thả

Tạo tay file build trên GitHub:
1. Repo → **Add file** → **Create new file**
2. Ô tên file gõ đúng: `.github/workflows/build-apk.yml`
3. Mở file `.github/workflows/build-apk.yml` trong thư mục đã giải nén bằng Notepad, chép toàn
   bộ nội dung, dán vào → **Commit changes** → quay lại mục B.


## E. Tự cập nhật app — KHÔNG cần cài lại APK (từ bản 3.64)

App APK tự tải phần giao diện (`www/`) mới từ GitHub Pages. Chỉ khi đổi phần gốc Android (thêm quyền, icon,
plugin) mới phải cài APK mới — khi đó tăng số trong `native-level.txt` (VD 1 → 2) để app biết mà báo.

### Làm 1 lần
1. Repo để **Public**. **Settings → Pages → Source: GitHub Actions**.
2. **Khoá ký APK cố định** (để các lần cài APK sau cài ĐÈ được, không mất dữ liệu):
   Repo → **Settings → Secrets and variables → Actions → New repository secret**, tạo 2 secret:
   - `ANDROID_KEYSTORE_BASE64` = nội dung file `khoa-ky-apk-BASE64.txt` (dán nguyên 1 dòng dài)
   - `ANDROID_KEYSTORE_PASSWORD` = mật khẩu đi kèm
   Giữ file khoá `.p12` + mật khẩu ở nơi an toàn — mất khoá thì lần sau phải gỡ app cài lại.
3. Đưa code mới lên GitHub → tab **Actions**: đợi **Build APK** và **Web preview + cập nhật app** chạy xong (✅).
4. Cài APK mới **lần cuối cùng**. Vì đổi sang khoá mới nên lần này Android có thể báo không cài đè được →
   **gỡ app cũ rồi cài** (trước khi gỡ: gửi hết phiếu đang soạn, ghi lại URL Web App + mã truy cập).

### Từ đó về sau
Sửa code trong `www/` → đưa lên GitHub → Actions tự đăng bản mới lên Pages. Điện thoại mở app ~4 giây sau
hiện thanh **"Có bản mới"**: bấm **Cập nhật ngay**, hoặc để tự áp dụng ở lần mở app sau.
Kiểm tra tay: ⚙ Cài đặt → **⟳ Kiểm tra cập nhật app** (dòng "Phiên bản app" có thêm "gói <mã>" = mã commit).
Bản mới lỗi tới mức app không mở được → app tự quay về bản trước.
