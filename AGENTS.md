# Goaco — Agent Instructions

## สถานะและวัตถุประสงค์

ไฟล์นี้เป็นแนวทางเริ่มต้นสำหรับพัฒนา Goaco (ชื่อที่ใช้ในคำขอล่าสุด; บทสนทนาก่อนหน้าใช้ COAGO) โดยอิงขอบเขต Phase 1 ที่ผู้ใช้ระบุ ยังไม่มี repository หรือเอกสาร approved architecture ให้ตรวจสอบในขณะจัดทำไฟล์นี้ จึงห้ามอ้างว่าโครงสร้างและ schema ด้านล่างได้รับอนุมัติแล้ว

วางไฟล์นี้ที่ root ของ repository เป็น `AGENTS.md` การเก็บสำเนาบน Google Drive ไม่ทำให้ Codex อ่านไฟล์ใน repository ได้โดยอัตโนมัติ

## การสื่อสารและเริ่มงาน

- สื่อสารกับผู้ใช้เป็นภาษาไทย ใช้ชื่อโค้ดและ identifiers ภาษาอังกฤษตามรูปแบบของ repository
- ตรวจ working directory, Git status, branch และไฟล์จริงก่อนแก้ไข รักษาการเปลี่ยนแปลงเดิมของผู้ใช้
- อ่าน AGENTS.md ที่มีผลต่อพื้นที่งาน รวมถึงเอกสาร product, architecture, phase scope และ decision records ที่มีอยู่จริง
- ตำแหน่งเอกสารที่แนะนำ: `docs/product-brief.md`, `docs/architecture.md`, `docs/phase-1.md`, `docs/decisions/` ตำแหน่งเหล่านี้ไม่ใช่หลักฐานว่าไฟล์มีอยู่แล้ว
- ใช้คำสั่งล่าสุดของผู้ใช้เป็นบริบทการทำงาน หากข้อมูลขัดกัน ให้ระบุข้อขัดแย้งและแก้เฉพาะส่วนที่มีข้อมูลเพียงพอ
- ถ้ายังไม่มีเอกสาร ให้ร่างส่วนที่ทราบและระบุสิ่งที่ต้องตัดสินใจ ดำเนินงานที่ไม่ขึ้นกับข้อที่ขาดต่อได้ ห้ามแต่งข้อกำหนดโดเมนหรืออ้างว่าอ่านไฟล์ที่ไม่มี
- ถ้า repo มี stack หรือโครงสร้างเดิมต่างจากแนวทางนี้ ให้รายงานความต่างก่อนย้ายโครงสร้างครั้งใหญ่

## ขอบเขต Phase 1

เป้าหมายคือฐานระบบที่ติดตั้ง รัน พัฒนา และทดสอบต่อได้:

1. TypeScript monorepo พร้อม workspace configuration และ lockfile
2. React/Vite frontend พร้อมหน้าเริ่มต้นและสถานะ API
3. Hono API สำหรับ Cloudflare Workers
4. Shared packages ที่มีขอบเขต dependency ชัดเจน
5. Drizzle schema และ versioned migrations สำหรับ PostgreSQL/PostGIS ตามโมเดลที่มีข้อกำหนดจริง
6. Environment examples ที่ไม่มีข้อมูลลับ
7. CI workflows สำหรับ checks และ build
8. Liveness/readiness health checks และ initial automated tests
9. README สำหรับ setup, development, migrations และ verification
10. หลักฐานตรวจ PostgreSQL/PostGIS compatibility และ Workers database connectivity พร้อมข้อจำกัด

อย่าเพิ่มระบบ LINE Login, payments, matching, booking หรือการตรวจเอกสารเต็มระบบโดยอัตโนมัติ หากคำสั่งรอบนั้นไม่ได้รวมไว้ ห้ามสร้าง production resources, deploy production หรือรัน production migrations ตามขอบเขตปัจจุบัน

## Stack และโครงสร้าง

Stack ที่ผู้ใช้ระบุ: TypeScript, React, Vite, Hono, Cloudflare Workers, Drizzle, PostgreSQL และ PostGIS

โครงสร้างเริ่มต้นที่แนะนำเมื่อ repo ว่างและไม่มีข้อกำหนดอื่น:

```text
apps/
  web/                 # React + Vite; browser code
  api/                 # Hono + Workers; server code
packages/
  contracts/           # Browser-safe API contracts and validation
  db/                  # Server-only schema, queries and migrations
  config/              # Shared configuration when needed
.github/workflows/     # CI checks; no automatic production deployment
```

- ใช้ package manager และเวอร์ชันที่ repo เลือกไว้ หากยังไม่มี ให้เลือกหนึ่งตัว บันทึกเหตุผลและ pin เวอร์ชันใน `packageManager` พร้อมกำหนด Node.js ที่รองรับ
- ใช้ lockfile เดียวตาม workspace manager ไม่ผสม npm/yarn/pnpm lockfiles
- เลือก dependency versions ที่เข้ากันได้จริงและบันทึก compatibility date ของ Workers ใน config
- เปิด TypeScript strict mode แยก types/config สำหรับ browser และ Workers
- Browser code ห้าม import `packages/db`, server bindings หรือโมดูลที่อ่าน secrets
- ตรวจ input ที่ API boundary ใช้ contract ร่วมกันเท่าที่เหมาะสม และกำหนดรูปแบบ error response ให้คงที่
- รักษา dependency graph ให้เรียบง่าย ไม่เพิ่ม abstractions หรือ services ที่ยังไม่มีงานใช้

## Frontend

- หน้าเริ่มต้นอธิบายสถานะ Phase 1 และมีการตรวจสถานะ API
- แสดง loading, success, unavailable/error และการลองใหม่ที่เหมาะสม ป้องกัน loading ค้าง
- รองรับมือถือและ desktop ใช้ semantic HTML, labels และ keyboard interaction
- ใช้ frontend environment variables สำหรับข้อมูลสาธารณะเท่านั้น เช่น API base URL; ทุกค่า `VITE_*` ต้องถือว่าอาจเผยแพร่ถึง browser
- ห้าม hardcode database URL, private API key หรือ credentials ใน frontend
- ตั้ง CORS origins ให้สอดคล้อง development/test configuration และไม่เปิดสิทธิ์กว้างโดยไม่มีเหตุผล

## Workers API และ health checks

- ใช้ Workers-compatible APIs และ driver ตรวจ compatibility ของ dependencies ก่อนนำมาใช้
- กำหนดลักษณะ endpoints ใน API contract; default เมื่อไม่มีข้อกำหนดอื่นคือ `GET /health/live` และ `GET /health/ready`
- Liveness ตอบ 200 เมื่อ process/runtime ให้บริการได้ โดยไม่บังคับเชื่อมฐานข้อมูล
- Readiness ตรวจ dependencies ที่จำเป็นจริง เช่น database query สำเร็จ ตอบ 200 เมื่อพร้อม และ 503 เมื่อไม่พร้อม
- Health responses ต้องไม่แสดง connection strings, credentials, stack traces หรือข้อมูลส่วนบุคคล
- ตั้ง timeout/cleanup สำหรับ database checks ป้องกัน connection leaks และ request ค้าง
- ไม่เปิด detailed infrastructure diagnostics เป็น public endpoint

## PostgreSQL, PostGIS และ Drizzle

- ใช้ฐานข้อมูล test/local ที่แยกจาก production สำหรับ migrations และ integration tests
- เลือก provider, PostgreSQL/PostGIS versions และเส้นทางเชื่อมต่อจาก Workers ตาม architecture จริง ตรวจ extension availability และสิทธิ์สร้าง extension
- หากยังไม่เลือก provider/connection strategy ให้บันทึกตัวเลือกและทำส่วนที่ไม่ขึ้นกับ provider ต่อ อย่าสร้าง binding IDs หรือ credentials ปลอมให้ดูเหมือนใช้งานได้
- ใช้ Hyperdrive กับ supported driver หรือ provider-native HTTP/WebSocket driver เฉพาะเมื่อเข้ากับ architecture และ runtime จริง ระบุ configuration/compatibility flags ที่จำเป็น
- การทดสอบ driver บน Node.js ไม่ยืนยันว่า Workers เชื่อมต่อได้
- ใช้ versioned migrations; ไม่แก้ migration ที่ใช้งานแล้วเพื่อเปลี่ยนประวัติ ไม่ใช้ schema push แทน migration history ใน CI
- สร้าง schema เฉพาะ entities ที่มีข้อกำหนดจริง กำหนด constraints, foreign keys และ indexes ตาม query/ธุรกิจ ไม่เดาตารางจากชื่อแอป
- กำหนด geometry/geography, SRID และ spatial index ให้ตรง use case; longitude มาก่อน latitude สำหรับ point ใน SRID 4326
- ตรวจว่า Drizzle schema และ SQL migrations สอดคล้องกัน รวมถึง custom SQL สำหรับ PostGIS ที่ ORM ไม่ครอบคลุม
- ใช้ parameterized queries ไม่ต่อ SQL ด้วย user input
- การ reset/drop database ใช้เฉพาะ disposable test database ที่ระบุไว้ชัดเจน ห้ามรันกับฐานข้อมูลที่ไม่ทราบขอบเขต

Smoke queries ที่ใช้ยืนยัน installation ได้:

```sql
SELECT version();
SELECT PostGIS_Full_Version();
SELECT ST_AsText(ST_SetSRID(ST_MakePoint(100.5018, 13.7563), 4326));
```

Smoke queries ไม่แทน tests สำหรับ spatial behavior, indexes, constraints และ application queries จริง

## Environment และ secrets

- จัดทำ `.env.example` และ/หรือ `.dev.vars.example` ตามเครื่องมือที่ใช้ พร้อม placeholders และคำอธิบายแต่ละค่า
- Ignore ไฟล์ secrets จริง เช่น `.env`, `.env.*` และ `.dev.vars*` โดยยกเว้นไฟล์ `.example` ที่ตั้งใจ commit
- แยกค่า local/test/production ให้ชัดเจน ใช้ secrets/bindings ของ environment เมื่อเหมาะสม
- ห้ามเก็บ credentials ใน source, fixtures, screenshots, logs หรือรายงานผู้ใช้
- ไม่ขอให้ผู้ใช้ส่ง secrets ลงแชต ให้ตั้งผ่าน environment settings หรือช่องทาง secrets ที่ระบบรองรับ
- หากไม่มี test credentials ให้รายงาน integration/connectivity ว่ายังไม่ได้ตรวจ ห้ามแทนผลจริงด้วย mock แล้วรายงานว่าผ่าน

## Automated tests และการตรวจรับ

อ่าน scripts และ tooling จริงก่อนรัน ตรวจความเหมาะสมของคำสั่งกับ environment แล้วจัดทำ scripts ที่เรียกซ้ำได้เมื่อสร้าง repo ใหม่

ชุด scripts ที่แนะนำ (ต้องสร้างให้มีจริงก่อนอ้างว่ารันได้):

```text
lint
typecheck
test
build
db:generate
db:migrate
test:integration
```

- Unit tests: API contracts/validation และ logic สำคัญ
- API tests: liveness, readiness success/failure, unexpected failure และ error response ที่ไม่รั่วข้อมูล
- Frontend tests: สถานะ loading/success/error/retry และ interaction สำคัญ
- Database integration: ใช้ PostgreSQL/PostGIS จริงบน disposable database รัน migrations จากฐานว่าง ตรวจ constraints และ spatial queries ที่เกี่ยวข้อง
- Workers runtime: รัน API ด้วย Workers runtime/emulator และ configuration จริงตามที่ environment ทำได้ ตรวจ readiness ผ่านเส้นทาง driver เดียวกับแอป
- Browser checks: ลองเปิดหน้าและ interaction สำคัญทั้ง mobile/desktop หากทำไม่ได้ให้บอกข้อจำกัดเฉพาะ
- CI: ติดตั้งแบบ lockfile-enforced, รัน lint/typecheck/tests/build และ database integration ด้วย isolated PostGIS service ตามโครงสร้างที่เลือก
- กำหนด triggers สำหรับ push/pull request และ least-privilege workflow permissions; ห้ามใส่ production deployment ใน workflow เริ่มต้น
- ห้ามให้ suite ที่ไม่มี test หรือ skip integration เงียบ ๆ ทำให้รายงานเหมือนผ่านทั้งหมด
- รัน checks ที่มีทั้งหมดตามงานที่ผู้ใช้ขอ แก้ failures ที่เกี่ยวกับงาน และแยก failures เดิม/ข้อจำกัด environment ออกจากผลที่ผ่าน

## เกณฑ์รายงาน connectivity

รายงานหลักฐานแยกตามชั้น ไม่ใช้ผลชั้นหนึ่งแทนอีกชั้น:

1. Static checks/build: types และ bundle ผ่าน
2. Unit tests with mocks: พฤติกรรมตาม test ผ่าน แต่ยังไม่พิสูจน์การเชื่อมต่อ
3. PostgreSQL/PostGIS integration: queries/migrations ผ่านบนฐานข้อมูลจริงที่ระบุเวอร์ชัน
4. Local Workers runtime: API ติดต่อ test database ได้ผ่าน driver/bindings ที่ใช้จริง
5. Remote Workers connectivity: ยืนยันได้เฉพาะเมื่อทดสอบจาก remote runtime จริงที่ได้รับอนุญาต

หากชั้นที่ 5 ต้องใช้ resource ที่ยังไม่ได้รับอนุญาตหรือยังไม่มี ให้รายงานว่ายังไม่ตรวจ ดำเนินงาน local และ static checks ต่อได้ ห้าม deploy production เพื่อทำให้ checklist ครบ

## Git, เอกสาร และส่งมอบ

- ทำ changes ให้ตรงขอบเขต รักษา unrelated changes ไม่ใช้ destructive reset/clean เพื่อจัดพื้นที่ทำงาน
- ไม่ push/merge/publish หรือเปลี่ยนสิทธิ์ภายนอกหากอยู่นอกคำสั่งที่ได้รับ
- อัปเดต README ให้มี prerequisites, setup, environment variables, dev commands, migration commands, tests และ known limitations ตามที่มีจริง
- บันทึกข้อเลือกสำคัญพร้อมเหตุผลใน docs/decisions ตามความจำเป็น แยก Draft ออกจาก Approved
- ส่งรายงานภาษาไทยที่ระบุ: สิ่งที่เปลี่ยน, วิธีรัน, ผลแต่ละ check เป็น ผ่าน/ไม่ผ่าน/ไม่ได้รัน, หลักฐาน PostgreSQL/PostGIS และ Workers ที่ตรวจได้, ข้อจำกัดและงานถัดไป
- อย่าอ้างว่า deploy แล้วหรือ connectivity ผ่านหากไม่ได้ทำจริง

## งานหลัง Phase 1

Phase 1 รวมเข้า main แล้ว งานรอบ LINE Login ที่เจ้าของเลือกและเตรียม COAGO Test ให้ใช้ขอบเขตใน docs/phase-2-line-login.md ทำเฉพาะ auth และ staging แยก ไม่เพิ่ม booking/production โดยอัตโนมัติ คงหลักการตรวจจริงและไม่เปิดเผย secrets ตามเดิม

## Phase 2B — ประกาศเที่ยว

หลังเจ้าของรวม PR #2 และสั่งเริ่มงาน ให้ทำขอบเขตใน docs/phase-2b-trips.md: สร้าง/ดู/แก้ไข/ยกเลิกเฉพาะเที่ยวของตน ใช้ COAGO Test staging เดิม ตรวจสิทธิ์ CSRF, idempotency และ version conflicts ยังไม่เพิ่ม search/booking/payments หรือ production โดยอัตโนมัติ

## Phase 2C — ค้นหาและรายละเอียด

เจ้าของรวม PR #3 และสั่งให้เริ่มขอบเขตใน docs/phase-2c-discovery.md ค้นหาเส้นทาง/วันไทยและดูรายละเอียดเฉพาะเที่ยวที่ยังเปิดและอยู่ในอนาคต Public DTO ต้องไม่เปิดเผย owner/LINE/session/internal fields แยกจาก owner API คงตรวจจริงบน COAGO Test เดิม ไม่เพิ่ม booking/payments/production โดยอัตโนมัติ

## Phase 2D — เริ่มคำขอร่วมเดินทาง

เจ้าของให้เริ่มระบบส่งคำขอโดยยังไม่ merge PR #6 ให้ทำต่อบน branchเดิมตาม docs/phase-2d-ride-requests.md เฉพาะpending/cancelled 1ที่นั่งต่อคำขอ ดูของตน/ยกเลิก และเจ้าของดูincoming ยังไม่ตอบรับ/ปฏิเสธ/หักที่นั่ง/ชำระเงิน ไม่ปรับดีไซน์ต่อและไม่mergeหรือproductionโดยอัตโนมัติ

## Phase 2E — ตอบรับคำขอและจัดสรรที่นั่ง

เจ้าของสั่งดำเนินการหลังทดสอบส่ง/ยกเลิกคำขอแล้ว ให้ทำต่อบน PR #6 ตาม docs/phase-2e-decisions.md แทนข้อจำกัด pending-only ของ Phase 2D: เจ้าของตอบรับ/ปฏิเสธ หักที่นั่งเมื่อ accepted และคืนเมื่อยกเลิกก่อนออกเดินทาง ล็อก trip ใน transaction ป้องกัน overbooking/retry ซ้ำ เก็บ snapshot เงื่อนไขและตรวจ content version ไม่แก้ข้อตกลงเมื่อมีผู้ตอบรับแล้ว ยังคง Draft ไม่ merge ไม่ production และไม่เพิ่มการชำระเงิน

## เตรียม production

หลัง PR #6 merged เจ้าของยืนยัน manual acceptance/refund ผ่านและเลือก coago.space เดิม พร้อมอนุญาตสร้างฐาน production ใหม่แยกจาก test ใช้ขอบเขต/สถานะจริงใน docs/production-launch.md ห้ามอ้างว่าสร้าง Neon แล้วหากยังไม่มีสิทธิ์เข้า ทำ readiness/runbook ต่อบน branch/PR ใหม่ ไม่ merge/deploy/migrate production/DNS โดยอัตโนมัติ ตรวจและเตรียม config ที่ review ได้ก่อนการเปิดจริง

## สร้างตาราง production ฐานใหม่

หลัง read-only run42776963156 ผ่าน (PostgreSQL18.6/PostGIS3.6.4, appTables0) เจ้าของสั่งให้ทำต่อเพื่อสร้างตาราง อนุญาตเตรียม/รัน bootstrap migrations0000–0006 เฉพาะ Direct host ep-restless-brook-a12zmjkb.ap-southeast-1.aws.neon.tech / neondb ของ coago-production ที่ตรวจแล้ว ขั้นเขียนต้องเป็น manual workflow จาก main, แยกจาก read-only check, ปฏิเสธฐานที่มีข้อมูล/objectsนอกขอบเขต ไม่ merge/deploy/DNS โดยอัตโนมัติ ไม่แก้ guard local/test ของ db:migrate และไม่คัดลอกข้อมูล test

## เชื่อม Hyperdrive production

หลัง bootstrap production run42790784081 ผ่าน เจ้าของอนุญาตเชื่อมฐาน ให้ทำ manual workflow แยกสำหรับ coago-production-db บนบัญชี/Direct hostเดิมที่ตรวจแล้ว ใช้ authenticated remote preview กับ read-only metadata/spatial SQL แล้วหยุดpreview เก็บ Hyperdriveไว้ให้แอปขั้นถัดไป ไม่ update/delete configurationเดิม ไม่deployเว็บ/แก้DNS/LINEจากคำสั่งเชื่อมฐานนี้ ต้อง pin ID ก่อน reuse และตรวจ origin/cache disabled ทุกครั้ง

## เตรียมเว็บ production ก่อนสลับโดเมน

เจ้าของเพิ่ม production Hyperdrive ID, LINE_CHANNEL_ID2009685358 และแจ้งว่าบันทึก LINE secret ใน production แล้ว ให้เตรียม manual Worker deploy ชื่อ coago-production บน workers.dev โดยคง APP_ORIGIN/callback coago.space, ไม่แก้DNS/LINE Console ไม่migrateหรือเขียนข้อมูลจากsmoke ปิด auth/private reads/writes บน hostนอกcanonicalก่อนstoreเข้าถึง ใช้owner markerก่อนupdateWorkerเดิม และหยุดprepareหากcoago.spaceตอบreleaseheaderว่าแอปliveแล้ว คงให้เจ้าของmerge/Run workflowเองตามรูปแบบเดิม

## Root Admin ก่อนเผยแพร่

เจ้าของยืนยันขอบเขต dashboard, users/trips moderation, ride requests read, service/registration switches, audit และ LINE owner root เท่านั้น ให้ทำบน branch/PR ใหม่ ตรวจ local/CI ก่อน ไม่ merge/deploy/migrate production/เปลี่ยน DNS โดยอัตโนมัติ ย้าย static assets เป็น asset-first เพื่อ Free Workers คง default service/registration closed และห้าม first-user root. รายละเอียด docs/root-admin.md.

## แยก Root และ Admin

เจ้าของขอ Root แต่งตั้ง/ถอนสิทธิ์และจัดการ Admin ได้ทั้งหมด เพิ่มบทบาท admin ของสมาชิก LINE ที่ตรวจแล้ว ส่วน Root ยังเป็น secret allowlist ไม่ใช่ role ที่ตั้งผ่าน API. Admin ดูแลผู้ใช้ทั่วไป/เที่ยว/คำขอ/audit แต่จัดการRoot/แอดมินด้วยกัน/ตั้งrole/เปิดปิดบริการไม่ได้. ทุก role/status mutation ใช้version+reason+audit+sessionrevocation และตรวจ backend. เตรียม migrationใหม่/PR ไม่deployหรือmigrate production อัตโนมัติ.
