# COAGO · ไปด้วยกัน

เชื่อมคนที่ต้องการเดินทางต่างจังหวัดกับผู้ขับขี่ที่มีที่นั่งว่าง

**Phase 2A:** เพิ่ม LINE Login สำหรับช่อง COAGO Test แยกจากเว็บเดิม ยังไม่เปิดรับจองและไม่มี production deployment

## เอกสาร

- [แนวทางทำงาน](AGENTS.md)
- [เป้าหมายผลิตภัณฑ์](docs/product-brief.md)
- [Architecture](docs/architecture.md)
- [ขอบเขต Phase 1](docs/phase-1.md)
- [ผลตรวจจริง](docs/verification-phase-1.md)
- [ผล remote Hyperdrive และวิธีทดสอบ](docs/remote-hyperdrive.md)
- [ขอบเขต LINE Login และการทดสอบ](docs/phase-2-line-login.md)
- [ผลตรวจและ URL ทดสอบ LINE Login](docs/verification-line-login.md)

## เตรียมเครื่อง

ใช้ Node.js **24.22.1**, pnpm **11.25.0**, Docker พร้อม Compose สำหรับฐานข้อมูลทดสอบ เวอร์ชัน dependencies ที่แน่นอนอยู่ใน package manifests และ pnpm-lock.yaml

```sh
pnpm install --frozen-lockfile
cp .env.example .env
cp apps/api/.dev.vars.example apps/api/.dev.vars
docker compose up -d --wait
pnpm db:migrate
pnpm dev
```

เปิด frontend ที่ http://localhost:5173 และ API ที่ http://localhost:8787/health/live หากทำงานใน cloud ให้ใช้ preview/port forwarding ของ environment แทน localhost บนเครื่องตัวเอง

Frontend ใช้ Vite proxy ไป Workers API ถ้าต้องใช้คนละ origin ให้ตั้ง public VITE_API_BASE_URL และ server ALLOWED_ORIGINS ให้ตรง origin ของเว็บ

Credentials ใน Compose และไฟล์ตัวอย่างเป็นข้อมูลสังเคราะห์สำหรับ disposable local test เท่านั้น ไฟล์ค่าจริงถูก ignore จาก Git ห้ามเปลี่ยนเป็น credentials production

## Checks

```sh
pnpm audit
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:generate
pnpm db:migrate
pnpm db:migrate
pnpm test:integration
pnpm test:workers
pnpm test:auth:integration
pnpm test:trips:integration
pnpm test:auth:workers
pnpm exec playwright install chromium
pnpm test:browser
```

- `pnpm build` สร้าง web bundle และ **Wrangler dry run** เท่านั้น ไม่มี upload/deploy
- `pnpm test` เป็น unit/API/UI tests รวม failure และ timeout ด้วย mocks
- `pnpm test:integration` ใช้ PostgreSQL/PostGIS จริง ต้อง migrate ก่อน ไม่ skip เมื่อไม่มี config ตรวจ versions, spatial expression, Drizzle read/write, constraint และ query timeout
- `pnpm test:workers` ต้อง build API ก่อน ใช้ Miniflare/workerd รุ่นเดียวกับ Wrangler ตรวจ API ถึง PostgreSQL จริงผ่าน pg TCP และกรณี DB ใช้ไม่ได้
- `pnpm test:browser` เปิด Chromium ทดสอบ layout และ interaction บน mobile/desktop โดย mock health response จึงไม่ใช่หลักฐาน DB connectivity
- CI รัน checks เดียวกันพร้อม isolated PostGIS service ไม่มี production secrets/deploy

## ฐานข้อมูลและ migrations

`packages/db/src/schema.ts` เริ่มจาก `system_metadata` และ migration เปิด PostGIS extension Phase 2A เพิ่ม schema auth ใน migration 0001 และ Phase 2B เพิ่ม trips ใน migration 0002; booking ยังไม่รวมในรอบนี้

หลังแก้ schema ให้รัน `pnpm db:generate` ตรวจ SQL และ journal ที่ generate จริง หากเป็น custom SQL เช่น extension ให้ใส่ใน versioned migrations อย่างถูกต้อง ไม่แก้ migration ที่ใช้แล้วเพื่อเปลี่ยนประวัติ

`pnpm db:migrate` และ test scripts รับ DATABASE_URL จาก .env หรือ environment โดยจำกัด host เป็น localhost/127.0.0.1/db และชื่อฐานลงท้าย `_test` เพื่อกันชี้ production ผิด ห้ามใช้ schema push แทน migration history

Compose ผูก DB ที่ **127.0.0.1:54329** และเก็บข้อมูลใน tmpfs จึงเป็นฐานข้อมูลทิ้งได้ ไม่ใช้เก็บข้อมูลจริง:

```sh
docker compose stop
# เริ่ม container เดิมอีกครั้ง ข้อมูลอาจหายเพราะ tmpfs; รัน migration ใหม่
docker compose up -d --wait
pnpm db:migrate
# ลบเฉพาะ services ของโปรเจกต์นี้เมื่อต้องการเริ่มฐานใหม่
docker compose down
```

อย่าใช้ Docker prune หรือคำสั่งลบรวมกับงานอื่น

## Environment variables

| ค่า               | สถานที่                                                              | หมายเหตุ                                                              |
| ----------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| DATABASE_URL      | root .env สำหรับ scripts และ apps/api/.dev.vars สำหรับ local Workers | Secret, local/test เท่านั้น                                           |
| ENVIRONMENT       | Wrangler vars                                                        | local/test อนุญาต direct test URL; environment อื่นต้องใช้ Hyperdrive |
| ALLOWED_ORIGINS   | Wrangler vars                                                        | Exact origin allowlist คั่น comma; ไม่ใช้ wildcard credentials        |
| VITE_API_BASE_URL | apps/web/.env หากต้องการ                                             | Public; ว่างใช้ relative URL                                          |
| HYPERDRIVE        | Workers binding เมื่อได้รับการตั้งค่าในอนาคต                         | ยังไม่มี remote resource/ID ใน Phase 1                                |

API อ่าน Hyperdrive binding ก่อน direct DATABASE_URL และไม่รับ direct URL นอก local/test Readiness ไม่เปิดเผยข้อผิดพลาดภายใน

## Health contracts

| Endpoint      | ผล                                                                   |
| ------------- | -------------------------------------------------------------------- |
| /health/live  | 200 `{ "status": "ok" }` ไม่เรียก DB                                 |
| /health/ready | 200 `{ "status": "ready" }` เมื่อ DB/PostGIS พร้อม                   |
| /health/ready | 503 `{ "status": "unavailable" }` เมื่อ config/DB/extension ไม่พร้อม |

pg ตั้ง connection timeout 1.5 วินาที, server statement timeout 2.5 วินาที และ client query timeout 3 วินาที ปิด client ใน finally หลัง request ทุกครั้ง Frontend abort หลัง 8 วินาทีและลองใหม่ได้

## ข้อจำกัด

ทดสอบ local TCP driver ใน Workers ได้ไม่เท่ากับทดสอบ remote Hyperdrive แล้ว ต้องเลือก provider และจัดเตรียม test/staging ที่ได้รับอนุญาตก่อนตรวจ remote connectivity การเข้าสู่ระบบจริงยังต้องให้เจ้าของตั้ง callback และทดสอบกับบัญชี LINE; ไม่มีการยืนยันเอกสารผู้ขับขี่หรือระบบจองในรอบนี้

ดูรายการผลจริงและ blockers ใน [verification](docs/verification-phase-1.md)

## ประกาศเที่ยว Phase 2B

ดูขอบเขต API, กติกาเวลาไทย/สตางค์, วิธีลองประกาศ–แก้ไข–ยกเลิก และการตรวจจริงใน [คู่มือ Phase 2B](docs/phase-2b-trips.md) และ [ผลตรวจ](docs/verification-phase-2b.md) รายการเที่ยวเป็นส่วนตัวเฉพาะเจ้าของ ยังไม่มี search หรือ booking

## ค้นหาเที่ยว Phase 2C

ค้นหาต้นทาง/ปลายทาง/วันเดินทางและดูรายละเอียดโดยไม่ต้อง login ใช้เฉพาะเที่ยวที่ยังเปิดและอยู่ในอนาคต ดู [คู่มือและ public data contract](docs/phase-2c-discovery.md) และ [ผลตรวจ](docs/verification-phase-2c.md) เพิ่มคำสั่ง `pnpm test:discovery:integration` หลัง migrate เพื่อทดสอบจริงบนฐาน local/test; ยังไม่มี booking/payments

ส่วนหัวหน้าเว็บแสดงเที่ยวเปิดประกาศที่กำลังจะออกเดินทางสูงสุด6เที่ยว พร้อมสถานะและรายละเอียดที่จำเป็นโดยอัตโนมัติ ดู [ขอบเขตและผลตรวจ](docs/trip-status-header.md)

## เริ่มคำขอร่วมเดินทาง

หลัง LINE Login เปิดรายละเอียดเที่ยวของผู้อื่นแล้วส่งคำขอ1ที่นั่งได้ ดู/ยกเลิกใน «คำขอของฉัน» เจ้าของดู «คำขอที่เข้ามา» คำขอpendingยังไม่ยืนยันหรือหักที่นั่ง ขั้นตอบรับเพิ่มใน Phase 2E ด้านล่าง ดู [กติกา/ขอบเขต](docs/phase-2d-ride-requests.md) และใช้ `pnpm test:requests:integration` หลัง migrations เพื่อทดสอบหลายฝ่ายบนฐานจริง งานต่อบน PR #6 โดยยังไม่ merge

## ตอบรับ/ปฏิเสธและจัดสรรที่นั่ง Phase 2E

เจ้าของเที่ยวเปิด «คำขอที่เข้ามา» เลือกตอบรับ 1 ที่นั่งหรือปฏิเสธพร้อมเหตุผลได้ ผู้โดยสารดูผล/รายละเอียดที่ส่งคำขอไว้ใน «คำขอของฉัน» และยกเลิกที่นั่งที่ตอบรับแล้วได้ก่อนเวลาเดินทาง ระบบคืนที่นั่งครั้งเดียว เที่ยวเต็มไม่แสดงในผลค้นหาสาธารณะ รายละเอียดที่ตอบรับแล้วถูกล็อกจนไม่มีที่นั่งตอบรับอยู่ การยกเลิกเที่ยวจะยกเลิกคำขอที่ยังใช้งานทั้งหมดด้วย

ดู [กติกาและ API](docs/phase-2e-decisions.md) และ [ผลตรวจ](docs/verification-phase-2e.md) หลัง migrate รัน `pnpm test:decisions:integration` ตรวจการแข่งขันที่นั่งสุดท้ายและ invariants บน PostgreSQL จริง และ `pnpm test:decisions:upgrade` ตรวจ upgrade จาก migration 0005 ที่มีคำขอเก่าในฐานชั่วคราวที่ script สร้าง/ลบเอง `pnpm test:auth:workers` รวม HTTP smoke ด้วย 3 synthetic actors ผ่าน Workers ส่วน remote ใช้ staging workflow เดิม ไม่ production งานคงอยู่ใน PR #6 แบบ Draft ยังไม่ merge

## เตรียม production

ดู [สถานะและคู่มือเปิด coago.space](docs/production-launch.md) ซึ่งแยกฐานใหม่/LINE/config/backup/rollback/งานดูแลผู้ใช้ออกจาก staging ใช้ `pnpm release:check https://coago-line-test.akkarapatchara.workers.dev` ตรวจ HTTP แบบ anonymous GET ที่ไม่เขียนข้อมูล คำสั่งนี้ไม่ deploy/migrate และไม่ยืนยัน backup หรือ real LINE walkthrough ปัจจุบันยังไม่มี production deploy workflow

ตรวจ Direct DB/Hyperdrive แบบอ่านอย่างเดียวผ่าน [Database readiness workflow](.github/workflows/database-readiness.yml) ดูวิธีตั้ง production Environment/Direct host ใน [คู่มือ](docs/production-launch.md) ทดสอบตัวอ่าน metadata บนฐาน local ด้วย `pnpm test:database-readiness:integration` ไม่มี deploy/migrate จาก workflow นี้

การสร้างตารางครั้งแรกใช้ [Production database bootstrap](.github/workflows/production-bootstrap.yml) แบบ manual จาก main สำหรับฐาน production ใหม่ที่ตรวจแล้วเท่านั้น ดู [ขั้นตอนและข้อจำกัด](docs/production-launch.md) `pnpm db:migrate` ยังคงจำกัด local/test ตามเดิม ทดสอบ bootstrap/rollback บน disposable DB ด้วย `pnpm test:production-bootstrap:integration` ไม่มี production deployment อัตโนมัติ

หลัง bootstrap ใช้ [Production Hyperdrive connection](.github/workflows/production-hyperdrive.yml) แบบ manual เพื่อสร้าง/pin config ใหม่และตรวจ remote preview ด้วย read-only SQL ดู [คู่มือ](docs/production-launch.md) Local runtime check คือ `pnpm test:production-hyperdrive:workers` ซึ่งใช้ JSON bindingกับฐานlocal ไม่ใช่หลักฐาน remote Hyperdrive ไม่มี deployแอป/เปลี่ยนDNSใน workflowเชื่อมฐาน

[Prepare production Worker](.github/workflows/production-worker.yml) ใช้ production LINE channel/Hyperdrive ที่pinแล้วและowner marker ตรวจบนworkers.devก่อนเปลี่ยนโดเมน บนpreviewปิดlogin/private sessions/APIwritesก่อนเข้าถึงstore ยังไม่แก้DNS/LINEConsole ใช้ `pnpm test:production-worker:runtime` ตรวจguardในlocalWorkersกับฐานtestจริง ดูสถานะ/วิธีrunใน[คู่มือ](docs/production-launch.md)

## Root Admin ก่อนเปิดบริการ

ขอบเขตบัญชีเจ้าของ LINE, การจัดการผู้ใช้/เที่ยว/คำขอ, service/registration switches, audit, ขั้นอัปเกรดและ Free hosting อยู่ใน [docs/root-admin.md](docs/root-admin.md). เพิ่ม Environment secret `ROOT_ADMIN_LINE_SUBJECT` ใน `production`; ไม่ใช่ Channel ID และไม่ส่งค่าให้ frontend. การเปิดบริการต้องผ่าน manual acceptance ก่อน ไม่เปิดด้วยการ merge.

ตรวจแยกด้วย `pnpm test:admin:integration` (ฐาน disposable + local Workers runtime) และ `pnpm test:admin:upgrade` (baseline7→9, rollback/idempotency). Browser fixture `apps/web/tests/admin.html` ใช้เฉพาะ Vite dev/Playwright ไม่ใช่ build entry และไม่อยู่ใน production dist.

## สมาชิกปลอดภัย แผนที่ และ staff email

ขอบเขตใหม่: [สมาชิก/รถ/แผนที่/ราคาคงที่](docs/member-safety-and-maps.md), [Root/Admin email-password](docs/admin-email-auth.md). `/account` สำหรับข้อมูลสมาชิก LINE, `/admin` สำหรับ staff, `/root` เฉพาะRoot. ข้อมูลต้องอนุมัติก่อนประกาศ/ส่ง/ตอบรับคำขอใหม่; cancel/refundเดิมยังได้

`pnpm test:members:integration` ใช้disposablePostgres, mockedNeon และlocalWorkers/R2 ไม่ส่งอีเมลหรือใช้เอกสารจริง. Migration0010เป็นฐานเดิม; ชุดปัจจุบันถึง0011รวม12migrations/19appTables. ห้ามใช้legacybootstrap0000–0006กับschemaปัจจุบัน; ใช้guardedupgradeworkflowตามrunbook. ไม่เปิดบริการ/paid planจากmerge

### หน้าแรกและตำแหน่ง

หน้าแรกแบบแดชบอร์ดและรูปแบบฟอร์มร่วมกันทุกหน้า รวม Root/Admin พร้อมภาษาไทยมีหัว อ่านรายละเอียดและข้อจำกัดการตรวจตำแหน่งก่อนบันทึกเที่ยว/ส่งคำขอใน [หน้าแรกและตำแหน่ง](docs/home-dashboard-and-location.md). รอบนี้ไม่มี schema migration ใหม่.

## ใบขับขี่ ประกาศหารถ และสถานะเดินทาง

ชุดต่อจาก PR17 เพิ่มการตรวจใบขับขี่ผู้ขับ ประกาศหารถอิสระ ภาพรวมปลายทาง รายงานสถานะเดินทางและแผนที่จุดรับ–ส่ง พร้อมคิวแจ้งเตือน LINE แบบ opt-in ที่ปิดเป็นค่าเริ่มต้น. Schema ปัจจุบัน12migrations/19appTables. ใช้ `pnpm test:community:integration` และอ่าน [ขั้นตอนใช้งาน/อัปเกรด/ตั้งค่า LINE](docs/community-safety-and-journeys.md). ธีมหลัก Porcelain/Onyx/LimeMoss/Mustard; LIFF/RichMenuยังรอท้ายสุด.
