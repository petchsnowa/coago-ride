# ผลตรวจ Phase 2A — LINE Login

วันที่ 9 พฤศจิกายน 2026

## Staging ที่ยืนยันแล้ว

- เว็บทดสอบ: https://coago-line-test.akkarapatchara.workers.dev
- Callback สำหรับ channel COAGO Test (2012503801): https://coago-line-test.akkarapatchara.workers.dev/api/auth/line/callback
- [Deployment/HTTPS smoke checks](https://github.com/petchsnowa/coago-ride/actions/runs/42590627985)
- [CI บน commit ที่ทดสอบ](https://github.com/petchsnowa/coago-ride/actions/runs/42590635517)
- Commit ที่ตรวจ: 8d56e3c3d4108c937ef63637b46613347b56e422

## ผลตรวจ

| Check | ผล |
| --- | --- |
| Frozen install, lint, TypeScript | ผ่าน local และ CI |
| Dependency audit | ไม่พบ known vulnerabilities ขณะตรวจ |
| Unit/API/UI/config tests | 49 tests ผ่าน |
| Migration | Generate no schema drift, apply และ repeat apply ผ่าน |
| Auth PostgreSQL integration | ผ่าน: one-time/expired flow, concurrent first login, hashed session, expiry/revoke และ rate limit |
| Workers auth runtime | ผ่านกับ PostgreSQL จริงและ LINE token/verify endpoints ที่จำลองไว้ |
| Existing Workers/PostGIS checks | ผ่าน |
| Browser mobile/desktop | ผ่าน 2 tests; health/session responses จำลองใน browser suite |
| Frontend build / Workers dry run | ผ่าน |
| Staging migration บน Neon test | ผ่าน |
| Staging HTTPS / static assets | ผ่าน |
| Staging Hyperdrive readiness | HTTP 200, status=ready |
| Staging anonymous session | user=null, csrfToken=null, loginAvailable=true |
| LINE authorization redirect | 302 ไป access.line.me, client ID และ callback ตรง COAGO Test, มี PKCE S256 และ HttpOnly cookie |
| LINE authorization/consent จริง | **รอเจ้าของเพิ่ม Callback URL และกด login ด้วยบัญชี tester** |
| Real callback / refresh / logout หลัง LINE consent | **ยังไม่ทดสอบโดยผู้ใช้** |

รอบสร้าง staging ครั้งแรก smoke check ไม่ผ่านและลบ resources ที่เพิ่งสร้างแล้ว หลังเพิ่มข้อความวินิจฉัยแบบไม่เปิดเผย credentials การรันซ้ำผ่านทุกขั้น ยังไม่ได้สรุปสาเหตุของความล้มเหลวครั้งแรกว่าเป็นปัญหาโค้ดหรือการเผยแพร่ที่ edge จึงเก็บ run history ไว้ตามจริง

## สิ่งที่คงไว้สำหรับ manual test

Worker และ Hyperdrive ชื่อ coago-line-test ถูกเก็บไว้ให้เจ้าของทดลอง login จริง ฐานข้อมูลเป็น Neon coago-test ที่เจ้าของตั้ง auto-delete 7 วัน Channel secret ใช้เป็น Cloudflare secret ไม่อยู่ใน repository/frontend

ไม่มีการเปลี่ยน coago.space DNS, production routes หรือ LINE channel coago เดิม ไม่มีการ publish test LINE channel โดยอัตโนมัติ โค้ดยังอยู่ใน PR #2 ไม่รวม main จนกว่าเจ้าของตรวจงาน

## ขั้นตอนทดสอบจริง

1. เปิด channel COAGO Test (2012503801) → LINE Login → Use LINE Login in your web app
2. เพิ่ม callback ที่ระบุด้านบนและบันทึก โดยไม่แก้ channel coago เดิม
3. เปิดเว็บ staging และกดเข้าสู่ระบบด้วย LINE ใช้บัญชีที่มีสิทธิ์ tester/admin ตามสถานะ channel
4. ยินยอมแล้วกลับมาพบชื่อผู้ใช้ โหลดหน้าใหม่แล้วยังมี session จากนั้นกดออกจากระบบแล้วกลับเป็น anonymous
5. ลองปฏิเสธ consent และเริ่มใหม่ได้

อย่าส่ง authorization code, cookies, ID token, channel secret หรือ access token ลงในแชต/ภาพผลทดสอบ
