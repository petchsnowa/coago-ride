# Phase 2C — ค้นหาเที่ยวและดูรายละเอียด

เจ้าของรวม PR #3 และยืนยันสร้าง/แก้ไข/ยกเลิกเที่ยวกับออกแล้วเข้า LINE ใหม่สำเร็จ ก่อนสั่งเริ่มค้นหาเที่ยวและรายละเอียดสำหรับผู้โดยสาร รอบนี้ใช้ COAGO Test Worker/Hyperdrive/Neon branch เดิม ไม่มี production deployment/DNS/channel changes

## พฤติกรรม

ค้นหาได้โดยไม่ต้องเข้าสู่ระบบ เลือกจังหวัดต้นทาง จังหวัดปลายทาง (ต่างกัน) และวันเดินทาง ผลเรียงเวลาออกเดินทางใกล้ที่สุดก่อน ครั้งละ 20 เที่ยว ปุ่มดูเที่ยวเพิ่มเติมใช้ cursor ที่ผูกกับเงื่อนไขที่ส่งค้นหาจริง การเปลี่ยนช่องกรอกยังไม่เปลี่ยนผลจนกดค้นหาใหม่

วันเดินทางคือวันปฏิทินไทย: เช่น 2 มกราคม 2030 ครอบคลุม UTC ตั้งแต่ 1 มกราคม 17:00 ถึงก่อน 2 มกราคม 17:00 ค่าใน API/HTML input ใช้ปีคริสต์ศักราช YYYY-MM-DD; รูปแบบวันที่ที่เห็นในช่องขึ้นกับ locale ของ browser; รายการแสดงวันที่ภาษาไทยตาม Asia/Bangkok แม้เครื่องตั้ง timezone อื่น วันที่ในอดีตเป็นคำค้นที่ถูกต้อง แต่ได้รายการว่างเพราะแสดงเฉพาะอนาคต รับปี 2000–2099 และตรวจวันจริงรวม leap year

API กรอง status=active, departure_at > เวลาปัจจุบัน และ seats_offered > 0 ทั้งค้นหาและดูรายละเอียด เที่ยวที่ยกเลิกแล้ว ออกเดินทางแล้ว หรือไม่พบ ตอบ detail 404 แบบเดียวกัน ถ้าเที่ยวถูกยกเลิกหลังค้นหาก่อนเปิดรายละเอียด หน้าจอแจ้งว่าเที่ยวไม่พร้อมและนำออกจากผลค้นหาที่แสดง

รายละเอียดเปิดเป็น dialog รองรับ keyboard/Escape/คืน focus หลังปิด มี loading/error/retry และปุ่มตรวจข้อมูลล่าสุด ไม่ใช้ข้อมูล summary เก่าแทนการตรวจ detail ฝั่ง server ยังไม่มีการจอง ชำระเงิน หรือปุ่มติดต่อผู้ขับขี่ Seats เป็นจำนวนที่ประกาศ ยังไม่หักจาก booking

## ข้อมูลสาธารณะและส่วนตัว

| ข้อมูล | ค้นหา | รายละเอียด |
| --- | --- | --- |
| ID เที่ยว เส้นทาง วันเวลา ที่นั่ง ยี่ห้อ/รุ่น สีรถ เงินร่วมค่าเดินทาง | แสดง | แสดง |
| จุดรับ/ส่ง สัมภาระ เงื่อนไขที่เจ้าของกรอก | ไม่แสดง | แสดง |
| ownerId, requestId, payload hash, version, creation/update timestamps, cancellation reason | ไม่ส่ง | ไม่ส่ง |
| บัญชี/ชื่อ/subject LINE, session/CSRF, ข้อมูลติดต่อและทะเบียนรถเต็ม | ไม่เลือกจากบัญชี | ไม่เลือกจากบัญชี |

ใช้ SQL SELECT ระบุคอลัมน์เท่าที่อนุญาตและ public schemas แบบ strict แยกจาก owner DTO ไม่ใช้ส่ง row ทั้งหมดแล้วซ่อนในหน้าเว็บ

เนื้อหาจุดรับ/ส่ง/เงื่อนไขเป็นข้อความที่ผู้ขับขี่ตั้งใจประกาศ ไม่ใช่ระบบกรองข้อมูลติดต่ออัตโนมัติ ฟอร์มระบุให้หลีกเลี่ยงเบอร์โทร LINE ID และทะเบียนเต็มในข้อความสาธารณะ รอบนี้ไม่เพิ่มข้อมูลติดต่อหรือทะเบียนเต็มใน schema

## API

- GET /api/discovery/trips?originProvince=...&destinationProvince=...&date=YYYY-MM-DD[&cursor=...]
- GET /api/discovery/trips/:id

Public API แยกจาก /api/trips/mine และ write routes ซึ่งยังต้องใช้ owner session/CSRF เช่นเดิม ค้นหาตรวจ required/enum/วันจริง ห้าม duplicate/unknown parameters และ cursor ต้องตรงเส้นทาง/วันที่ ใช้ parameterized SQL; invalid input/cursor ตอบ400, DB failure503ทั่วไป ไม่เปิดเผย errorภายใน ทุก response เป็น no-store เพื่อไม่ส่งผล active ที่ cache ไว้หลังยกเลิก

Cursor encode JSON เป็น UTF-8/base64url (รองรับชื่อจังหวัดไทย), จำกัด600ตัวอักษร ประกอบด้วย filters/departureAt/id เป็น keyset ไม่ใช่ authorization token จงใจไม่เซ็นเพราะ endpoint อ่านข้อมูลสาธารณะเท่านั้น การแก้ cursor ไม่เพิ่มสิทธิ์ดูเที่ยวที่ไม่เปิดอยู่ รายการแต่ละหน้าใช้เวลาปัจจุบันของ request ไม่ใช่ snapshot คงที่ระหว่างหลายหน้า

Migration0003 เพิ่ม partial index(origin_province,destination_province,departure_at,id) WHERE status='active' เท่านั้น ไม่แก้ migrations เดิม ไม่เปลี่ยนข้อมูลเที่ยวหรือบัญชี

## วิธีลองด้วยตัวเอง

1. เปิด https://coago-line-test.akkarapatchara.workers.dev แล้วดู «ค้นหาเที่ยวเดินทาง» เหนือส่วน LINE Login
2. เลือกเส้นทางและวันที่ตรงกับเที่ยวที่สร้างไว้ กด «ค้นหาเที่ยว»
3. กด «ดูรายละเอียด» ตรวจเวลาไทย เงิน จุดรับ/ส่ง รถ สัมภาระและเงื่อนไข แล้วกด «ปิดรายละเอียด» หรือ Escape
4. ลองวัน/เส้นทางที่ไม่มีเที่ยว ต้องแสดงข้อความไม่พบ ไม่ใช่หน้าค้าง
5. เข้าบัญชีเจ้าของ ยกเลิกเที่ยวที่กำลังทดสอบ แล้วค้นหาใหม่ เที่ยวนั้นต้องไม่แสดงอีก แต่ประวัติของเจ้าของยังอยู่

Neon coago-test เป็นฐานทดสอบ auto-delete7วันตั้งแต่ 9พ.ย.2026 ข้อมูลไม่ใช่แผนเดินทางถาวร ผล manual walkthrough รอบค้นหายังรอเจ้าของลอง ไม่ใช้ผลอัตโนมัติแทนคำยืนยันของผู้ใช้

## ตรวจซ้ำ

ใช้คำสั่ง setup/checks เดิมใน README เพิ่ม pnpm test:discovery:integration หลัง migrations ชุดนี้ตรวจ timezone boundaries, route/date/status/time, เรียงdepartureAt+id, cursor20+3เมื่อเวลาเท่ากัน, projection, detailหลังยกเลิก และ partial index บน PostgreSQLจริง

Shared scripts/trip-smoke.ts ใช้ทั้ง local Workers และ remote HTTP: สร้างเที่ยวด้วย synthetic session, ค้นหา/ดูรายละเอียดโดยไม่มี cookie, ตรวจการแก้จำนวนที่นั่ง, ยกเลิกและตรวจหายจากsearch/detail จากนั้น scripts/staging/trip-smoke.ts ล้างเฉพาะบัญชีสังเคราะห์และข้อมูลลูก ไม่แตะเที่ยวของเจ้าของจริง

Browser tests ใช้ mock API เพื่อทดสอบฟอร์ม/สถานะ/รายละเอียด/mobile/desktop แยกจาก DB/Workers จริง ผลและ run links อยู่ใน [รายงาน](verification-phase-2c.md)
