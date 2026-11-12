# หน้าแรก ฟอร์ม และการอนุญาตตำแหน่ง

ขอบเขตตามคำสั่งเจ้าของ 12 พฤศจิกายน 2026:

- หน้าแรกเริ่มจากเมนู 6 ช่อง ตามด้วยค้นหา/รายการเที่ยว รูปรถกับรูปสมาชิกของบัญชีตนเอง การตั้งค่าตำแหน่ง บัญชี/รายการส่วนตัว และเมนูล่าง 4 ช่อง ไม่มีเครื่องมือ Root/Admin ในหน้าสมาชิก
- บน desktop เมนู 3×2 บนมือถือ 2×3 และฟอร์มคอลัมน์เดียว ช่องกรอกทุกหน้ารวม Root/Admin ใช้ป้ายเหนือช่อง พื้นที่กดอย่างน้อย 44px และฟอนต์ร่วมกัน
- ภาพตัวอย่างฟอนต์ไม่ได้ระบุชื่อ จึงเลือก Noto Sans Thai Looped เป็นตัวมีหัวใกล้ภาพ พร้อมใช้ font เดียวกันใน input/select/button และข้อความอื่น ไม่อ้างว่าเป็นไฟล์ฟอนต์เดียวกับภาพ
- GET /api/membership/home เป็น DTO เฉพาะเจ้าของบัญชี มีสถานะ/portraitId และรถที่แก้ล่าสุด brand/model/color/status/photoId เท่านั้น ไม่ส่งเลขบัตร โทรศัพท์ เอกสาร หรือทะเบียน รูปใช้ endpoint ส่วนตัวเดิมซึ่งตรวจเจ้าของและ no-store; ยังไม่มีรูป/R2 แสดงภาพสัญลักษณ์แทน ไม่ใช้ภาพคนสมมติแทนสมาชิกจริง

## ตำแหน่ง

Production ตรวจ browser Geolocation ก่อนบันทึก/แก้ประกาศเที่ยวและส่งคำขอใหม่ ต้องกดให้ browser ขออนุญาตเอง ไม่มี prompt อัตโนมัติเมื่อเปิดหน้าเว็บ ตรวจ getCurrentPosition ใหม่ทุกครั้ง พร้อม timeout และข้อความกรณีปฏิเสธ/ไม่มีสัญญาณ/ไม่รองรับ การค้นหา อ่านข้อมูล จัดการบัญชี ยกเลิก และคืนที่นั่งไม่ถูกปิดกั้นโดยเงื่อนไขนี้

ไม่บันทึกพิกัดที่ได้ ไม่ส่งให้ API ไม่เก็บ localStorage และไม่ watchPosition. Permissions-Policy อนุญาต geolocation เฉพาะ same-origin. ยังไม่มี live tracking/ตำแหน่งของเพื่อนร่วมทางหรือสถานะออกเดินทาง–ถึงปลายทาง ไม่มีการรับรองตำแหน่งจริงจาก client: ผู้ที่เรียก API เองอาจข้ามเงื่อนไข UI ได้ จึงไม่ใช้เป็นหลักฐานยืนยันตัวตนหรือ anti-fraud. Backend ยังคงตรวจตัวตน/อนุมัติ/สิทธิ์และธุรกรรมตามเดิม

Safari/Chrome อาจต้องเปิดทั้ง Location Services ของระบบปฏิบัติการและสิทธิ์ตำแหน่งของเว็บไซต์ ใช้ HTTPS. ใน development เปิด VITE_LOCATION_REQUIRED=true เพื่อทดสอบเงื่อนไขเดียวกับ production (ค่าไม่ใช่ secret)

## ตรวจและนำขึ้นเว็บ

ไม่เปลี่ยน schema และไม่ต้องรัน migration ใหม่สำหรับ PR นี้ รัน lint/typecheck/unit/browser และ member safety integration ซึ่งตรวจ DTO ไม่มีข้อมูลส่วนตัวเกินขอบเขต ใช้ฐาน disposable local และ mock provider เดิม ไม่เขียนข้อมูลจริง หลัง review/merge และ CI ผ่าน ใช้ Prepare production Worker จาก main operation=maintenance_update ขณะ service/registration ปิดตาม runbookเดิม ไม่เปลี่ยน DNS/LINE/Auth provider/billing

ผลตรวจ local รอบนี้: 262 tests, 66 Chromium desktop/mobile checks, lint/typecheck และ production frontend/Workers dry-run build ผ่าน ตรวจภาพหน้าแรกและฟอร์มสมาชิก/Root ทั้งสองขนาดแล้ว. Member safety integration ผ่านบน PostgreSQL/PostGIS และ local Workers/R2 โดย provider/routing ใช้ fixture; เพิ่ม assertion ว่า home DTO ไม่มีเอกสาร/เลขทะเบียนและไม่ได้ล็อกอินเข้าไม่ได้. ทดสอบปฏิเสธตำแหน่ง→ไม่มี request POST, อนุญาตภายหลัง→ส่งได้, timeout และออกจากหน้าระหว่างรอ. ไม่ได้ยืนยัน GPS จริงบนอุปกรณ์เจ้าของหรือ deploy production ในรอบนี้.
