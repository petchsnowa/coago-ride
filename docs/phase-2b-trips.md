# Phase 2B — ประกาศเที่ยวของผู้ขับขี่

เจ้าของอนุญาตให้เริ่มหลังรวม LINE Login (PR #2) โดยทำต่อบน COAGO Test เดิม ไม่ใช้ production resources หรือ production LINE channel

## ขอบเขตรอบนี้

ผู้ใช้ที่เข้าสู่ระบบด้วย LINE สร้างประกาศ ดูรายการของตน แก้ไขและยกเลิกเที่ยวของตนพร้อมเหตุผลได้ ยังไม่มีการค้นหาเที่ยวสาธารณะ การจอง รับผู้โดยสาร ชำระเงิน หรือการยืนยันเอกสารผู้ขับขี่

ข้อมูลประกอบด้วยจังหวัดต้นทาง/ปลายทางที่ต่างกัน วันเวลา จุดรับ/ส่ง จำนวนที่นั่ง ยี่ห้อ/รุ่นและสีรถ เงินร่วมค่าเดินทางต่อคน ข้อจำกัดสัมภาระและเงื่อนไข ไม่เก็บทะเบียนเต็มหรือข้อมูลติดต่อในรอบนี้

ขีดจำกัดต้นแบบ: 1–8 ที่นั่ง เงิน 0–10,000 บาทต่อคน ทศนิยมได้ไม่เกิน 2 ตำแหน่ง นี่เป็นการตรวจข้อมูลสำหรับต้นแบบ ไม่ใช่กฎราคา/ที่นั่งของบริการที่เปิดใช้งานจริง เก็บเงินเป็น integer สตางค์ เก็บเวลาเป็น timestamptz; ช่องกรอกและหน้ารายการใช้เวลาไทย Asia/Bangkok แม้เครื่องผู้ใช้ตั้งเขตเวลาอื่น

## API และสิทธิ์

| Endpoint | พฤติกรรม |
| --- | --- |
| GET /api/trips/mine | รายการของเจ้าของ session เรียงเวลาสร้างล่าสุด ครั้งละ 20 รายการ พร้อม cursor |
| POST /api/trips | สร้างประกาศ; requestId UUID ป้องกันสร้างซ้ำ ตอบ 201 ครั้งแรก/200 เมื่อเรียกซ้ำ |
| PUT /api/trips/:id | แก้ไขประกาศที่ยังไม่ออกเดินทางและยังไม่ยกเลิก ต้องส่ง version ปัจจุบัน |
| POST /api/trips/:id/cancel | ยกเลิกพร้อม reason และ version; เรียกซ้ำเหตุผลเดิมไม่เพิ่ม version อีก |

ทุก endpoint ตรวจ session ฝั่ง server; write ตรวจ exact Origin, CSRF token, JSON, schema และขนาด body สูงสุด 16 KB ไม่รับ ownerId จาก client และไม่ส่ง owner/request fingerprint กลับหน้าจอ การอ้างเที่ยวผู้อื่นตอบ 404, version เก่าตอบ 409, ยังไม่เข้าสู่ระบบตอบ 401; detailed DB errors ไม่เปิดเผย

ห้ามแก้ไข/ยกเลิกเที่ยวที่ออกเดินทางแล้วหรือแก้ไขเที่ยวที่ยกเลิกแล้ว ไม่มีการลบประวัติเที่ยวผ่าน API นี้ Seats ในรอบนี้คือที่นั่งที่ประกาศ ยังไม่มีการหัก/คืนที่นั่งจาก booking

## ความสอดคล้องของข้อมูล

Migration 0002 เพิ่ม trips มี FK เจ้าของ, unique(owner_id, request_id), index สำหรับรายการและ cursor, constraints ที่นั่ง/เงิน/สถานะ/เหตุผล การบันทึกซ้ำใช้ payload hash ของข้อมูลที่ normalize แล้ว ถ้าใช้ requestId เดิมกับข้อมูลต่างกันตอบ 409 ไม่แก้ข้อมูลเดิม

การแก้ไข/ยกเลิกเป็น conditional UPDATE โดยตรวจ owner, version, active และเวลาออกเดินทางในคำสั่งเดียว เมื่อมีผู้แก้ไขพร้อมกันมีเพียงคนเดียวสำเร็จ หน้าจอแจ้งให้โหลดข้อมูลใหม่อย่างชัดเจน ไม่เขียนทับแบบเงียบ ๆ

## วิธีลองบน COAGO Test

1. เปิด https://coago-line-test.akkarapatchara.workers.dev แล้วเข้าสู่ระบบด้วย LINE เหมือนเดิม
2. ใน «เที่ยวเดินทางของฉัน» กรอกประกาศใหม่และเลือกเวลาในอนาคตเป็นเวลาไทย กด «บันทึกประกาศเที่ยว»
3. ตรวจรายการ กด «แก้ไขเที่ยว» เปลี่ยนจำนวนที่นั่ง แล้วกด «บันทึกการแก้ไข»
4. กด «ยกเลิกเที่ยว» ใส่เหตุผลและยืนยัน ตรวจสถานะ «ยกเลิกแล้ว» จากนั้นรีเฟรชเพื่อตรวจว่าข้อมูลยังคงอยู่
5. ออกจากระบบ รายการส่วนตัวต้องหายไป ผู้ใช้อื่นต้องไม่เห็นรายการของบัญชีเดิม

นี่เป็นข้อมูลทดสอบบน Neon coago-test ซึ่งตั้ง auto-delete 7 วันตั้งแต่สร้างวันที่ 9 พ.ย. 2026 อย่าใช้เก็บแผนเดินทางจริงถาวร เมื่อ branch หมดอายุเว็บทดสอบอาจไม่พร้อมจนจัดเตรียม test branch ใหม่

## ตรวจซ้ำ

```sh
pnpm install --frozen-lockfile
pnpm audit
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:generate
pnpm db:migrate
pnpm db:migrate
pnpm test:integration
pnpm test:auth:integration
pnpm test:trips:integration
pnpm test:workers
pnpm test:auth:workers
pnpm test:browser
```

ชุด integration จำกัดฐาน local ชื่อลงท้าย _test ใช้ Docker Compose ของ repo และ .env ตาม README การตรวจ browser ใช้ mocked auth/trip endpoints แยกจากการตรวจ DB และ Workers จริง `test:auth:workers` ตรวจ CRUD ด้วย session จาก mock LINE verification และบัญชีสังเคราะห์ที่สองบนฐานจริง

Workflow LINE Login staging รองรับ branch codex/phase-2b-trip-posting ด้วย ใช้ Worker/Hyperdrive เดิมชื่อ coago-line-test และ test DB secret เดิม Migrator ตรวจ TLS certificate ก่อนรัน versioned migrations หลัง deploy รัน scripts/staging/trip-smoke.ts ตรวจ HTTP จริงด้วย 2 synthetic sessions แล้วลบเฉพาะบัญชีที่สร้างและข้อมูลลูกผ่าน FK cascade ไม่ลบเที่ยวหรือ session ของผู้ใช้จริง ไม่ถือว่าการสร้าง synthetic session เป็นการทดสอบ LINE authorization จริง

ผลตรวจและหลักฐานรอบนี้อยู่ใน [verification](verification-phase-2b.md)
