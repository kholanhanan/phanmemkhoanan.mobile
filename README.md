# Kho Lạnh An An — Bản Điện Thoại

Ứng dụng điện thoại để **xem tồn kho** (Module 01, Module 02, Vị trí, Vị trí Bột) và **gửi phiếu xuất**
(từ 4 nguồn đang bật: Tồn kho gửi M02, Tồn kho An An M01, Tồn theo vị trí M01, Vị trí Bột M01 — NXT Bột/Sốt M03
và NXT TNK/TGC M04 **đang ẩn** trên điện thoại, xem `HIDDEN_SOURCES` trong `www/app.js`) về app PC, và **xuất file phiếu (PDF / Excel / ảnh PNG) ngay trên điện thoại**. Điện thoại không nói chuyện trực tiếp với PC — cả hai cùng đọc/ghi 1 Google Sheet:

```
 App PC (Electron)                 Google Sheet                  Điện thoại
 ─────────────────                 ────────────                  ──────────
 đẩy tồn kho  ───────────────▶  TonKho_M01 / M02 / ViTri  ◀─── xem tồn
                                 Meta (lastPushAt)
 kéo phiếu, trừ tồn ◀────────  PhieuXuat / PhieuXuatItems ◀─── gửi phiếu
 (Module 02)                                                   (qua Apps Script)
```

- **Không cần Google Cloud Console, Service Account hay file Key.** Cả PC và điện thoại đều gọi
  1 **Apps Script Web App** gắn với Sheet, mỗi bên 1 mã truy cập riêng:
  - `PC_TOKEN` — app PC: ghi đè bảng tồn kho, nhận phiếu, đánh dấu đã xử lý.
  - `APP_TOKEN` — điện thoại: chỉ xem tồn, xem phiếu, tạo phiếu mới.

---

## Bước 1 — Tạo Google Sheet và cài Apps Script (làm 1 lần, trên máy tính)

1. Vào https://sheets.google.com → tạo 1 bảng tính trống, đặt tên tuỳ ý
   (vd "KLANAN Online"). Không cần tạo tab nào — app PC tự tạo.
2. Trong bảng tính đó: menu **Tiện ích mở rộng → Apps Script**.
3. Xóa code mẫu, dán **toàn bộ** nội dung file `apps-script/Code.gs` → bấm 💾 **Lưu**.
4. Đặt 2 mã truy cập: bấm ⚙️ **Cài đặt dự án** (thanh bên trái) → cuối trang
   **Thuộc tính tập lệnh → Thêm thuộc tính tập lệnh**, thêm 2 dòng:

   | Thuộc tính | Giá trị (tự đặt, khó đoán, 2 mã KHÁC nhau) |
   |---|---|
   | `PC_TOKEN` | ví dụ `AnAn-PC-8k2Lq91x` — chỉ nhập trên máy PC |
   | `APP_TOKEN` | ví dụ `AnAn-DT-4mZ7wp3c` — đưa cho người dùng điện thoại |

   Bấm **Lưu thuộc tính tập lệnh**.
5. Bấm **Triển khai → Tùy chọn triển khai mới** → biểu tượng ⚙️ → **Ứng dụng web**:
   - Thực thi với tư cách: **Tôi**
   - Người có quyền truy cập: **Bất kỳ ai**
   - Bấm **Triển khai** → Google hỏi cấp quyền: chọn tài khoản → **Nâng cao** →
     **Đi tới … (không an toàn)** → **Cho phép**. (Cảnh báo này xuất hiện với mọi script tự
     viết chưa qua Google duyệt; script chỉ truy cập đúng bảng tính này.)
6. Sao chép **URL ứng dụng web** (dạng `https://script.google.com/macros/s/…/exec`).

> "Bất kỳ ai" nghĩa là ai có đường dẫn đều gửi yêu cầu được — nhưng thiếu đúng mã thì Web App
> từ chối. Muốn thu hồi quyền của tất cả điện thoại: đổi giá trị `APP_TOKEN`.

**Khi cập nhật `Code.gs` sau này:** dán code mới → Lưu → **Triển khai → Quản lý triển khai →
✏️ → Phiên bản: Phiên bản mới → Triển khai**. Chỉ bấm Lưu thì Web App vẫn chạy code cũ. Làm
theo cách này URL giữ nguyên, không phải nhập lại ở PC hay điện thoại.

## Bước 2 — Kết nối app PC

App PC → **Cài Đặt** → tab **Điện Thoại**: dán **URL Web App**, nhập **PC_TOKEN** →
**Lưu cấu hình** → **Kiểm tra kết nối** → **⬆ Đẩy tồn kho lên**. Mở lại Google Sheet sẽ thấy
đủ 6 tab có dữ liệu.

## Bước 3 — Dùng thử trên trình duyệt (chưa cần build APK)

Thư mục `www/` là 1 trang web tĩnh, chạy được ngay:

- Trên máy tính: mở `www/index.html` bằng Chrome, bấm F12 → biểu tượng điện thoại để xem
  giao diện cỡ điện thoại.
- Muốn dùng trên điện thoại mà chưa build APK: tải thư mục `www/` lên 1 dịch vụ web tĩnh
  miễn phí (Netlify Drop, GitHub Pages…), mở link bằng Chrome trên điện thoại → menu ⋮ →
  **Thêm vào màn hình chính**.

Lần đầu mở, app hỏi 3 thông tin: **URL Web App** (cùng URL với PC), **mã truy cập**
(`APP_TOKEN` — không phải `PC_TOKEN`), **tên người gửi phiếu**.

## Bước 4 — Build file APK Android

**Cách dễ nhất (không cần cài gì):** để GitHub build hộ — xem `HUONG-DAN-TAO-APK.md`.

**Tự build trên máy tính:**


Cần cài: **Node.js 18+**, **Android Studio** (kèm JDK 17 — Android Studio tự cài).

Mở terminal tại thư mục `ban-dien-thoai/`:

```
npm install
npm run android:add      # chỉ lần đầu — tạo thư mục android/
npm run sync             # chép www/ vào android/ (chạy lại MỖI LẦN sửa www/)
npm run open             # mở Android Studio
```

Trong Android Studio: chờ Gradle tải xong → menu **Build → Build Bundle(s) / APK(s) → Build
APK(s)** → bấm **locate** để lấy file `app-debug.apk`, chép sang điện thoại và cài (cho phép
"cài ứng dụng không rõ nguồn gốc").

---

## Cách dùng hằng ngày


Thanh dưới có 4 tab: **Trang chủ · Kho · Phiếu · Tra cứu**.

- **Trang chủ**: ô *Tìm mã hàng trong tất cả kho*; *Việc cần làm* (phiếu đang soạn, chờ PC nhận,
  PC nhận hôm nay); 5 ô kho với tổng tồn — chạm để mở kho đó.
- **Kho**: xem tồn VÀ xuất trong cùng 1 màn (thay cho 2 tab Xuất kho / Tồn kho cũ). Bấm ô tên kho
  trên cùng để đổi kho. Mỗi dòng: **Mã hàng · Vị trí (hoặc Lô / HĐ) · Số lượng** trên 1 dòng, tên
  hàng ở dòng dưới. Chạm vào dòng → xem đủ thông tin + *Tồn PC − Chờ PC = Còn lấy được* → nhập số
  lượng → *Thêm vào phiếu*.
- **Phiếu**: 4 nhóm *Đang soạn · Chờ PC · Đã nhận · Đã hủy*. Có phiếu soạn dở thì bấm tab Phiếu sẽ
  mở thẳng nhóm Đang soạn.
- **Tra cứu**: Module 08 (mã hóa sản phẩm, dữ liệu tổng hợp, rã đông, kháng sinh).

Chi tiết từng việc (tên màn hình cũ "Xuất kho", "Tồn kho", "Phiếu đã gửi", "Tổng hợp" nay lần lượt
là tab **Kho**, **Kho**, **Phiếu**, **Tra cứu**):

- **Xuất kho**: chọn 1 trong 5 nguồn ở trên cùng (vuốt ngang) → gõ để tìm → chạm vào dòng → chọn số lượng →
  **Thêm vào phiếu** → thanh xanh phía dưới → **Gửi phiếu**. 1 phiếu chỉ thuộc 1 nguồn; muốn
  xuất nguồn khác thì gửi (hoặc hủy) phiếu đang soạn trước.

  | Nguồn | Lấy từ | Về PC nằm ở | Trừ gì |
  |---|---|---|---|
  | **Kho gửi** | Module 02 | Module 02 → tab Phiếu Xuất (dấu 📱) | Số kiện + Trọng lượng |
  | **Tồn kho An An** | Module 01 (bảng Load Data) | Module 01 → Tổng Hợp → Xuất Hàng | Tồn cuối |
  | **Vị trí** | Module 01 → Tồn theo vị trí | Module 01 → Tồn theo vị trí → "📱 Phiếu xuất từ điện thoại" | SL Tồn |
  | **Vị trí Bột** | Module 01 → Load Data → "Tải dữ liệu vị trí Bột" | Module 01 → Vị Trí Bột → "📱 Phiếu xuất từ điện thoại" | SL |
  | **Bột/Sốt** | Module 03 (theo lô) | Module 03 → Xuất sử dụng (mã PX_…, Lịch sử) | Tổng (kg) — nhập theo **kiện** nếu lô có kg/kiện; **bắt buộc chọn LSX xuất** |
  | **TNK/TGC** | Module 04 (lô nhập × vị trí) | Module 04 → Xuất hàng (+ Lịch sử) | SL tồn tại đúng vị trí |

  Phiếu nào cũng về PC ở trạng thái "Đã trừ tồn"; trên PC vẫn hủy trừ / trừ lại được. Phiếu
  Vị trí có nút **Xem & xuất** để in/xuất Excel·PDF·PNG giống nút "Tạo phiếu xuất" trên PC.
  - Số to bên phải = số kiện **còn lấy được** = Số kiện trên PC − các phiếu điện thoại PC
    chưa nhận ("chờ PC").
  - Phiếu đang soạn được lưu trên máy; mất mạng lúc gửi thì bấm **Gửi phiếu** lại — không
    bao giờ bị tạo trùng.
- **Sửa / xóa phiếu đã gửi**: màn **Phiếu đã gửi** → chạm vào phiếu đang *Đang chờ PC nhận* → **✏️ Sửa phiếu**
  (đổi số lượng, bỏ hoặc thêm dòng, đổi ghi chú → **Lưu thay đổi**; mã phiếu giữ nguyên) hoặc **🗑 Xóa phiếu**.
  Chỉ làm được khi PC **chưa nhận** phiếu. PC đã nhận (đã trừ tồn trong file Excel) thì phải hủy/sửa ngay trên
  PC; điện thoại sẽ báo và không cho sửa. Phiếu xóa không hiện nữa nhưng vẫn còn 1 dòng trên Sheet
  (trạng thái *Lỗi - Đã hủy trên điện thoại*) để đối chiếu. **Cần dán lại `Code.gs` mới và triển khai
  phiên bản mới** (xem Bước 1) thì 2 nút này mới hoạt động.
- **Tồn kho**: xem cả 5 bảng (Tồn kho gửi, Tồn kho An An, Vị trí, Bột/Sốt, TNK/TGC) — dùng chung số liệu đã
  lưu với tab Xuất kho; chạm 1 dòng để xem đủ các cột.
- **Phiếu đã gửi**: *Đang chờ PC nhận* → *PC đã nhận* (đã nằm trong Module 02 và đã trừ tồn).

PC nhận phiếu theo chu kỳ đặt ở Cài Đặt → Điện Thoại (mặc định 5 phút) **khi app PC đang mở**.
Cần ngay thì bấm **"⬇ Lấy phiếu xuất mới"** trên PC.

## Tổng hợp (Module 08) — chỉ xem, tra cứu

Tab **Tổng hợp** ở thanh dưới, 4 menu con giống PC:
- **Mã hóa SP**: *Giải mã* (gõ/dán mã hàng 21 ký tự, có hay không "TPC-" → nghĩa từng tổ hợp),
  *Mã đã tạo* (danh sách mã + diễn giải), *Danh mục* (giá trị khai báo của 10 tổ hợp).
- **Dữ liệu tổng hợp** và **Báo cáo rã đông**: *Bảng gộp (Bảng 2)* — tính bằng đúng code của PC,
  có tổng các cột số theo bộ lọc; *Dữ liệu gốc (Bảng 1)* — chạm dòng để xem đủ cột.
- **Tra cứu kháng sinh**: chính ứng dụng tra cứu của PC (Tra cứu nhanh / Dữ liệu / Quy định), ở
  chế độ chỉ xem — thêm/sửa/xóa vẫn làm trên PC.

Trên PC: Cài Đặt → Điện Thoại → tick **Tổng hợp (M08)** → 🔄 Đồng bộ ngay.

## Số liệu được lưu trên điện thoại

- Lần đầu mở mỗi nguồn, app tải bảng đó về và **lưu trên máy** (bộ nhớ trong của app, không mất
  khi tắt app/điện thoại). Các lần mở sau **hiện ngay bản đã lưu, không tải lại**.
- Mỗi lần mở app (tối đa 1 lần/phút), app chỉ hỏi Web App 1 câu rất nhẹ: *"PC có đẩy số liệu mới
  không?"* — bảng nào PC vừa đẩy bản mới thì mới tải lại bảng đó; số "chờ PC" luôn được cập nhật.
- Dòng dưới tên app cho biết: *"Số liệu PC lúc … · đã lưu trên máy"*.
- Muốn tải lại ngay bảng đang xem: bấm nút ⟳ góc trên. Muốn xóa sạch để tải lại từ đầu:
  ⚙️ Cài đặt → **Xóa dữ liệu đã lưu trên máy**.
- Gửi phiếu vẫn luôn được Web App kiểm tra tồn mới nhất — nên dù bản lưu trên máy có cũ, không
  thể xuất vượt tồn.

## Xuất file phiếu trên điện thoại

Gửi phiếu xong, app hỏi **Xuất file**: chọn **PDF**, **Excel** hoặc **Ảnh PNG** → rồi chọn:
- **💾 Lưu trên điện thoại** → file nằm ở *Bộ nhớ máy › Documents › KhoLanhAnAn* (mở bằng app
  "Tệp"/"Quản lý file"). App báo đúng đường dẫn sau khi lưu.
- **📤 Gửi qua Zalo / Email / Google Drive…** → mở danh sách chia sẻ của điện thoại, chọn Zalo,
  Gmail, Drive, Messenger…

Xuất lại phiếu cũ: tab **Phiếu đã gửi** → chạm vào phiếu → **📄 Xuất file**.

Mẫu file theo đúng bảng dữ liệu: Kho gửi = "Phiếu yêu cầu xuất hàng" của Module 02 (có logo);
Vị trí = "Phiếu xuất" của menu Tồn theo vị trí. Tồn kho An An, Bột/Sốt, TNK/TGC trên PC chưa có mẫu
phiếu riêng nên dùng kiểu Excel sẵn có của đúng module đó. Xuất file KHÔNG trừ tồn — tồn chỉ bị
trừ khi PC nhận phiếu (tự động, như trước).

## Khi gặp lỗi

| Thông báo trên điện thoại | Cách xử lý |
|---|---|
| Mã truy cập không đúng | Điện thoại: nhập `APP_TOKEN`. PC: nhập `PC_TOKEN`. Kiểm tra đúng chữ hoa/thường |
| Web App trả về trang lạ | URL phải kết thúc bằng `/exec`; quyền truy cập phải là "Bất kỳ ai" |
| Chưa có dữ liệu tồn kho gửi trên Sheet | Trên PC bấm "⬆ Đẩy tồn kho lên" |
| Không đủ hàng | Người khác vừa xuất cùng lô — app đã tải lại số mới, sửa số lượng rồi gửi lại |
| Lô … không còn trong tồn kho mới nhất | PC vừa nạp lại dữ liệu Module 02 — bỏ dòng đó khỏi phiếu |

## Các file

| File | Vai trò |
|---|---|
| `apps-script/Code.gs` | Web App trên Google Sheet — cổng duy nhất cho cả PC và điện thoại; mọi quy tắc kiểm tra phiếu nằm ở đây |
| `www/index.html`, `www/app.css`, `www/app.js` | Giao diện điện thoại (HTML/CSS/JS thuần, không build) |
| `capacitor.config.json`, `package.json` | Đóng gói thành app Android bằng Capacitor |
| `.github/workflows/build-apk.yml` | GitHub tự build APK (xem `HUONG-DAN-TAO-APK.md`) |
| `.github/workflows/web-preview.yml` | (Tuỳ chọn) đăng `www/` thành trang web để thử ngay |

Tên cột và "khóa lô" (Mã hàng + Số lô + Size + Phiếu nhập) phải giống nhau ở 3 nơi:
`Code.gs` (`matchKey_`), `app/main.js` (`syncMatchKey`), `app/html/js/ton-kho-gui.js`
(`pxRowMatchKey`). Sửa 1 nơi thì sửa cả 3.

## Phân quyền theo mã truy cập (mỗi người 1 mã)

1. Trên PC: **Cài Đặt → Điện Thoại → Phân quyền điện thoại** → ➕ Thêm người → đặt tên, chọn quyền
   (**Chỉ xem** / **Tạo phiếu**) và các kho được dùng → **💾 Lưu & cập nhật lên Sheet**.
2. Mỗi người có **Tên người dùng** (ID đăng nhập, không dấu, VD `thang` — không phân biệt hoa/thường), **Tên hiển thị**
   (có dấu, VD "Thắng" — hiện trên app và cột "Người tạo" của phiếu) và **Mã truy cập** (mật khẩu). Bấm **Copy** mã,
   gửi cho họ; trên điện thoại vào Cài đặt → nhập **Tên người dùng** + **Mã truy cập**.
3. Khóa 1 người: bỏ tick **Bật** → Lưu. Đổi mã: **Tạo mã** → Lưu (mã cũ hết hiệu lực).
   Muốn mã dễ nhớ: bấm **Tự đặt** → gõ mã (8–64 ký tự, chữ không dấu / số / `- _ . @ # !`, phân biệt HOA/thường,
   không trùng người khác) → **✓ Dùng mã này** → Lưu.
4. Mã `APP_TOKEN` chung trong Apps Script vẫn là **quản trị** (đủ quyền, sửa/xóa phiếu được). Khi mọi người
   đã có mã riêng, xóa `APP_TOKEN` trong Thuộc tính tập lệnh để khóa hẳn mã chung.

Google Sheet chỉ lưu **mã băm** của token (tab `PhanQuyen`), không lưu mã gốc. Người có mã riêng chỉ thấy
phiếu của chính mình; tài khoản **Tạo phiếu** tự sửa / xóa được phiếu **của mình** khi PC chưa nhận (phiếu người khác thì không).

## Giao diện Sáng / Tối

Mặc định **Sáng** (xanh da trời). Đổi sang **Tối** (đỡ chói khi làm trong kho thiếu sáng) ở
**Cài đặt → Giao diện**, có hiệu lực ngay, app nhớ lựa chọn cho lần mở sau.

