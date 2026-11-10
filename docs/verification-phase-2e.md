# ผลตรวจ Phase 2E — ตอบรับ/ปฏิเสธและที่นั่ง

วันที่ 10 พฤศจิกายน 2026 (เวลาไทย) ทำต่อบน PR #6 แบบ Draft ไม่ merge และไม่ production

## Local ที่ผ่าน

- frozen lockfile install, audit (ไม่พบ known vulnerabilities ขณะตรวจ), lint, typecheck, web build และ Workers dry run
- 144 unit/API/UI/contract tests; 46 Chromium browser tests ทั้ง mobile 390px และ desktop 1440px (API mock เพื่อทดสอบ interaction ไม่อ้างเป็น remote connectivity)
- PostgreSQL 17.11/PostGIS 3.5.7 จริง: migrations/rerun, auth/trip/discovery/pending request suites และ decision integration เพิ่ม
- แข่งตอบรับที่นั่งสุดท้ายสำเร็จเพียง1คำขอ, owner-only authorization, repeat decision/refund ครั้งเดียว, opposite decision conflicts, accepted count ตรง seats_booked และไม่เกิน capacity
- snapshot ราคา/จุดรับ/รายละเอียดไม่เปลี่ยนตามเที่ยว, stale version ตอบรับไม่ได้, เจ้าของแก้เที่ยวที่มี accepted ไม่ได้, เที่ยวเต็มไม่อยู่ public discovery, cancellation cutoff, request cancellation/acceptance และ owner cancellation/acceptance races
- upgrade ฐานชั่วคราวจาก migrations 0000–0005 ที่มีคำขอ pending จริง: รักษารายการ/เวอร์ชัน, backfill current terms เป็น UTC snapshot ครั้งเดียว, migrate ซ้ำไม่เขียนทับ snapshot แล้วลบเฉพาะฐานชั่วคราวที่สร้าง
- Local Workers HTTP → pg TCP → PostgreSQL จริง ใช้3 synthetic sessions: accept/reject, concurrent last seat, duplicate accept/refund, full-trip exclusion, stale snapshot, edit lock และ public/private projections ผ่าน; LINE token/verify endpoints ยังเป็น mock ใน runtime suite
- ตรวจภาพหน้าจอ accepted card บนมือถือ: แสดงตอบรับแล้ว, ที่นั่งว่าง0, รายละเอียดข้อเสนอเดิมอ่านได้ ไม่มี overflow

## Remote และ CI

ยังรอ workflow ของ commit รอบนี้ ต้องบันทึก run URL และผลจริงก่อนอ้างว่าผ่าน remote Workers → Hyperdrive → Neon

## Manual

เจ้าของยืนยันก่อนเริ่มรอบนี้: LINE Login สองบัญชี, ส่งคำขอ, เห็นรายการทั้งผู้โดยสารและเจ้าของ, ยกเลิกคำขอแล้ว การตอบรับ/ปฏิเสธใหม่ยังรอเจ้าของทดลองจริง ไม่ใช้ browser mock หรือ synthetic-session smoke แทน real LINE walkthrough

## ขอบเขต/ข้อจำกัด

คำขอเดิมไม่มี original snapshot จึง backfill จากข้อมูล ณ migration และยังใช้ trip_version เดิมป้องกัน acceptance เมื่อเงื่อนไขเปลี่ยน ไม่มี payments หรือ contact release, ไม่มี production changes Neon coago-test เดิมตั้ง auto-delete7วันตั้งแต่9พ.ย.2026 การลบบัญชีในอนาคตต้อง release accepted seats ก่อน user cascade (ยังไม่มี API ลบบัญชี)
