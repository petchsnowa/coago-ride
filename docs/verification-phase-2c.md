# ผลตรวจ Phase 2C — ค้นหาและรายละเอียด

วันที่ 10 พฤศจิกายน 2026 UTC ทำบน branch codex/phase-2c-trip-search จาก main หลัง merge PR #3 (94036ee) ไม่ deploy production/เปลี่ยน DNS/production channel

## Local

- ผ่าน TypeScript/lint หลังปรับ tests เดิมให้เลือกปุ่ม/สถานะเฉพาะส่วน readiness แทนเลือกทุกปุ่มทั้งหน้า
- ผ่าน 108 unit/API/UI/config/contract tests รวม public schema projection, no-auth discovery, validation, exact Thai-day UTC bounds, leap dates, malformed/mismatched cursors และ generic failures
- ผ่าน 24 browser tests บน desktop/mobile (mock APIs): ค้นหา/รายละเอียด/เวลาไทยเมื่อ browser ตั้ง America/Los_Angeles, empty/error/retry, paginationคงfilterเดิม, invalid inputไม่ยิงrequest, stale/cancelled detail, keyboardEscape/focusคืน และ owner CRUD/auth UI เดิม
- ผ่าน PostgreSQLจริง discovery integration: Thai dayขอบUTC, route/status/expiry, pagination20+3พร้อมdepartureAtซ้ำ, no private fields, detailไม่เปิดเผยcancelled/past/missing, ยกเลิกหลังlisting และ partialindex0003
- ผ่าน Workersจริงกับ PostgreSQL: anonymous search/detail, public projection, seat updateมองเห็น, cancelled search/detailไม่แสดง พร้อม auth/owner CRUDเดิม โดยจำลองเฉพาะ LINE token/verify endpoints
- React/Vite build และ Wrangler dry run ผ่าน ไม่มี uploadจากคำสั่งbuild

- ผ่าน frozen-lockfile install และ audit ไม่พบ known vulnerabilities ณ เวลาตรวจ
- ผ่าน db:generate ไม่เกิด schema drift, migrations จากฐานว่าง coago_phase2c_test และรันซ้ำ แล้วลบเฉพาะฐานทดสอบนี้หลังตรวจ, PostgreSQL17.11/PostGIS3.5.7 integration, auth/trips integration และ Workers readiness/unavailable tests เดิม

## CI และ remote

Remote ผ่านจริงบน implementation commit `6b45150c265e4287a858ba135b5595b849da537e` ใน [staging run 42757513520](https://github.com/petchsnowa/coago-ride/actions/runs/42757513520) (job129635216439):

- Test Neon migration0003 สำเร็จ; deployใช้ Worker/Hyperdrive coago-line-test และ COAGO Test LINE channel/callback เดิม
- HTTPS/assets/anonymous session/LINE redirect+PKCE/readiness ผ่าน
- Anonymous search ตาม route/วันไทย พบ fixture ที่สร้างใน test DB, detail projectionไม่เปิดเผยบัญชี/owner/internal fields, การแก้ที่นั่งแสดงผ่านpublic detail และ cancelled fixture ไม่ปรากฏในsearch/detail
- Owner CRUD/auth/CSRF/replay/version checks เดิมยังผ่านผ่าน HTTP จริง
- ใช้สอง synthetic sessions โดยตรงใน test DB เพื่อสร้าง/แก้/ยกเลิก fixture; ค้นหาและดูรายละเอียดโดยไม่มี cookie ไม่ใช่ real LINE authorization อัตโนมัติ
- ล้างเฉพาะบัญชีสังเคราะห์กับ trips/sessions ผ่าน FK cascade และตรวจ cleanup สำเร็จ ไม่ลบข้อมูลของเจ้าของ

CI ของ PR ผ่านครบใน [run42757581714](https://github.com/petchsnowa/coago-ride/actions/runs/42757581714) (job129635431990) บน implementation commit เดียวกัน: frozen install/audit, lint/typecheck,108tests,build,db:generateไม่เกิดdrift,migrationsจากฐานว่าง/รันซ้ำ,PostGIS/auth/trips/discovery integration,Workers และ24browser tests

Local PostgreSQL17.11/PostGIS3.5.7 ตรวจเวอร์ชันในรอบนี้ Remote Neon18.6/PostGIS3.6.4 ยืนยันในรอบก่อนหน้า รอบนี้ตรวจเพิ่ม business discovery ผ่านเส้นทางเดิม ไม่ได้พิมพ์เวอร์ชันremoteใหม่ในlogs

ไม่ได้ยืนยัน live browserต่อremoteในรอบนี้ (รอบก่อนติด environment Chromium CA trust) จึงแยก browser mock interaction ออกจาก remote HTTP/Workers/DB proof ไม่ปิด TLS verificationเพื่อข้ามปัญหา

## Manual

เจ้าของยืนยัน Phase2B create/edit/cancel/logout/relogin แล้ว และส่งภาพค้นหา/เปิดรายละเอียดเที่ยวจริงบน COAGO Test สำเร็จหลัง merge PR #4 พบปัญหาส่วนหัว dialog เบียดกับปุ่มปิด ซึ่งแก้และเพิ่ม regression ใน [รายงาน layout](fix-trip-detail-layout.md) ยังไม่ยืนยัน manual cancelled-search flow
