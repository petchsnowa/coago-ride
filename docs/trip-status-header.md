# ส่วนหัวรายการเที่ยว

ตามคำขอให้ส่วนหัวมีสถานะและรายละเอียดเที่ยวที่อ่านง่าย แทน hero ข้อความขนาดใหญ่ด้วยรายการเที่ยวเปิดประกาศจากฐานข้อมูลจริง เปิดหน้าแล้วเห็นได้โดยไม่ต้องค้นหาหรือเข้าสู่ระบบ

- แสดงไม่เกิน6เที่ยวที่ active, departure_at > now และ seats_offered > 0 เรียงเวลาออกเดินทางใกล้ที่สุดก่อน แล้วเรียงidกรณีเวลาเท่ากัน
- แต่ละการ์ดมีสถานะข้อความ «เปิดประกาศ» เส้นทาง วันเวลาไทย ที่นั่ง รถ/สี เงินร่วมเดินทาง และปุ่มดูรายละเอียดจาก API เดิม
- มี loading/empty/error/retry และปุ่มโหลดเที่ยวล่าสุด ไม่มีตัวเลขจอง/รับผู้โดยสารที่ระบบยังไม่ได้รองรับ แสดงจำนวนรายการที่โหลดจริง ไม่อ้างว่าเป็นจำนวนเที่ยวทั้งหมด
- เมนูบนสุดลัดไปค้นหาเฉพาะเส้นทางและเที่ยวของฉัน ค้นหาตามเงื่อนไขแล้วซ่อนรายการแนะนำเพื่อไม่ให้ปนกับผลค้นหา มีปุ่มกลับไปดูเที่ยวที่กำลังจะออกเดินทาง
- รายการยกเลิก/ออกเดินทางแล้วไม่เปิดใน public feed ประวัติของเจ้าของยังอยู่ในส่วนส่วนตัวตามเดิม รายละเอียดตรวจสถานะล่าสุดฝั่งserverอีกครั้งก่อนแสดง ถ้า404นำเที่ยวออกจากรายการบนหน้า

GET /api/discovery/trips/upcoming เป็น public read-only ใช้ projection/schema เดิม ไม่รับlimit/filterจากcaller จำกัด6จากSQL, no-store และตอบข้อผิดพลาดทั่วไป ไม่มี owner/LINE/session/contact columns ในpayload Migration0004เพิ่มpartial index(departure_at,id) WHERE status='active' ไม่เปลี่ยนข้อมูลเที่ยว

ข้อมูลเป็นสถานะเมื่อโหลดหน้า/กดโหลดล่าสุด ไม่ใช่realtime websocket และยังไม่ใช่การจองที่นั่ง ใช้ test branch Neon/Worker/Hyperdrive เดิม ไม่แตะproduction/DNS/LINE channel

## Verification

Localผ่าน111 unit/API/UI/config tests,30desktop/mobile browser tests (mock API), lint/typecheck และ build/dry run ชุดDB discoveryบนPostgreSQL17.11/PostGIS3.5.7 ผ่านทั้งupcoming bounded6/time/status/projection และsearch/detailเดิม ภาพหน้าจอmobile/desktopตรวจด้วยตาแล้ว

Shared Workers/remote smokeเพิ่ม anonymous upcoming query ตรวจขนาดไม่เกิน6 เรียงเวลา/id โดยไม่logข้อมูลเที่ยวของผู้ใช้จริง CI/staging run linksและผลremoteอยู่ในPRของbranch codex/trip-status-header แยกbrowsermockจากreal Workers/DB และยังไม่อ้างว่าเจ้าของลองส่วนหัวใหม่แล้ว
