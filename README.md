# Glassdoor Job Crawler - Chrome Extension

**Phiên bản:** v2.7

**Cập nhật cuối cùng:** Ngày 18 tháng 03 năm 2026

**Mô tả:** Một tiện ích mở rộng Chrome để thu thập danh sách việc làm từ Glassdoor (hỗ trợ nhiều quốc gia như .com, .co.uk, .ca, v.v.) và xuất chúng sang file CSV. Phiên bản mới nhất được trang bị thuật toán **Nhận diện Phương thức Ứng tuyển Thông minh (Smart Apply Detection)** hoạt động đa lớp, cơ chế **Crawl dữ liệu theo đợt (Chunked logic)**, cùng các bộ lọc theo địa điểm và từ khóa loại trừ, giúp việc crawl dữ liệu chính xác, tối ưu hóa tốc độ và không bị giới hạn bộ nhớ.

## Mục lục

* Cài đặt
* Cách sử dụng
* Tính năng
* Khắc phục sự cố
* Đóng góp
* Giấy phép

## Cài đặt

### Yêu cầu trước

* Trình duyệt Google Chrome (khuyến nghị sử dụng phiên bản mới nhất).
* Hiểu biết cơ bản về tiện ích mở rộng Chrome.

### Các bước

1. **Tải file tiện ích:**
   * Tải hoặc sao chép kho mã nguồn này về máy tính của bạn.
   * Giải nén file vào một thư mục (ví dụ: C:\glassdoor_crawler).
2. **Tải tiện ích lên Chrome:**
   * Mở Chrome và vào chrome://extensions/.
   * Bật **Chế độ nhà phát triển** bằng cách bật công tắc ở góc trên bên phải.
   * Nhấp vào **Load unpacked** và chọn thư mục chứa file tiện ích (manifest.json, content.js, styles.css, background.js, và tùy chọn icon.png).
3. **Kiểm tra cài đặt:**
   * Tiện ích sẽ xuất hiện trong danh sách với tên "Glassdoor Job Crawler". Nếu có biểu tượng, nó sẽ hiển thị bên cạnh thanh địa chỉ khi truy cập Glassdoor.

## Cách sử dụng

### Bắt đầu

1. **Truy cập Glassdoor:**
   * Mở Chrome và truy cập một trang danh sách việc làm trên Glassdoor bất kỳ (hỗ trợ tất cả tên miền của Glassdoor).
   * Đăng nhập vào tài khoản Glassdoor của bạn nếu cần.
2. **Truy cập giao diện tiện ích:**
   * Tìm giao diện điều khiển ở **góc dưới bên phải** của trang. Giao diện bao gồm nút "Crawl Jobs to CSV", phần chỉ định số lượng trang, và các bộ lọc nâng cao.
3. **Cấu hình quá trình Crawl:**
   * **Số trang:** Nhập số trang cần thu thập (ví dụ: 3) và nhấn **"Lưu"**.
   * **Exclude keywords:** Nhập các từ khóa ngăn cách bằng dấu phẩy (ví dụ: intern, senior) mà bạn không muốn thu thập và nhấn **"Save"**. Các công việc có tiêu đề chứa những từ khóa này sẽ bị tự động loại bỏ.
   * **Location filter:** Nhập các địa điểm ngăn cách bằng dấu phẩy (ví dụ: Vietnam, Ho Chi Minh) để chỉ thu thập các công việc tại địa điểm mong muốn và nhấn **"Save"**.
4. **Chạy quá trình thu thập:**
   * Nhấp vào nút **"Crawl Jobs to CSV"** để bắt đầu.
   * Tiện ích sẽ áp dụng logic **xử lý theo đợt (chunked crawling)** để tải không quá lượng trang được giới hạn ở mỗi đợt. Điều này tối ưu tốc độ crawl và giảm thiểu dung lượng tải cho trình duyệt.
   * Giao diện sẽ hiển thị tiến trình (progress indicator) trực tiếp ngay trên màn hình. Mọi thao tác đóng popup hay nạp thêm trang sẽ được tự động hoàn toàn.
5. **Tải file CSV:**
   * Sau khi hoàn tất, file CSV sẽ tự động tải xuống.
   * Tên file sẽ có định dạng ${số_việc_làm}_${tiêu_đề_trang_đã_xử_lý}.csv (ví dụ: "120_marketing_Jobs_in_California.csv").
   * Mở file trong Excel hoặc phần mềm bảng tính khác để xem dữ liệu.

### Định dạng dữ liệu

File CSV sẽ chứa các cột theo thứ tự sau:

* **Tên công ty**
* **Tiêu đề công việc**
* **Link** (liên kết nhấp được đến danh sách việc làm)
* **Lương**
* **Địa điểm**
* **Ngày đăng**
* **Phương thức ứng tuyển** (Easy Apply / Apply on company site)

## Tính năng

* Thu thập nhiều trang danh sách việc làm từ Glassdoor thông qua tự động cuộn trang và tải thêm.
* **Mới - Logic thu thập theo đợt (Chunked crawling logic):** Tối ưu hóa bộ nhớ và tốc độ xử lý thông qua cơ chế load số trang nhỏ mỗi đợt, lặp lại cho tới khi đạt mục tiêu lượng trang cho trước thay vì cố tải một lượng lớn việc làm cùng lúc.
* **Mới - Bộ lọc nâng cao (Advanced Filters):** 
  * **Location Filter:** Chỉ xuất những việc làm nằm trong số các địa điểm được khai báo.
  * **Exclude Keywords:** Tự động nhận diện và loại bỏ các việc làm nếu chứa các từ khóa không mong muốn trong tiêu đề (ví dụ: senior, intern).
* **Mới - Hỗ trợ đa quốc gia:** Tiện ích hoạt động trên mọi tên miền quốc gia dành cho Glassdoor (bao gồm .com, .co.uk, .ca, .de, .fr, .com.au, .co.in, .sg).
* Xuất dữ liệu sang định dạng CSV chứa đầy đủ thông tin: Tên công ty, Tiêu đề, Lương, Địa điểm, Ngày đăng, Link và Phương thức Ứng tuyển.
* **Nhận diện Phương thức Ứng tuyển Thông minh (Smart Apply Detection):** Phân loại tự động "Easy Apply" hoặc "Apply on employer site" bằng chiến lược 3 lớp tối ưu hóa tốc độ:
  1. **Text Inspection:** Đọc trực tiếp nội dung nút bấm.
  2. **DOM Heuristics:** Kiểm tra CSS classes hoặc URL của `<a>` tag.
  3. **Click-capture Fallback:** Tự động click và bắt URL tab mới dưới nền ngầm, kèm timeout fallback thông minh (chỉ mở tab khi thật sự cần thiết).
* Giao diện điều khiển nổi tiện lợi ngay trên trang web, có tiến trình đếm và thiết lập lọc linh hoạt.
* Cơ chế tự động đóng mạnh mẽ các form, popup hay modal làm phiền của Glassdoor.
* Đặt tên file output thông minh và an toàn hóa kí tự.

## Khắc phục sự cố

* **Chỉ thu thập 1 trang:**
  * Kiểm tra bảng điều khiển (F12 > tab Console) để xem log "Không tìm thấy nút 'Show more jobs'".
  * Tăng thời gian chờ bằng cách chỉnh sửa timeout = 240000 (4 phút) trong hàm scrollAndLoadMore trong content.js.
* **Liên kết không nhấp được trong Excel:**
  * Đảm bảo file CSV được mở trong Excel và macro không bị chặn. Liên kết sẽ hiển thị dưới dạng =HYPERLINK("https://...").
  * Nếu vẫn gặp vấn đề, kiểm tra log liên quan đến liên kết trong bảng điều khiển.
* **Thứ tự cột sai hoặc thiếu dữ liệu:**
  * Xem log trong bảng điều khiển để kiểm tra dữ liệu của mỗi việc làm. Cung cấp ảnh chụp màn hình file CSV nếu vấn đề vẫn tồn tại.
* **Popup không đóng:**
  * Kiểm tra log "Tìm thấy popup, nhấn nút hủy...". Nếu thất bại, đảm bảo selector khớp với bố cục hiện tại của Glassdoor.

## Đóng góp

Hãy gửi vấn đề hoặc pull request trên kho mã nguồn này. Các đóng góp để cải thiện chức năng hoặc sửa lỗi đều được chào đón!

## Giấy phép

Dự án này là mã nguồn mở theo Giấy phép MIT. Xem file LICENSE để biết chi tiết.