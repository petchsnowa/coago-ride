# COAGO — Architecture

สถานะ: แนวทางเริ่มต้นสำหรับพัฒนา Phase 1
เอกสารนี้จัดทำตามคำสั่งให้วาง architecture ต่อจาก Product Brief ไม่ใช่หลักฐานว่าติดตั้ง ทดสอบ หรือเปิดใช้ infrastructure แล้ว เวอร์ชันแพ็กเกจที่แน่นอนต้องตรวจ compatibility และบันทึกใน manifest/lockfile ระหว่าง implementation

## เอกสารที่เกี่ยวข้อง

- [Agent instructions](../AGENTS.md)
- [Product Brief](product-brief.md)
- [Phase 1 และเกณฑ์ตรวจรับ](phase-1.md)

## 1. เป้าหมายและข้อจำกัด

COAGO เชื่อมผู้ต้องการเดินทางต่างจังหวัดกับผู้ขับขี่ที่มีที่นั่งว่าง Phase 1 สร้างฐานระบบเพื่อพัฒนาฟีเจอร์เหล่านี้ต่อ ยังไม่ให้บริการจองจริง ไม่มีการ deploy production หรือสร้าง production resources

## 2. ภาพรวม

```text
Browser
  └─ React/Vite frontend
       └─ HTTP JSON → Hono API บน Workers
                       └─ Drizzle + node-postgres
                            ├─ Local: test PostgreSQL/PostGIS ผ่าน TCP
                            └─ Remote (ภายหลัง): Hyperdrive → PostgreSQL/PostGIS
```

Frontend ติดต่อ API เท่านั้น ไม่ติดต่อฐานข้อมูลโดยตรง ไม่มี database credentials ใน browser bundle

## 3. ข้อเลือกสำหรับฐานระบบ

| ส่วน | แนวทาง |
| --- | --- |
| Language | TypeScript strict mode |
| Workspace | pnpm workspaces; lockfile เดียว |
| Toolchain | Node.js 24 LTS เป็นฐาน; pin patch และ pnpm exact version ที่ตรวจแล้วใน implementation |
| Frontend | React + Vite |
| API runtime | Hono + Cloudflare Workers; ใช้ Wrangler สำหรับ local runtime และ bundle validation |
| API validation | Zod และ browser-safe contracts |
| Database | PostgreSQL 17 + PostGIS 3.5 เป็น test baseline |
| ORM | Drizzle ORM และ Drizzle Kit พร้อม versioned migrations |
| Database driver | node-postgres (pg) พร้อม Workers nodejs_compat; ตรวจความเข้ากันได้จริงระหว่าง implementation |
| Remote connectivity | ออกแบบใช้ Hyperdrive; ยังไม่สร้าง resource ใน Phase 1 |
| Unit/API/UI tests | Vitest; React Testing Library สำหรับพฤติกรรม UI |
| Browser verification | Playwright หรือ browser automation ที่ environment รองรับ |
| CI | GitHub Actions พร้อม isolated PostGIS service |

ใช้ dependency รุ่นที่ตรวจแล้วว่าเข้ากันได้ ไม่เลือก latest โดยไม่มีการทดสอบ Pin compatibility_date ของ Workers เป็นวันที่ที่ตรวจ toolchain จริง เวอร์ชัน test baseline ไม่รับประกันว่าผู้ให้บริการ production รองรับ ต้องตรวจอีกครั้งก่อนเลือก provider

## 4. โครงสร้าง repository

```text
apps/
  web/
    src/
    .env.example
  api/
    src/
    wrangler.jsonc
    .dev.vars.example
packages/
  contracts/src/
  db/
    src/
    migrations/
    drizzle.config.ts
  config/
docs/
  product-brief.md
  architecture.md
  phase-1.md
  decisions/
.github/workflows/ci.yml
compose.yaml
.env.example
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
README.md
AGENTS.md
```

- contracts ไม่ import db, Workers bindings หรือ server environment
- db ใช้เฉพาะ server และ migration/test tooling
- config เก็บ shared configuration ที่ใช้จริง ไม่สร้าง package ว่างเพียงเพื่อให้ครบแผน
- apps/api ประกอบ routes, bindings และ lifecycle ของ database client
- ไม่ใส่ secrets ลง packages หรือ frontend

## 5. API contracts และ frontend

Endpoints สำหรับ Phase 1:

| Endpoint | พฤติกรรม |
| --- | --- |
| GET /health/live | 200 พร้อม JSON {status: "ok"}; ไม่เรียกฐานข้อมูล |
| GET /health/ready | 200 พร้อม JSON {status: "ready"} เมื่อ query PostgreSQL/PostGIS สำเร็จ |
| GET /health/ready | 503 พร้อม JSON {status: "unavailable"} เมื่อ binding ขาด ฐานข้อมูลล้มเหลว หรือ timeout |
| Unknown route | 404 พร้อม JSON error ที่กำหนดใน contracts |
| Unexpected failure | 500 พร้อมข้อความทั่วไป ไม่เปิดเผย stack/credentials |

Frontend ภาษาไทยแสดงชื่อ COAGO เป้าหมายบริการ และปุ่มตรวจสถานะ ใช้ readiness พร้อม loading/success/error/retry ไม่สร้างข้อมูลเที่ยวหรือการยืนยันตัวตนปลอมให้เหมือนพร้อมใช้งานจริง

ตั้ง timeout ของ frontend และ readiness ให้มีขอบเขตแน่นอน ค่าเริ่มต้น readiness 5 วินาทีและ frontend 8 วินาที ตรวจว่า timeout ยกเลิก/ทำความสะอาดงานฐานข้อมูลด้วย ไม่ใช้ Promise.race อย่างเดียวจนมี query ค้าง

Development ใช้ Vite proxy ไป local Workers API และ relative API URL เป็นค่าเริ่มต้น รองรับ VITE_API_BASE_URL สำหรับแยก origin ในภายหลัง CORS ใช้ allowlist จาก server configuration เท่านั้น ไม่เปิด credentials กับ wildcard origin

## 6. Database connectivity

ใช้ connection adapter เลือก connection string จาก:
1. Hyperdrive binding เมื่อได้รับการตั้งค่าใน environment ที่รองรับ
2. DATABASE_URL สำหรับ local/test เท่านั้น

หากไม่มี configuration ให้ readiness ตอบ unavailable ไม่เชื่อมไป default host หรือ production โดยเงียบ ๆ ตัวอย่าง config ห้ามมี Hyperdrive ID ปลอมที่ดูพร้อม deploy

Workers ใช้ nodejs_compat และ pg รุ่นที่รองรับ runtime จริง ตั้ง connect/query timeout และ release/end ตาม lifecycle ที่แนะนำของ driver/Hyperdrive ห้ามใช้ client เดียวพร้อมกันหลาย requests โดยไม่จัดการ concurrency ปิด prepared statement หรือ pooling behavior เฉพาะเมื่อเอกสาร driver/Hyperdrive ที่ใช้อยู่กำหนด

Local runtime จะใช้ localConnectionString สำหรับ Hyperdrive emulator หรือ direct local DATABASE_URL ได้ตาม Wrangler ที่ตรวจแล้ว ระบุเส้นทางที่ใช้จริงใน README การผ่าน local ไม่พิสูจน์ remote Hyperdrive connectivity

Production provider ยังไม่เลือก ไม่สร้างบัญชี ฐานข้อมูล binding หรือ remote Workers เพื่อทำให้ checklist ผ่าน หากต้องใช้ staging ให้ทำเป็นงานแยกตามคำสั่งผู้ใช้

## 7. Schema ของ Phase 1

เริ่มจาก migration สำหรับเปิด PostGIS และตาราง infrastructure ขนาดเล็ก เช่น system_metadata:
- key: text primary key
- value: text not null
- updated_at: timestamptz not null

ใช้ตารางนี้ยืนยัน schema/query ผ่าน Drizzle โดยไม่ใส่ข้อมูลส่วนบุคคล ส่วน PostGIS ทดสอบด้วย spatial SQL จริงและ integration fixture ภายในฐานข้อมูลทดสอบ ไม่เพิ่มตารางธุรกิจเพื่อเป็น fixture

Migration SQL ต้องรวม extension creation ที่ Drizzle generate อาจไม่สร้างให้เอง เก็บ metadata/journal ของ migration tooling ให้ถูกต้อง ตรวจ schema drift ด้วยขั้นตอนที่อธิบายได้ การรัน migration ซ้ำต้องไม่สร้างรายการซ้ำหรือทำลายข้อมูล

Entities ใน Phase 2 ตาม Product Brief คือผู้ใช้ รถ เที่ยว และคำขอ แต่ยังไม่สร้าง auth identity model, booking schema หรือกติกาที่นั่งละเอียดใน Phase 1 เพื่อไม่ผูกกับข้อเลือกที่ยังไม่กำหนด

## 8. Spatial data และเวลา

ใช้ longitude ก่อน latitude และ SRID 4326 สำหรับ geographic points กำหนด geometry/geography ตาม query จริง ถ้าคำนวณระยะเป็นเมตรต้องใช้ชนิดหรือ transformation ที่ถูกต้อง ไม่ตีความองศาเป็นเมตร

เวลาเก็บเป็น timestamptz และแสดงใน Asia/Bangkok เมื่อพัฒนาฟีเจอร์เดินทางจริง ทดสอบการแปลงเวลาจากวันที่เดินทางของผู้ใช้ก่อนทำ search filtering

## 9. Secrets และ environment

- .env.example: local database/migration configuration พร้อม placeholder
- apps/api/.dev.vars.example: Workers local secrets/config ที่จำเป็น
- apps/web/.env.example: public API base URL เท่านั้น
- actual .env, .dev.vars และไฟล์ environment ส่วนตัวต้องถูก ignore โดยเว้นไฟล์ตัวอย่าง
- ใช้ test credentials สังเคราะห์ใน disposable local/CI database เท่านั้น และระบุว่าไม่ใช้ production
- ไม่ log database URL, private tokens, ข้อมูลติดต่อ หรือ raw database errors
- ไม่เพิ่ม deployment secrets ใน Phase 1

## 10. Testing และ CI

แยก unit tests จาก integration tests อย่างชัดเจน Unit tests ใช้ mock เพื่อทดสอบ failure ได้ แต่การตรวจ compatibility ต้องเรียก PostgreSQL/PostGIS จริง

CI รัน frozen-lockfile install, lint, typecheck, unit/UI/API tests, frontend build, Workers bundle dry run, migrations และ PostgreSQL/PostGIS integration หาก environment รองรับให้มี local Workers-to-database smoke test ด้วย ไม่รัน production deploy

ใช้ permissions: contents: read เท่าที่ workflow ต้องการ ไม่ใช้ secrets production และไม่เปิด privileged workflow ให้โค้ด PR ที่ยังไม่เชื่อถือ

## 11. งานหลัง Phase 1

เลือก auth และ provider, กำหนดสิทธิ์/ข้อมูลส่วนตัว, จำนวนที่นั่งต่อคำขอ และ cancellation policy ก่อน Phase 2 การตอบรับคำขอในอนาคตต้องทำใน transaction ด้วย row locking หรือ conditional updates พร้อมทดสอบ concurrent requests และ idempotent cancellation

เอกสารนี้ไม่ยืนยันความพร้อมเปิดให้บุคคลทั่วไปใช้งาน ผลตรวจจริงต้องอยู่ในรายงาน implementation
