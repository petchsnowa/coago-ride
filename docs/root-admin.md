# Root Admin ก่อนเปิด COAGO

ขอบเขตที่เจ้าของยืนยัน: ดูภาพรวม ผู้ใช้/ประกาศเที่ยว คำขอร่วมทาง เปิด–ปิดบริการและสมาชิกใหม่ และประวัติการจัดการ ผู้ดูแลสูงสุดคือบัญชี LINE ของเจ้าของเพียงบัญชีเดียว ไม่มีระบบเพิ่มผู้ดูแลคนอื่นในรุ่นนี้

## สิทธิ์และพฤติกรรม

- ใช้ `ROOT_ADMIN_LINE_SUBJECT` (LINE user ID รูปแบบ U ตามด้วยเลขฐาน16จำนวน32ตัว) เป็น server secret เท่านั้น ต้องเป็น user จาก Provider Coago Group เดียวกับ production LINE Login 2009685358 ไม่ใช่ Channel ID หรือ Channel secret
- LINE Developers → Coago Group → Messaging API channel → Basic settings → Your user ID; บันทึกใน GitHub repository → Settings → Environments → production → Environment secrets ชื่อ ROOT_ADMIN_LINE_SUBJECT ห้ามส่งลงแชต/commit/frontend
- ต้องเข้าสู่ระบบใหม่ผ่านการตรวจ LINE ID token/nonce จริงเพื่อสร้าง session ที่ root_verified=true พร้อมตรวจตัวตนและสถานะบัญชีจาก DB ทุกคำสั่ง Root ไม่ใช้ first-user admin, display name, query, browser role หรือ header เป็นสิทธิ์
- เซสชันเก่าก่อน migration ไม่ได้สิทธิ์ Root อัตโนมัติ การเปลี่ยน secret ทำให้ root เดิมถูกปฏิเสธโดยการตรวจ subject ทุกครั้ง การกู้บัญชีต้องเปลี่ยน secret ผ่านผู้ดูแล deployment แล้ว login ใหม่ ไม่มี endpoint ยึดสิทธิ์
- Root แก้ชื่อ/ข้อมูล LINE/รหัสผ่านไม่ได้ ระงับตัวเองไม่ได้ ไม่มี hard delete ผู้ใช้หรือประวัติ
- ระงับผู้ใช้ลบเซสชันทั้งหมดและห้าม login ใหม่ ซ่อนเที่ยวของผู้ใช้จาก public discovery/คำขอใหม่ การคืนสิทธิ์ต้อง login ใหม่ เที่ยว/คำขอเดิมยังเก็บอยู่ให้ Root ตรวจและยกเลิกเที่ยวตามเหตุผลแยกต่างหาก
- Root ยกเลิกเฉพาะเที่ยวอนาคต ใช้ transaction/lock เดียวกับ owner cancellation: ยกเลิก pending/accepted คืน seats_booked และเขียน audit พร้อมกัน Retry ไม่คืนซ้ำและไม่เพิ่ม audit ซ้ำ
- ทุก mutation ต้องมี cookie session, exact Origin, CSRF token, version ล่าสุดและเหตุผลจำเป็น Audit เป็น server-written ผ่าน API เท่านั้น ไม่มี API แก้/ลบประวัติ (ผู้มีสิทธิ์ DB โดยตรงยังแก้ฐานได้ ไม่ใช่ external immutable log)
- Pagination20รายการ หน้า Root โหลดเฉพาะแท็บที่เลือก ไม่มี LINE subject, session hash หรือ credential ใน DTO
- serviceOpen=false ปิด discovery/ทริป/คำขอสำหรับสมาชิกทั่วไปและผู้ไม่ login; Root ยังจัดการได้ Auth/logout/admin ยังใช้ได้ การปิดสมาชิกใหม่ไม่ตัดสมาชิกเดิม ระบบขาด settings/DB จะปิดการเข้าถึงธุรกิจ

## ขั้นนำขึ้นจริง (ยังไม่ดำเนินการในงานพัฒนา)

1. Review/merge PR โดยเจ้าของ ตรวจ CI ให้ผ่าน เตรียม secret ข้างต้น
2. Workflow **Root Admin schema upgrade**, branch main, Environment production, operation=check, project_confirmation=coago-production: อ่านฐาน pinned hostเดิม/neondb ก่อน
3. ตรวจ backup/restore ของ Neon ก่อน ถ้ามีข้อมูลจริงต้อง review และเลือก allow_existing_data อย่างชัดเจน เริ่ม operation=upgrade เพื่อเพิ่ม migrations0007–0008 จาก baseline0000–0006 ตรวจ hashทุกไฟล์ ล็อกป้องกันรันชนกัน ไม่ copy/delete ข้อมูล ไม่แก้ migration history เดิม
4. Migration defaults serviceOpen=false และ registrationsOpen=false. Upgrade retry คงค่าปัจจุบัน ไม่ปิด/เปิดทับการตั้งค่าของ Root
5. Run **Prepare production Worker** จาก main เลือก prepare (หรือ maintenance_update เมื่อ canonical เคยเป็น COAGO แล้วและ DB flagsปิดทั้งสอง). Upload coago-production เท่านั้น ไม่เปลี่ยน DNS/routes และไม่เพิ่ม Paid plan. ตรวจ assets/readiness/site flags/preview auth guard; workers.dev login ถูกบล็อกตามเดิม
6. ทดสอบ Root ผ่าน canonical domain ที่เจ้าของอนุญาตเชื่อมเท่านั้น ระบบก่อนหน้านี้ยังชี้ serverเก่า ผู้ใช้ขอหยุดเผยแพร่ก่อน จึงยังไม่ถือว่า DNS/canonical login ใช้ได้หรือพร้อม launch ห้ามเปิด service ก่อน manual acceptance ครบ

## Manual acceptance ก่อนเปิดบริการ

ใช้บัญชีเจ้าของและบัญชีทั่วไปแยกกัน ตรวจบัญชีทั่วไปไม่เห็น/เรียก Admin API ไม่ได้; Root login ใหม่เห็นภาพรวมและข้อมูล6แท็บ. ลองระงับบัญชีทดสอบแล้ว sessionเดิมใช้ไม่ได้/loginถูกปฏิเสธ คืนสิทธิ์แล้ว loginใหม่; ตรวจเที่ยวถูกซ่อนและกลับมาตามสถานะ. ยกเลิกเที่ยวทดสอบที่มี accepted request ตรวจคำขอ cancelled/คืนที่นั่งครั้งเดียวและ audit. เปิด–ปิดบริการ/สมาชิกใหม่ด้วยเหตุผลและตรวจด้วยหน้าต่างไม่ login. Reload/logout/account switching ไม่ค้างข้อมูล Root. ใช้ข้อมูลทดสอบที่ระบุชัด ไม่ยกเลิกเที่ยวผู้ใช้จริงเพื่อทดลอง

## Hosting ฟรีบน Cloudflare

ใช้ Workers static assets แบบ asset-first; เฉพาะ /api, /api/*, /health, /health/* เรียก Worker; static security headers มาจาก apps/web/public/_headers. ไม่ต้องใช้ server1.2.252.50 ไม่เพิ่ม KV/R2/Queues/บริการที่เสียเงิน

อ้างอิงเอกสาร Cloudflare ที่อ่าน 11พ.ย.2026: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) Free100,000 Worker requests/วัน, CPU10ms/invocation; static asset requestsฟรีไม่จำกัด. [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/) Free100,000 database statements/วัน reset00:00UTC (07:00ไทย); ถึง quotaอาจตอบerror ไม่อัปเกรด Paidเอง. Admin reads/transactionsและauthนับใช้quotaด้วย ไม่มี polling. ไม่รับรองว่าจะอยู่ภายในFree quotaทุกปริมาณผู้ใช้ และยังไม่ได้วัดproductionCPUหรือยืนยันbillingplanของบัญชีจริงในงานนี้

Neon เป็นฐานข้อมูลแยก มีFree quotaของ Neonเอง ต้องตรวจหน้าBillingของทั้งสองบริการ ห้ามใส่บัตร/เปลี่ยนPaidโดยอัตโนมัติ. Rootขั้นแรกไม่มีการชำระเงิน แจ้งเตือน LINE, bulk moderation, user data export หรือระบบเอกสารคนขับ

## แยกหน้าผู้ใช้กับผู้ดูแล

หลังเจ้าของขอแยกหน้า: `/` เป็นหน้าผู้ใช้เท่านั้น ไม่ mount/fetch AdminPanel แม้เป็นบัญชี Root และไม่ bypass maintenance ด้วยสิทธิ์ Root ในหน้าผู้ใช้. `/admin` เป็นหน้าผู้ดูแลแยก ใช้ session เดียวกันและตรวจสิทธิ์ API ทุกครั้ง ไม่แสดง search/ประกาศเที่ยวของตน/คำขอของตนในหน้านี้. สมาชิกทั่วไปเห็นข้อความไม่มีสิทธิ์และลิงก์กลับหน้าผู้ใช้; anonymous ต้อง login. หาก LINE login กลับ `/` ให้เปิด `/admin` อีกครั้ง. โหลด admin UI เป็น lazy chunk แยกจากหน้าหลัก ไม่เพิ่มโดเมน บริการ หรือ migration.

นำรุ่นแยกหน้านี้ขึ้น Worker ที่ผูก canonical แล้ว: ตั้ง service/registration closed ก่อน แล้วใช้ Prepare production Worker operation=`maintenance_update` จาก main หลัง merge; `prepare` จะปฏิเสธ canonical ที่กำลังให้บริการแอปอยู่ตาม guard เดิม.
