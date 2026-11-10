# Phase 2A — LINE Login สำหรับ COAGO Test

ขอบเขต: เพิ่มระบบเข้าสู่ระบบหลัง Phase 1 ตามการเลือก LINE และการเตรียม channel/secrets ของเจ้าของโครงการ ไม่เพิ่ม booking, payment, matching หรือ WeChat และไม่เปลี่ยน production DNS/routes/channel เดิม

## บัญชีทดสอบ

ใช้ LINE Login channel COAGO Test (`2012503801`) ภายใต้ Coago Group แยกจาก channel coago เดิม ไม่ publish test channel โดยอัตโนมัติ ผู้ทดสอบต้องเป็น role ที่ LINE อนุญาตเมื่อ channel อยู่ใน Developing

GitHub Actions Variable: LINE_CHANNEL_ID
GitHub Actions Secret: LINE_CHANNEL_SECRET

Channel secret อยู่ที่ server เท่านั้น ไม่อ่านจาก frontend และไม่ใช้ Messaging API access token แทน

## Endpoints

| Endpoint | พฤติกรรม |
| --- | --- |
| GET /api/auth/line/start | เริ่ม authorization code flow, state/nonce/PKCE และ redirect ไป LINE |
| GET /api/auth/line/callback | Consume flow ครั้งเดียว แล้ว exchange code และตรวจ ID token ผ่าน LINE verify API |
| GET /api/auth/me | คืนบัญชี COAGO และ CSRF token ของ session หรือ anonymous state; ไม่คืน LINE subject หรือ session token |
| POST /api/auth/logout | ตรวจ exact Origin + CSRF token แล้ว revoke session และลบ cookie |

## การตรวจและ session

- ขอ scopes openid profile เท่านั้น ไม่ขอ email/phone และไม่ถือว่าการ login เป็นการตรวจบัตรประชาชนหรือใบขับขี่
- ตรวจ issuer, audience, nonce, expiry, issued-at และ LINE subject จาก response ของ verify endpoint ฝั่ง server
- PKCE S256, state และ nonce ใช้ randomness จาก Web Crypto
- Cookie __Host-coago_oauth: Secure, HttpOnly, SameSite=Lax, Path=/, อายุ 10 นาที; raw token อยู่ใน cookie แต่ฐานข้อมูลเก็บ hash
- Callback ต้องตรงทั้ง cookie hash และ state hash และ consume ด้วย DELETE RETURNING แบบ atomic ก่อนสร้าง session ป้องกัน replay/concurrent use
- Cookie __Host-coago_session: Secure, HttpOnly, SameSite=Lax, Path=/, อายุ 24 ชั่วโมง; DB เก็บ SHA-256 token hash
- Session revoke ได้และหมดอายุแน่นอน ไม่มี automatic merge บัญชีจากชื่อหรือรูป
- ผูกบัญชีด้วย provider+verified subject มี unique primary key และ transaction/advisory lock เพื่อไม่สร้างผู้ใช้ซ้ำเมื่อ first login พร้อมกัน
- จำกัด start 20 ครั้งต่อ 10 นาทีต่อ IP pseudonym ใช้ HMAC ของ IP กับ channel secret ไม่เก็บ IP ดิบ
- Auth responses ตั้ง Cache-Control:no-store และไม่คืน provider error หรือ credentials
- Static/API responses มี CSP, nosniff, frame protection และ no-referrer; แสดง display name ด้วย React escaping

## Schema และ migration

Migration 0001 เพิ่ม users, external_identities, oauth_flows, auth_sessions และ auth_rate_limits พร้อม foreign keys และ expiry indexes โดยไม่แก้ migration 0000 ที่ใช้งานแล้ว

Flow/session/rate records ที่หมดอายุถูกล้างเมื่อเริ่ม login รอบถัดไป Session ที่หมดอายุไม่ถูกยอมรับแม้ record ยังไม่ถูกล้าง ไม่มีรูป เอกสาร หรือ provider access/refresh tokens เก็บใน DB

## Local setup

ตั้ง APP_ORIGIN, LINE_CHANNEL_ID, LINE_CHANNEL_SECRET และ LINE_CALLBACK_URL ใน apps/api/.dev.vars ตามตัวอย่าง ค่าจริงต้องไม่อยู่ใน Git

APP_ORIGIN และ callback ต้องเป็น origin/path เดียวกัน โดย callback ลงท้าย /api/auth/line/callback เท่านั้น ใช้ HTTPS สำหรับ staging; อนุญาต HTTP เฉพาะ localhost/127.0.0.1 ใน local/test

หลัง pnpm db:migrate:

```sh
pnpm test
pnpm test:auth:integration
pnpm build
pnpm test:auth:workers
pnpm test:browser
```

Auth unit/provider tests ใช้ mocks; auth database tests ใช้ PostgreSQL จริง; Workers auth test ใช้ workerd + PostgreSQL จริง แต่จำลอง LINE token/verify endpoints ต้องไม่รายงานว่า login บัญชี LINE จริงผ่านจาก tests เหล่านี้

## Staging ที่แยกจาก production

Workflow LINE Login staging ใช้ secrets ที่เจ้าของตั้งไว้ สร้าง/อัปเดตเฉพาะ Worker และ Hyperdrive ชื่อ coago-line-test และ Neon test branch ที่ระบุใน COAGO_TEST_DATABASE_URL

- ตรวจชื่อ channel ให้ตรง COAGO Test เท่านั้น
- ไม่ overwrite Worker ชื่อซ้ำที่ไม่มี ownership marker ของ repository นี้
- ไม่ reuse Hyperdrive ที่ไม่ได้ผูกกับ staging Worker นี้
- ปิด query caching เพื่อไม่ cache ข้อมูล session/revocation
- ใช้ TLS certificate verification สำหรับ migration ผ่าน Neon Direct
- Apply versioned migrations เฉพาะฐาน test ที่เจ้าของเตรียม; ไม่เปลี่ยน production
- ให้ frontend/API อยู่ origin เดียวกันผ่าน Workers Assets
- ใส่ LINE_CHANNEL_SECRET ด้วย Wrangler secrets file ใน RUNNER_TEMP (0600) ไม่เก็บเป็น plaintext var หรือ artifact
- หลัง deploy ตรวจ HTTPS, root assets, readiness, anonymous session และ LINE authorization redirect/PKCE configuration
- เก็บ Worker/Hyperdrive ทดสอบไว้ให้เจ้าของกด login จริง หลังล้มเหลวครั้งแรกพยายามล้าง resources ที่เพิ่งสร้างและรายงานหาก cleanup ไม่สำเร็จ

Staging URL และ Callback URL ต้องใช้ค่าที่ deployment แสดงจริงเท่านั้น ห้ามเดา workers.dev subdomain และห้ามนำ URL ไปแทน callback ของ channel coago เดิม

Neon coago-test ตั้ง auto-delete 7 วัน เมื่อ branch หมดอายุ staging จะใช้งานไม่ได้ ต้องเตรียม test database ใหม่ ส่วน Worker/Hyperdrive จะยังอยู่จนกว่าจะลบหรืออัปเดต

## เกณฑ์รับงานและ manual test

1. Automated checks ผ่าน พร้อมแยก mocked LINE tests ออกจาก real database/runtime
2. มี URL staging ที่เปิดได้และ health/session/start configuration ผ่านจริง
3. เจ้าของเพิ่ม Callback URL ใน channel COAGO Test และใช้บัญชี tester login/consent จริง
4. กลับมาพบชื่อผู้ใช้ โหลดใหม่แล้วยังมี session และกด logout แล้วกลับเป็น anonymous
5. ทดลองปฏิเสธ consent แล้วเห็นข้อความทั่วไปและลองใหม่ได้

ข้อ 3–5 ต้องมีการโต้ตอบจากเจ้าของบัญชี LINE จึงยังไม่ถือว่าผ่านก่อนทำจริง

เอกสารอ้างอิง: https://developers.line.biz/en/docs/line-login/integrate-line-login/ และ https://developers.line.biz/en/reference/line-login/
