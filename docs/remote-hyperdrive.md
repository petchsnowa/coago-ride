# Remote Hyperdrive verification

ขอบเขตนี้เพิ่มตามคำสั่งให้ทดสอบ remote จริงหลัง Phase 1 ไม่ใช่ production deployment

## การตั้งค่า

GitHub repository Actions secrets:
- CLOUDFLARE_API_TOKEN: สิทธิ์ Hyperdrive Edit และ Workers Scripts Edit เฉพาะ account ที่ทดสอบ
- COAGO_TEST_DATABASE_URL: Neon Direct connection ของ coago-test พร้อม sslmode=require/verify-full ห้ามใช้ pooled endpoint หรือฐาน production

GitHub Actions variable:
- CLOUDFLARE_ACCOUNT_ID

Secrets อ่านโดย workflow เท่านั้น ไม่ส่งค่ากลับแชตหรือบันทึกใน repo

## วิธีรัน

Workflow `Remote Hyperdrive test` รันเมื่อ push ไฟล์ workflow หรือ scripts/remote บน branch codex/phase-1-foundation ที่ได้รับอนุญาต ไม่มี pull_request trigger สำหรับงานที่ใช้ secrets เมื่อ workflow อยู่บน default branch แล้วจึงเรียก workflow_dispatch จาก Actions ได้

การรันมีลำดับ:
1. ตรวจ configuration และ Neon Direct/TLS URL
2. สร้าง Hyperdrive ชื่อ coago-hd-test-RUN_ID-ATTEMPT โดยปิด query caching
3. เริ่ม Workers remote preview ที่ใช้ actual Hono app, pg driver และ Hyperdrive binding
4. ตรวจว่าคำขอที่ไม่ถือ probe token ถูกปฏิเสธ
5. ตรวจ readiness และอ่าน PostgreSQL/PostGIS versions พร้อม spatial point/SRID query
6. หยุด preview แล้วลบเฉพาะ Hyperdrive ที่มีชื่อเฉพาะของ run นี้ ผ่าน cleanup step ที่ตั้ง if: always()
7. ตรวจไม่เหลือ config ชื่อนั้น และรายงานผลใน Actions step summary

ไม่เผยแพร่ production Worker ไม่สร้าง production route ไม่แก้ DNS และไม่รัน migrations หรือเขียนข้อมูลใน Neon

## หลักฐานที่ถือว่าผ่าน

Actions ต้องมี `REMOTE_HYPERDRIVE_PASS` พร้อม transport=hyperdrive, readiness=200, PostgreSQL/PostGIS versions, point=POINT(100.5018 13.7563), srid=4326 และ cleanup ต้องผ่านด้วย

ผล unit tests หรือ local Miniflare ไม่ถือเป็นผล remote การมี workflow ใน repo ยังไม่ยืนยันว่าผ่าน ต้องดู run จริง

## ข้อจำกัด

- ต้องมี Workers remote-preview/subdomain พร้อมใช้งานตามข้อกำหนด Cloudflare account หาก API ปฏิเสธ ให้รายงาน code/ขั้นตอนที่ถูกบล็อกโดยไม่เปิดเผย secrets
- Neon project ที่ตั้งใหม่อาจเป็น PostgreSQL 18 / PostGIS 3.6 ซึ่งต่างจาก local baseline 17 / 3.5 ให้รายงานเวอร์ชันที่อ่านจริง ไม่อนุมานจาก local
- Neon branch coago-test ตั้งลบอัตโนมัติ 7 วัน การทดสอบหลังหมดอายุต้องตั้งฐานทดสอบและเปลี่ยน secret ใหม่
- หาก GitHub runner ถูกตัดกลางงานจน cleanup ไม่รัน ให้ตรวจ Cloudflare Hyperdrive ด้วยชื่อ run เฉพาะ ห้ามลบ resources อื่น
