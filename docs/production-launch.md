# เตรียมเปิด COAGO บน coago.space

สถานะ ณ 10 พฤศจิกายน 2026 (เวลาไทย): **ยังไม่ได้ deploy production หรือเปลี่ยน DNS** เจ้าของเลือก coago.space เดิมและสั่งสร้างฐาน production ใหม่แยกจาก test ไม่คัดลอกผู้ใช้/เที่ยว/คำขอทดสอบ

## หลักฐานและรายการที่ยังต้องทำ

| ส่วน | สถานะจริง | สิ่งที่เหลือ |
| --- | --- | --- |
| Manual สองบัญชี | เจ้าของยืนยัน LINE Login/ส่ง/ดู/ยกเลิกก่อนหน้า และยืนยันตอบรับพร้อมคืนที่นั่งถูกต้องรอบนี้ | ทดลองปฏิเสธพร้อมเหตุผลด้วยบัญชีจริง; automated rejection ผ่านแล้ว |
| Code review | PR #6 merged แล้ว; main `0ea43cc914f13658f9a2d5df7d20fb5482a8b6b0` | ตรวจ PR เตรียม production รอบใหม่ แยกจาก PR #6 |
| ฐาน production | เจ้าของแจ้งว่าสร้าง project coago-production ใหม่แล้ว; agent ยังไม่มีสิทธิ์ตรวจ config/ข้อมูลใน Neon | ตรวจว่าเป็นฐานเปล่าแยกจาก coago-test, ไม่ตั้ง auto-delete; เปิด/ตรวจ PostGIS และ backup/restore |
| LINE production | มี channel เดิมจากประวัติ; ไม่ได้อ่านค่าปัจจุบันและยังไม่เปลี่ยน | ตรวจ channel ID/secret/Published/callback ให้ตรง coago.space |
| Worker/โดเมน | เว็บ staging ผ่าน; ยังไม่เปลี่ยนเส้นทางเดิมของ coago.space | สำรวจ Worker/route/DNS เดิม, เตรียม config แยก, เลือก cutover/rollback |
| การดูแลผู้ใช้ | มี auth/CSRF/privacy projections และสถานะ API | ยืนยันผู้รับผิดชอบ/ช่องทางติดต่อ, privacy/terms/retention, error monitoring, ทดสอบกู้คืน |

CI code เดิมผ่าน [42769101809](https://github.com/petchsnowa/coago-ride/actions/runs/42769101809); proof-doc head ผ่าน [42769807143](https://github.com/petchsnowa/coago-ride/actions/runs/42769807143) และ [42769799556](https://github.com/petchsnowa/coago-ride/actions/runs/42769799556) Remote decisions ผ่าน [42769095880](https://github.com/petchsnowa/coago-ride/actions/runs/42769095880) ดูรายละเอียด [ผลตรวจ](verification-phase-2e.md)

## สร้างฐานเปล่า

1. Neon → New project → `coago-production`; Singapore หากมีและเหมาะกับผู้ใช้ไทย เลือก PostgreSQL ที่รองรับ PostGIS (code ทดสอบแล้วบน17และ18) ไม่เพิ่ม paid plan โดยอัตโนมัติ
2. ใช้ branch production ที่ไม่หมดอายุ ตรวจว่าไม่มี auto-delete; **ไม่ clone coago-test** ฐาน test เดิมตั้งลบอัตโนมัติ7วันตั้งแต่9พ.ย.2026
3. ใช้ Direct endpoint สำหรับ migrations/Hyperdrive origin ให้ Hyperdrive จัดการ pooling ของแอป ปิด Hyperdrive query caching เพราะสถานะที่นั่ง/คำขอต้องอ่านล่าสุด
4. ตรวจ PostGIS ด้วย SQL ต่อไปนี้ใน production project ใหม่เท่านั้น หลังตรวจชื่อ project/branch ชัดเจน:

   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   SELECT version();
   SELECT PostGIS_Full_Version();
   ```

5. เก็บ Direct URL ใน GitHub Environment `production` secret `COAGO_PRODUCTION_DATABASE_URL` และ LINE secret ใน `LINE_CHANNEL_SECRET` ของ environment นี้ ไม่ส่งลง chat/commit และไม่ทับ test secrets
6. ก่อน migrate ต้องมี production migration path แยกที่ตรวจ project/branch/host ที่ยืนยันไว้ และได้รับอนุญาตรันกับฐานใหม่ คำสั่ง `pnpm db:migrate` ปัจจุบันจำกัด local/test โดยตั้งใจ **อย่าถอด guard เพื่อใช้กับ production** และอย่าใช้ staging/deploy.ts (มี guard test channel/test database)
7. ใช้ migrations0000–0006กับฐานเปล่าและตรวจ migration journal/constraints/seat invariants ไม่มีการ import users/trips/ride_requests จาก test

เจ้าของแจ้งว่าสร้าง project `coago-production` ผ่าน console แล้วในวันที่10พ.ย.2026 ยังไม่ยืนยัน PostGIS/version/auto-delete/backup settings และยังไม่ได้ migrate schema ไม่มีสิทธิ์ Neon ของ agent จึงไม่อ้างว่าได้ตรวจภายในหรือเชื่อมฐานใหม่แล้ว

## ค่าที่ต้องกำหนดก่อนเตรียม deploy จริง

| ค่า | ที่เก็บ/เงื่อนไข |
| --- | --- |
| APP_ORIGIN | `https://coago.space` |
| LINE_CALLBACK_URL | `https://coago.space/api/auth/line/callback` ต้องตรง LINE Console |
| LINE_CHANNEL_ID | channel production ที่เจ้าของยืนยัน ไม่ใช่ COAGO Test `2012503801` |
| LINE_CHANNEL_SECRET | Cloudflare Worker secret + GitHub production Environment secret |
| ENVIRONMENT | `production` เพื่อบังคับใช้ Hyperdrive ไม่รับ DATABASE_URL fallback |
| HYPERDRIVE | configuration ใหม่ที่ชี้ฐาน production เท่านั้น ไม่มี test ID |
| ALLOWED_ORIGINS | ว่างสำหรับ same-origin; ไม่ใช้ wildcard |
| Cloudflare account/Worker name | ตรวจทรัพยากรเดิมก่อนเลือกชื่อใหม่ ห้ามทับ Worker เดิมโดยไม่ตรวจ |
| VITE_API_BASE_URL | ว่าง ใช้ same-origin `/api`; build ไม่ใส่ secrets |

ต้องเตรียม production deploy แยกแบบ manual และเผย diff ของ config/migrations/route ให้ตรวจได้ก่อน cutover ไม่มี production auto-deploy เพิ่มในรอบนี้ assets ต้อง run_worker_first เพื่อ API และ headers ไปทาง Worker; staging ปัจจุบันยังแสดงป้ายเว็บทดสอบ ต้องเตรียมข้อความตาม environment ก่อนเปิดจริง

## สำรอง/กู้คืนและ rollback

- ตรวจแผน Neon จริง: restore history, retention, ขนาด/compute, ค่าใช้จ่าย/limits และเจ้าของรับผิดชอบ ไม่ถือว่า Free plan เป็น backup policy ที่เพียงพอโดยอัตโนมัติ
- กำหนด RPO/RTO กับเจ้าของ; ทำ encrypted backup ที่จำกัดผู้เข้าถึง และทดลอง restore ไปฐานชั่วคราวที่ระบุชื่อชัดเจนก่อนเปิด ใช้ PostgreSQL client major ไม่น้อยกว่า server, TLS verification และ connection service/secret store ไม่ใส่รหัสใน command line
- กู้คืนต้องตรวจ PostGIS, migration journal, users/trips/requests และ `seats_booked = count(accepted)` ต่อเที่ยว ลบเฉพาะฐานชั่วคราวหลังตรวจแล้ว ไม่ restore ทับ production เพื่อทดลอง
- เก็บ commit/Worker deployment ID และ routing/DNS เดิมก่อน cutover หาก API/LINE/ที่นั่งผิด ให้หยุดเปิดรับผู้ใช้ใหม่และคืน Worker/route ตามแผนที่ตรวจไว้ก่อน ห้ามย้อน Worker กลับไปก่อน0006 เพราะ code เก่าไม่รองรับ accepted และอาจแก้เที่ยวที่มีผู้ตอบรับแล้ว
- อย่า drop columns/rollback schema หรือ restore backup ลงฐาน live ระหว่างผู้ใช้ส่งคำขอ ให้กำหนด write freeze และแผนกู้ข้อมูลที่ชัดเจนก่อน

## Privacy/terms และดูแลผู้ใช้

ข้อมูลที่ code ใช้อยู่: LINE subject ID/ชื่อแสดง, session hashes/CSRF/expiry, OAuth flow metadata, เที่ยว/ข้อเสนอ snapshot, คำขอและเหตุผลปฏิเสธ Public API ไม่เปิด LINE ID, owner ID, passenger identity หรือ sessions; ชื่อผู้ส่งคำขอให้เจ้าของเที่ยวเห็นใน private incoming เท่านั้น ไม่มีระบบชำระเงิน/ยืนยันเอกสารผู้ขับขี่/เปิดข้อมูลติดต่อในขอบเขตนี้

ก่อนเผยแพร่นโยบายต้องให้เจ้าของยืนยันชื่อผู้ควบคุมข้อมูล ช่องทางติดต่อ วัตถุประสงค์/ฐานการประมวลผล ระยะเก็บ/การลบและสิทธิผู้ใช้ บริการภายนอก LINE/Cloudflare/Neon และที่ตั้งข้อมูล ไม่สมมติว่ามีนโยบายหรือ retention ที่ยังไม่ได้ตัดสินใจ ปัจจุบันยังไม่มี API ลบบัญชี; ห้าม cascade accepted requests โดยไม่คืน seats_booked

กำหนดผู้รับแจ้งเหตุและช่องทางรายงาน, ตรวจ readiness/อัตรา5xx/latency/LINE failure/quota พร้อมแนวทางรับเหตุ Logs ต้องไม่เก็บ cookie, Authorization, callback code/state, LINE token/secret, DB URL หรือเนื้อหาคำขอส่วนบุคคล Staging ปิด observability อยู่ จึงห้ามอ้างว่า production monitoring พร้อมแล้ว

## ตรวจหลัง deploy (อ่านอย่างเดียว)

```sh
pnpm release:check https://coago-line-test.akkarapatchara.workers.dev
# หลัง production deploy ที่อนุญาตแล้วเท่านั้น:
pnpm release:check https://coago.space
```

ตรวจ HTTPS (ไม่ follow redirects), homepage/JS/CSS, live/ready, anonymous auth, private endpoints401/no-store, public field projection/ที่นั่งว่าง>0 และ API security headers/CORS ใช้ anonymous GET เท่านั้น ไม่เริ่ม OAuth ไม่สร้าง session ไม่แก้ข้อมูล ไม่แสดง response bodies/ข้อมูลผู้ใช้ใน output Exit1 หากมีข้อใดไม่ผ่าน

ผลผ่านไม่ได้ยืนยัน LINE Login จริง, Cookie ของ authenticated session, backup/restore, ค่าใช้จ่าย, privacy/terms, ความปลอดภัยของผู้เดินทาง หรือสิทธิ production configuration ต้องทดลอง manual สองบัญชีหลัง cutover อีกครั้ง ปัจจุบัน staging มี smoke ที่เขียนข้อมูลจำลองแยกอยู่; **ห้ามนำ staging synthetic smoke มารันกับ production**

## ผลตรวจเครื่องมือรอบนี้

10พ.ย.2026 รัน `release:check` กับ COAGO Test ผ่าน9รายการจริง (TLS verification เปิดอยู่; workspace ใช้ `NODE_USE_ENV_PROXY=1` ตาม proxy ของ environment) ไม่มี write/session/OAuth flow จาก checker เพิ่ม15 unit cases ตรวจ false positives เช่น private API หลุด200, public identity field, full/expired trips, permissive CORS, cross-origin assets และ network failures

## ตรวจรอบหลัง PR #7 merged

10พ.ย.2026 เจ้าของยืนยันว่า PostGIS ใน coago-production รันสำเร็จแล้ว และ coago-test เดิมยังอยู่โดยไม่เปลี่ยนรหัสผ่าน เป็น owner-reported evidence ยังไม่ได้ยืนยัน Direct connection ของ production จาก runner

ตรวจ HTTPS ของ coago.space และ www.coago.space ได้ HTTP521 (TLS verificationผ่าน) DNS NS เป็น chance.ns.cloudflare.com และ georgia.ns.cloudflare.com ข้อมูลนี้ไม่ยืนยันค่า DNS record/Worker routes หลัง Cloudflare หรือสาเหตุ origin ที่แน่นอน ยังไม่เปลี่ยนค่าใด เว็บ staging เปิด assets/auth ได้ แต่ health/ready และ public upcoming เป็น503ซ้ำ ต้องตรวจ Direct DB และ Hyperdrive ต่อ ไม่ถือว่าพร้อม production

เพิ่ม workflow `Database readiness (read only)` เพื่อวินิจฉัย:

- push เฉพาะ branch codex/database-readiness ตรวจ test Direct DB ด้วย BEGIN READ ONLY และ GET metadata ของ Worker coago-line-test/Hyperdrive เดิม ไม่ deploy/update/create resource, ไม่ migrate และไม่อ่านข้อมูลผู้ใช้เป็นรายแถว
- หลังไฟล์เข้า main: Actions → Database readiness (read only) → Run workflow → target production → project_confirmation `coago-production` ตรวจเฉพาะ production Direct DB ใน read-only transaction
- Production run ต้องเลือก main และใช้ GitHub Environment `production`: secret `COAGO_PRODUCTION_DATABASE_URL`, variables `COAGO_PRODUCTION_DATABASE_HOST` (Direct hostnameเท่านั้น) และ `COAGO_PRODUCTION_DATABASE_NAME` (ชื่อฐานเช่น neondb) พร้อม repository test secret เดิมเพื่อป้องกันชี้ host test ซ้ำ
- สคริปต์ตรวจ host/databaseตรงค่าที่เจ้าของตรวจจาก Neon Console แต่ไม่สามารถพิสูจน์ชื่อ project/branch ด้วย Neon API ต้องตรวจว่า Connect เปิดจาก coago-production ก่อนบันทึก secret
- ไม่ใช้ DATABASE_URL fallback, ไม่รับ pooler/unencrypted TLS/portอื่น และตรวจ TLS certificate จริง แสดงเพียง version/จำนวนตารางแอป/จำนวน migrations ไม่มี URL/password/rows ข้อผิดพลาดแสดงเฉพาะcodeที่กรองแล้ว

ตั้งค่าที่ repository → Settings → Environments → New environment → production แล้ว Add environment secret/variables ตามชื่อข้างต้น คัดลอกเฉพาะ URL `postgresql://...` จาก Neon Connect → Direct ไม่คัดลอกคำสั่ง psql ทั้งบรรทัดและไม่ส่ง URL ลง chat หลังตรวจเชื่อมสำเร็จจึงเตรียม production migration/bootstrap เป็นขั้นแยกที่ review ได้ ไม่มี production migration ใน workflow นี้

ผลวินิจฉัยจริงจาก [Database readiness run42773976749](https://github.com/petchsnowa/coago-ride/actions/runs/42773976749): Direct test connection ล้มด้วย PostgreSQL SQLSTATE **28P01** (ข้อมูล authentication ถูกปฏิเสธ) ส่วน binding metadata มีอยู่, origin host/database/user ตรง test secret และ cachingDisabled=true ไม่มีการแก้ binding/password หรือ deploy จากการตรวจนี้ แม้เจ้าของไม่ได้เปลี่ยนรหัสผ่าน ข้อมูลใน secret ที่ใช้จริงยังไม่ผ่าน authentication ต้องคัดลอก Direct URL จาก coago-test ใหม่ลง repository secret COAGO_TEST_DATABASE_URL แล้วรัน LINE Login staging workflow เดิมจาก main เพื่ออัปเดต Hyperdrive password และตรวจจริงอีกครั้ง อย่าทับด้วย URL ของ production

เพิ่ม GET-only audit ของ coago.space zone/DNS record metadata/Worker routes ใน diagnostic job ไม่พิมพ์ origin IP/content หรือเปลี่ยนเส้นทาง หาก token เดิมอ่านไม่ได้ให้รายงาน access limitation ไม่ขยายสิทธิ์โดยอัตโนมัติ ผล DNS record/route ยังต้องรอ runner ตรวจ ไม่ใช้ HTTP521 เดาสาเหตุ origin ที่แน่นอน

ผล GET-only domain audit จาก [run42774467234](https://github.com/petchsnowa/coago-ride/actions/runs/42774467234): zone `coago.space` มีสถานะ **active** แต่การอ่าน DNS records ถูกปฏิเสธ HTTP403/Cloudflare10000 ด้วย token ปัจจุบัน จึงยังไม่ได้อ่าน records/Worker routes และไม่ทราบ origin ปัจจุบัน ไม่แก้หรือลบ recordsจากการคาดเดา ความผิดพลาดของ diagnostic run เป็นผลตรวจระบบ/สิทธิ์จริง ไม่ใช่ผล unit tests ที่ถูกแทนด้วย mock

ต้องอัปเดต test Direct secret และตรวจ DNS ปัจจุบันผ่าน Cloudflare Console หรือสิทธิ์อ่านเฉพาะ zone coago.space ก่อนเตรียม cutover คงไม่มี production migration/deploy/DNS changes และไม่ถือว่า readiness ผ่านจากการที่ code CI ผ่าน

Validation ของ code commit a70d0b7e69c1b16d79f72d03a038ec814001d520: local lint/typecheck,172 unit/API/guard tests และ real PostgreSQL/PostGIS read-only integration ผ่าน; [CI42774467246](https://github.com/petchsnowa/coago-ride/actions/runs/42774467246) ผ่านทั้ง install/audit/build/migrations/integrations/Workers และ46 browser tests ผล CI นี้ไม่ได้ยกเลิกข้อผิดพลาดระบบจริง28P01/521/สิทธิ์DNSข้างต้น

## URL validation diagnostics

ช่วงแรกของ production read-only run42776963156 ยังไม่ถึง database connection เพราะ URL validation ล้มเหลว หลังเจ้าของแก้ค่าหลายครั้ง errorเดิมรวมหลายสาเหตุจึงระบุ field ไม่ได้ (ผลล่าสุดเชื่อมสำเร็จแล้ว ดูส่วน bootstrap ด้านล่าง) เพิ่ม static codes แทน errorรวม โดยไม่ผ่อน guard หรือพิมพ์ URL/password:

| Code | ตรวจจุดนี้ |
| --- | --- |
| NEON_URL_SCHEME_REQUIRED | ใช้ URL postgres/postgresql จาก Connect ไม่ใช่เว็บ HTTPS |
| NEON_HOST_REQUIRED | Host ต้องเป็น Direct Neon endpoint ลงท้าย .neon.tech |
| NEON_DIRECT_HOST_REQUIRED | Host ยังมี -pooler; ปิด pooling แล้วคัดลอกใหม่ |
| NEON_CREDENTIALS_REQUIRED | URL ขาด username หรือ password |
| NEON_DATABASE_NAME_REQUIRED | URL ขาดชื่อฐานหลัง / |
| NEON_TLS_REQUIRED | Query ต้องมี sslmode=require หรือ verify-full; ยังตรวจ certificate จริง |

การ rerun runเก่าใช้ code commitเดิม แม้ secretถูกอ่านใหม่ หลัง mergeการปรับนี้ต้องเริ่ม **Run workflow ใหม่จาก main** เพื่อใช้ diagnostics ใหม่ ไม่ใช้ Re-run ของ runเดิมในการตรวจcodeใหม่ ไม่มีการเชื่อม production หรือแก้ข้อมูลจากการปรับerror messagesนี้

## สร้างตารางใน production ใหม่ (หลังตรวจเชื่อมสำเร็จ)

ล่าสุด [read-only run42776963156](https://github.com/petchsnowa/coago-ride/actions/runs/42776963156) job129735088863 ผ่านจริง: PostgreSQL18.6/PostGIS3.6.4, appTables0, migrations=null หลังแก้ Environment ให้ตรง `production` และ Direct HOST ตรงกับ secret ปัญหา URL ก่อนหน้าจึงไม่ใช่ผลล่าสุด ไม่อ้างว่าได้สร้างตารางจาก read-only run นี้ เจ้าของสั่งดำเนินการสร้างตารางต่อแล้ว

เพิ่ม workflow **Production database bootstrap** แบบ workflow_dispatchเท่านั้น ไม่มี push trigger ใช้ main และ Environment production เดิม เลือก operation `check` เพื่ออ่านอย่างเดียว หรือ `bootstrap` เพื่อสร้างตาราง ยืนยัน project_confirmation `coago-production` ไม่ต้องเพิ่ม secret ใหม่

เป้าหมายถูก pin ซ้ำในโค้ดกับ hostที่เจ้าของให้และตรวจผ่านแล้ว `ep-restless-brook-a12zmjkb.ap-southeast-1.aws.neon.tech` ฐาน `neondb` นอกเหนือจาก guard host/database/TLS/แยกtestเดิม จึงไม่สามารถเปลี่ยน variable เพื่อให้สคริปต์เขียนไป hostอื่นโดยเงียบๆ

ก่อนเขียนตรวจ PostGIS และ non-extension relations ของทุก user schema, ยอมให้เฉพาะฐานเปล่าหรือ empty Drizzle journal ที่ค้างจาก migration failure ใช้ advisory lockร่วมกับ workflow concurrency จากนั้นใช้ Drizzle migrator เดิมกับ migrations0000–0006 ตรวจ hash/timestamps7รายการ, ตาราง8รายการว่าง และ constraints/columnsสำคัญ ไม่มีการ import test rows หรือสร้างผู้ใช้จำลอง

รันซ้ำบนฐานที่สร้างครบและยังว่างจะรายงาน already_initialized โดยไม่ migrate เพิ่ม ถ้ามีข้อมูลผู้ใช้/เที่ยว/คำขอ หรือ objectอื่น/historyไม่ตรง ให้หยุด ไม่มี drop/truncate/reset หาก migrationSQLล้มเหลว Drizzle rollback application migrations+historyทั้งหมด แต่ empty journal infrastructureอาจคงอยู่ สามารถลองใหม่หลังแก้สาเหตุโดยไม่ลบอะไร หาก post-migration verificationล้มเหลว ให้หยุดตรวจด้วยคน ไม่ถือว่าฐานพร้อมหรือ rollback schemaที่อาจสร้างสำเร็จแล้วโดยอัตโนมัติ

หลัง workflowเข้า main ให้ Actions → Production database bootstrap → Run workflow → main → operation bootstrap → project_confirmation coago-production → Run workflow ต้องเห็น `PRODUCTION_BOOTSTRAP_RESULT` migrations7/appTables8 และ PASS ก่อนเตรียม Hyperdrive/Worker ของproduction ขั้นนี้ไม่ deployเว็บ ไม่แก้ DNS/LINE และไม่ทำให้ coago.space ที่ยัง521เปลี่ยนปลายทาง
