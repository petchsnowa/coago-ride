# COAGO — Phase 1 Implementation Plan

สถานะ: ขอบเขตสำหรับลงมือพัฒนาฐานระบบตามคำสั่งผู้ใช้
เอกสารนี้เป็นแผนและเกณฑ์ตรวจรับ ไม่ใช่รายงานว่าทำสำเร็จแล้ว

อ้างอิง: [AGENTS.md](../AGENTS.md), [Product Brief](product-brief.md), [Architecture](architecture.md)

## 1. เป้าหมาย

สร้างฐาน COAGO ที่ติดตั้งและพัฒนาต่อได้ พร้อม frontend, Workers API, database tooling, tests และ CI ใช้ local/test resources เท่านั้น ห้าม deploy production หรือรัน production migrations

การสร้างเอกสารชุดนี้ไม่ทำให้ถือว่าโค้ด tests หรือ infrastructure มีอยู่แล้ว

## 2. งานที่ต้องส่งมอบ

### A. Workspace และเครื่องมือ

- สร้าง pnpm TypeScript monorepo ตาม architecture พร้อม lockfile
- Pin Node.js 24 LTS patch/pnpm exact version ที่ตรวจ compatibility แล้ว
- Strict TypeScript configs แยก browser, Workers และ Node tooling
- Lint rules และ package exports ที่ป้องกัน browser import server database code
- README ระบุ prerequisites และคำสั่งที่ใช้งานได้จริง

### B. Shared packages

- contracts: health response schemas/types และ error contracts
- db: Drizzle schema, database adapter/tooling และ migrations
- config: shared configuration เฉพาะที่ใช้งานจริง
- ตรวจ dependency boundaries ใน build/typecheck และ lint ตามที่เหมาะสม

### C. Frontend

- React/Vite หน้าแรกภาษาไทย อธิบายว่า COAGO ช่วยคนเดินทางต่างจังหวัดกับคนมีที่นั่งว่าง
- แสดงว่าเป็นฐานระบบ Phase 1
- ปุ่มตรวจ readiness พร้อม loading, success, unavailable/error และ retry
- Timeout และป้องกัน request ซ้อน/ผลเก่าทับผลใหม่ตามพฤติกรรมที่เลือก
- รองรับ keyboard และหน้าจอมือถือ/desktop
- ไม่มี login/booking/payment ปลอมที่ดูเหมือนใช้งานจริง

### D. Workers API

- Hono พร้อม typed bindings และ shared contracts
- GET /health/live: 200 โดยไม่พึ่ง DB
- GET /health/ready: 200 เมื่อ query DB/PostGIS สำเร็จ; 503 เมื่อขาด config/error/timeout
- 404 และ unexpected error responses ที่ไม่รั่วข้อมูล
- Database cleanup/timeouts และ CORS allowlist
- Wrangler config พร้อม compatibility_date และ nodejs_compat ที่ตรวจแล้ว

### E. Database และ migrations

- Disposable PostgreSQL 17/PostGIS 3.5 test baseline ผ่าน Compose หรือเครื่องมือที่ environment รองรับ
- Versioned migration เปิด extension PostGIS และสร้าง system_metadata ตาม architecture
- Schema/SQL/migration journal สอดคล้องกัน
- Database query ผ่าน Drizzle ที่อ่าน/เขียนข้อมูล test infrastructure ได้
- ไม่สร้างตาราง users/trips/bookings โดยเดากติกา
- ตัวอย่าง environment ไม่มี production secrets

### F. Tests และ CI

- Unit, API และ frontend behavior tests
- Database integration tests กับ PostgreSQL/PostGIS จริง
- Migration-from-empty และ repeat-run verification
- Local Workers runtime-to-database smoke test ตามความสามารถ environment
- Frontend build และ Workers bundle dry run
- GitHub Actions สำหรับ push/pull_request พร้อม isolated PostGIS database และสิทธิ์ขั้นต่ำ
- ไม่มี deployment workflow หรือ production migrations

## 3. Scripts ที่ต้องจัดทำ

ใช้ชื่อดังต่อไปนี้เป็น contract ของ repo เมื่อ implementation เสร็จ คำสั่งยังไม่ถือว่ามีอยู่ก่อนสร้าง:

| คำสั่ง | หน้าที่ |
| --- | --- |
| pnpm install --frozen-lockfile | ติดตั้งตรง lockfile หลังสร้าง lockfile แล้ว |
| pnpm dev | เริ่ม frontend และ local API |
| pnpm lint | ตรวจ style/rules และ boundaries |
| pnpm typecheck | ตรวจ types ทุก workspace |
| pnpm test | Unit/API/UI tests ไม่พึ่ง remote secrets |
| pnpm build | Frontend production build และ Workers bundle dry run; ไม่ deploy |
| pnpm db:generate | Generate schema migration artifacts ตาม Drizzle config |
| pnpm db:migrate | Apply versioned migrations ไป local/test DB ที่ตั้งไว้ |
| pnpm test:integration | DB/PostGIS integration; ต้องล้มเหลวชัดเจนถ้าไม่มี test DB |
| pnpm test:workers | ตรวจ local Workers API กับ test DB จริง |

แยก script orchestration ให้เปิดและปิด test processes ได้ ไม่ทิ้ง ports/connections ค้าง README ต้องบอกวิธีเปิด test DB ก่อนใช้ integration scripts

Migration commands ต้องมี guard/คำอธิบายเพื่อไม่ชี้ฐานข้อมูลผิด environment ไม่อนุมานว่าการมี DATABASE_URL แปลว่าได้รับอนุญาตให้ reset/drop database

## 4. Test cases ขั้นต่ำ

| พื้นที่ | เกณฑ์ |
| --- | --- |
| Contracts | รับ valid health payload และปฏิเสธ malformed payload |
| Liveness | 200 และไม่เรียก DB |
| Readiness | 200 เมื่อ DB/PostGIS สำเร็จ |
| Readiness failure | 503 เมื่อ missing binding, connection failure, extension missing หรือ timeout |
| Information exposure | responses ไม่เผย URL, credentials หรือ stack |
| UI | loading → success/error; retry หลัง failure ได้; ไม่ค้างเมื่อ timeout |
| Migration | ฐานว่าง migrate ได้; รันซ้ำไม่เพิ่ม migration/data ซ้ำ |
| Drizzle query | อ่าน/เขียน system_metadata ใน DB test ได้ |
| PostGIS | version/extension query และ spatial expression ให้ผลคาดหมาย |
| Workers integration | request ผ่าน local Workers runtime ถึง DB จริงได้ |
| Browser | ทดลองหน้าจอ mobile/desktop และปุ่มตรวจสถานะ |
| Build | web bundle และ Workers dry run สำเร็จ |

SQL smoke checks:

```sql
SELECT version();
SELECT PostGIS_Full_Version();
SELECT ST_AsText(ST_SetSRID(ST_MakePoint(100.5018, 13.7563), 4326));
```

ตรวจผล spatial ด้วย assertions ไม่ใช่เพียง print SQL output ไม่สร้าง fixture ที่มีข้อมูลบุคคลจริง

## 5. Environment และเอกสาร

README ต้องอธิบาย:
1. รุ่น tools ที่ใช้จริง
2. install/setup
3. เปิด local PostGIS และตั้ง test config
4. รัน migrations
5. รัน frontend/API และ URLs ที่เข้าถึงได้จาก environment
6. scripts/tests/build
7. connectivity path และข้อจำกัด
8. วิธีหยุด services โดยไม่ทำลายข้อมูลอื่น

ไฟล์ตัวอย่าง environment ต้องบอกว่าค่าใด public/secret/local-only ใช้ placeholder สำหรับค่าที่ผู้ใช้ต้องตั้ง ไม่สร้าง Hyperdrive ID หรือ remote credentials ปลอม

## 6. ลำดับลงมือ

1. ตรวจ repo/branch/Git status และอ่านเอกสารที่อ้างอิง
2. ตั้ง workspace และเลือก dependency versions ที่เข้ากันได้
3. สร้าง contracts/API/frontend พร้อม unit tests
4. ตั้ง DB/schema/migrations และ integration tests
5. ตรวจ local Workers runtime connection
6. เพิ่ม CI และ README ตามคำสั่งที่รันได้จริง
7. รัน checks ทั้งหมด แก้ failures ที่เกี่ยวข้อง และสรุปผล

ทำงานที่ไม่พึ่ง remote provider ต่อได้ หาก remote credentials/resources ไม่มี ไม่หยุดงานทั้งหมดเพื่อขอ production secrets

## 7. Definition of Done และหลักฐาน

ทุก check ต้องระบุ ผ่าน / ไม่ผ่าน / ไม่ได้รัน พร้อมคำสั่ง เหตุผล และ environment ที่ทดสอบ บันทึก tool/database versions จากการรันจริง

แบ่งผล connectivity เป็น:
- static build/type checks
- mocked behavior tests
- PostgreSQL/PostGIS integration จริง
- local Workers runtime ไป test DB จริง
- remote Workers/Hyperdrive จริง

ถ้าไม่มี remote resources ให้ระบุชั้นสุดท้ายว่าไม่ได้รัน การผ่าน local, mocks หรือ bundle ไม่ถือว่า remote connectivity ผ่าน ห้าม deploy production เพื่อให้ checklist ครบ

ถ้า database/browser checks ถูกบล็อก ต้องระบุ blocker และวิธีตรวจซ้ำ ไม่ถือว่างานตรวจทั้งหมดผ่าน และไม่ให้ skip เงียบใน CI

## 8. นอกขอบเขต

- Production provisioning/deployment/migrations
- ระบบบัญชีและ LINE Login จริง (กำหนดทำใน Phase 2; Phase 1 ยังไม่เชื่อม LINE)
- Booking/matching/payment/chat/live tracking เต็มระบบ
- เอกสารส่วนตัวและข้อมูลผู้ใช้จริง
- การยืนยันความพร้อมเปิดใช้กับบุคคลทั่วไป

## 9. รูปแบบส่งมอบ

สรุปเป็นภาษาไทย: สิ่งที่ทำ, ไฟล์สำคัญ, วิธีรัน, ตารางผล checks, PostgreSQL/PostGIS versions, connectivity ที่พิสูจน์ได้จริง, ข้อจำกัด และงานถัดไป เก็บผลใน PR/รายงาน verification ที่มีอยู่จริง โดยไม่แต่งผลล่วงหน้า

## 10. ข้อเลือกสำหรับ Phase 2

เจ้าของโครงการเลือก LINE Login เป็นช่องทางหลักแล้ว วางขอบเขตตามหัวข้อ LINE Login ใน architecture.md ไม่เพิ่ม authentication endpoints หรือ LINE secrets จริงใน Phase 1 และเลื่อน WeChat ไปภายหลัง
