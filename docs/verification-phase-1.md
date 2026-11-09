# COAGO Phase 1 — ผลตรวจ

ทดสอบวันที่ 9 พฤศจิกายน 2026 ใน managed Linux development environment ไม่มีการ deploy production และยังไม่มี remote Hyperdrive resource

## สิ่งที่สร้าง

pnpm/TypeScript monorepo, React/Vite frontend ภาษาไทย, Hono Workers API, browser-safe contracts, server-only db package, shared TypeScript config, Drizzle schema/migration, local Compose PostGIS, environment examples, CI workflow และ automated tests

LINE Login, booking และ schema ธุรกิจยังเป็น Phase 2 ตามขอบเขต

## ผลตรวจ local

| Check | ผลและหลักฐาน |
| --- | --- |
| Frozen lockfile install | ผ่าน pnpm install --frozen-lockfile |
| Peer dependencies | ผ่าน pnpm peers check; ไม่มี peer mismatch |
| Lint | ผ่าน pnpm lint |
| TypeScript | ผ่าน pnpm typecheck ทั้ง browser/tooling และ Workers configs |
| Unit/API/UI | ผ่าน pnpm test: 14 tests |
| Web build | ผ่าน Vite production build |
| Workers bundle | ผ่าน Wrangler deploy --dry-run; ไม่ deploy |
| Generate migration | ผ่าน pnpm db:generate: No schema changes |
| Migration จากฐานว่าง | ผ่านบน coago_empty_test ที่สร้างจาก template0 ก่อนมี extension |
| Migration ซ้ำ | ผ่าน ใช้ migration journal และมี 1 migration record |
| DB integration | ผ่าน PostgreSQL/PostGIS จริง, Drizzle read/write, NOT NULL constraint, spatial expression และ server query timeout |
| Local Workers connectivity | ผ่าน Miniflare/workerd → pg TCP → PostgreSQL/PostGIS จริง; DB ใช้ไม่ได้ตอบ 503 |
| Local dev commands | ผ่าน pnpm dev; Wrangler dev และ Vite proxy ตอบ readiness 200 |
| Browser automation | ผ่าน 2 tests: desktop 1440px และ mobile 390px; suite นี้ mock health response |
| Browser ถึงฐานข้อมูลจริง | ผ่านการทดลองเพิ่มเติม: Chromium → Vite proxy → Wrangler dev → PostgreSQL/PostGIS; แสดงพร้อมใช้งานหลังคลิก |
| Screenshot inspection | ตรวจ desktop และ mobile layout; ไม่มี horizontal overflow ใน automated assertions |
| Git whitespace | ผ่าน git diff --check |
| GitHub Actions | เพิ่ม workflow แล้ว; ผลบน GitHub ให้ดู Actions/PR checks แยกจากผล local ในตารางนี้ |
| Remote Workers/Hyperdrive | ไม่ได้รัน: ยังไม่มี remote resources/configuration; ไม่สรุปว่าผ่านจาก local |
| Production | ไม่ได้ deploy/provision/migrate ตามขอบเขต |

## รุ่นที่ตรวจจริง

- Node.js 24.22.1, pnpm 11.25.0, TypeScript 5.9.3
- React 19.3.1, Vite 8.3.6, Hono 4.13.17
- Drizzle ORM 0.45.4, pg 8.23.1
- Wrangler 4.110.0, Miniflare 4.20260708.1, compatibility_date 2026-07-08
- PostgreSQL 17.11 / PostGIS 3.5.7 จาก postgis/postgis:17-3.5-alpine
- Vitest 5.1.0 / Playwright 1.65.0
- manifests และ lockfile เป็นรายการรุ่น dependency ทั้งหมด

## Query ที่ตรวจ

- SELECT version() และ PostGIS_Full_Version()
- ST_AsText(ST_SetSRID(ST_MakePoint(100.5018, 13.7563),4326)) ได้ POINT(100.5018 13.7563)
- อ่าน/เขียน system_metadata ผ่าน Drizzle พร้อม transaction
- NOT NULL constraint ปฏิเสธ value ที่เป็น null
- SELECT pg_sleep(10) ถูกยกเลิกตาม statement timeout ไม่รอครบ 10 วินาที

## ปัญหาที่แก้ระหว่างทำ

- Default pnpm/Wrangler cache paths อยู่นอกพื้นที่เขียนได้ของเครื่องนี้: ตั้ง XDG paths ใน shell ของเครื่องทดสอบ ไม่ฝัง absolute workspace paths ใน repo
- Debian PostGIS image ทำให้ Docker VFS ใช้พื้นที่เกินที่มี: ลบเฉพาะอิมเมจที่งานนี้เพิ่งดึงและใช้ Alpine แทน
- TypeScript รุ่น 7 อยู่นอก peer range ของ lint tooling: pin 5.9.3
- Wrangler 4.158.0 ดึง Miniflare 5 beta และ local startup ค้าง: pin Wrangler/Miniflare stable ที่ใช้ runtime รุ่นเดียวกัน พร้อมทดสอบทั้ง direct runtime และ Wrangler dev ใหม่จนผ่าน

## ข้อจำกัดและงานถัดไป

1. ยังไม่พิสูจน์ remote network/TLS/Hyperdrive/provider permissions ต้องทดสอบกับ staging ที่ได้รับอนุญาตในงานถัดไป
2. Schema มีเพียง infrastructure metadata และ PostGIS extension ยังไม่มี booking, identity หรือข้อมูลส่วนตัวจริง
3. ยังไม่มี LINE channel/secrets/session implementation
4. Test database เป็น disposable tmpfs; ห้ามใช้เก็บข้อมูลจริง
5. CI workflow ไม่เท่ากับหลักฐานว่า GitHub Actions ผ่าน ต้องดูผล run ของ commit นั้นจริง
