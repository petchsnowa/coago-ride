# Root Admin verification — 11 November 2026

ผล local บน Node24.22.1 / pnpm11.25.0, PostgreSQL17.11 / PostGIS3.5.7, Wrangler4.110.0 (local workerd runtime). ไม่ใช่หลักฐาน production deployment, real LINE callback หรือ Free-plan CPU quota

- TypeScript/lint ผ่าน; Vitest237 tests ผ่าน รวม API authorization/CSRF/body limits, fresh-root-session guard, private UI/removal on logout, required reasonsและconfirmation
- Web build/Workers dry run ผ่าน (ตั้ง XDG config/cache เป็น workspace สำหรับ environment นี้); db:generate ไม่มีschema drift; migrations0000–0008 localผ่าน
- Local real DB integrations: original auth/trips/discovery/request/decisions/race/upgrade/readiness/bootstrap ผ่าน; Hyperdrive probeบนlocal Workersและproduction guard runtimeผ่าน (local JSON binding ไม่ใช่remote Hyperdrive)
- Root integration ผ่าน: allowlisted subject/suspended state/root protection, signupและserviceclosed, fresh verified session/legacydenied, real Workers→Postgresadmin200/normal403/closedpublic503, revokeทุกsession, authsuspendedblocked, discoveryhides/reenablesdriver, optimisticversions, cancel/refundonce/auditonce, atomicrollbackเมื่อaudittriggerfail, keyset20+6/privateDTO, concurrentrootpassengerrequestกับRootcancelไม่deadlock
- Root migration upgrade integration ผ่าน: baseline7→9, ข้อมูลusersคงอยู่, defaultclosed, guardexistingdata, SQLfailureย้อนทั้งสองnewmigrations, retryคงflags/version, hashdriftrejected
- Playwright46existing scenarios +2RootAdmin mobile/desktop ผ่าน; Rootfixtureตรวจหน้า6แท็บ, reasonrequired, mutationCSRFและไม่มีhorizontaloverflow. ข้อมูลและAPIในbrowser suiteจำลอง; ไม่อ้างเป็นlivebrowser→production

ยังไม่ทำ production migrations/upload, DNS/canonical cutover หรือ live Root login. ต้องบันทึก ownerLINEsubject Environment secret และเจ้าของตรวจ manual acceptance ตาม root-admin.md ก่อน launch. ไม่มีการเปิดPaid planหรือสร้างบริการเสียเงิน
