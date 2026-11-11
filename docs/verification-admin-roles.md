# แยก Root และ Admin — 11 พฤศจิกายน 2026

Local verification บน Node24/pnpm11, PostgreSQL17.11/PostGIS3.5.7 และ local Workers runtime. Production ยังไม่ได้ upgrade/deploy จากงานนี้

- typecheck/lint และ245 unit/API/UI tests: Root-only role/settings API, admin moderation, rejected role=root/actor spoof, required reason/version/CSRF, UIแบ่งสิทธิ์
- Real DB/Admin API: Root grant/retry/revoke/suspend/reactivate, freshlogin, admin self/peer/root protection, admin ordinary-user moderationและtripcancel, audit failure rollbackรวมrole, revoke vs concurrentmoderation, sessionrevocationและstaleversion
- Baseline migrations7→10 และ9→10: preserveduser/defaultuserrole/siteflags, existing-data guard, failedtransaction rollback, hashdriftและidempotent retry
- Migration0009 เป็น additive: users.role user/admin และauditactions; ไม่แก้0000–0008ที่ใช้งานแล้ว
- Browser testsใช้ API fixtures; ไม่ใช่real LINE/root/admin manual acceptance หรือproduction CPU measurement. ต้องให้เจ้าของยืนยันด้วยสองบัญชีหลังนำขึ้นจริง
