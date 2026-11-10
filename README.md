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

| ค่า | สถานที่ | หมายเหตุ |
| --- | --- | --- |
| DATABASE_URL | root .env สำหรับ scripts และ apps/api/.dev.vars สำหรับ local Workers | Secret, local/test เท่านั้น |
| ENVIRONMENT | Wrangler vars | local/test อนุญาต direct test URL; environment อื่นต้องใช้ Hyperdrive |
| ALLOWED_ORIGINS | Wrangler vars | Exact origin allowlist คั่น comma; ไม่ใช้ wildcard credentials |
| VITE_API_BASE_URL | apps/web/.env หากต้องการ | Public; ว่างใช้ relative URL |
| HYPERDRIVE | Workers binding เมื่อได้รับการตั้งค่าในอนาคต | ยังไม่มี remote resource/ID ใน Phase 1 |

API อ่าน Hyperdrive binding ก่อน direct DATABASE_URL และไม่รับ direct URL นอก local/test Readiness ไม่เปิดเผยข้อผิดพลาดภายใน

## Health contracts

| Endpoint | ผล |
| --- | --- |
| /health/live | 200 `{ "status": "ok" }` ไม่เรียก DB |
| /health/ready | 200 `{ "status": "ready" }` เมื่อ DB/PostGIS พร้อม |
| /health/ready | 503 `{ "status": "unavailable" }` เมื่อ config/DB/extension ไม่พร้อม |

pg ตั้ง connection timeout 1.5 วินาที, server statement timeout 2.5 วินาที และ client query timeout 3 วินาที ปิด client ใน finally หลัง request ทุกครั้ง Frontend abort หลัง 8 วินาทีและลองใหม่ได้

## ข้อจำกัด

ทดสอบ local TCP driver ใน Workers ได้ไม่เท่ากับทดสอบ remote Hyperdrive แล้ว ต้องเลือก provider และจัดเตรียม test/staging ที่ได้รับอนุญาตก่อนตรวจ remote connectivity การเข้าสู่ระบบจริงยังต้องให้เจ้าของตั้ง callback และทดสอบกับบัญชี LINE; ไม่มีการยืนยันเอกสารผู้ขับขี่หรือระบบจองในรอบนี้

ดูรายการผลจริงและ blockers ใน [verification](docs/verification-phase-1.md)

## ประกาศเที่ยว Phase 2B

ดูขอบเขต API, กติกาเวลาไทย/สตางค์, วิธีลองประกาศ–แก้ไข–ยกเลิก และการตรวจจริงใน [คู่มือ Phase 2B](docs/phase-2b-trips.md) และ [ผลตรวจ](docs/verification-phase-2b.md) รายการเที่ยวเป็นส่วนตัวเฉพาะเจ้าของ ยังไม่มี search หรือ booking
