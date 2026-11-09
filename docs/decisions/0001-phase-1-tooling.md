# Phase 1 tooling

เลือก pnpm 11.25.0 / Node.js 24.22.1 และ TypeScript 5.9.3 เพื่อให้เข้ากับ typescript-eslint รุ่นที่ติดตั้ง (TypeScript 7 ยังอยู่นอก peer range ของ lint tooling) เวอร์ชัน dependencies ที่ตรวจจริงอยู่ใน package manifests และ pnpm-lock.yaml

ใช้ PostGIS 17-3.5-alpine แทน Debian image เพื่อให้ local test ใช้พื้นที่น้อยลงหลังพบ Docker VFS ทำให้พื้นที่เครื่องทดสอบเต็ม ไม่มีการเปลี่ยน storage driver หรือแตะข้อมูลของโปรเจกต์อื่น

Schema มีเพียง system_metadata และ PostGIS extension; การทำบัญชีผู้ใช้ผ่าน LINE Login และ schema ธุรกิจเป็น Phase 2

Remote Hyperdrive และ database provider ยังไม่สร้างหรือทดสอบใน Phase 1 จึงไม่ใส่ binding ID สมมติใน config

ตรึง Wrangler 4.110.0 และ Miniflare 4.20260708.1 พร้อม compatibility_date 2026-07-08 ให้ใช้ workerd รุ่นเดียวกัน หลัง Wrangler 4.158.0 ที่ดึง Miniflare 5 beta เริ่ม local server ค้าง การเลือกวันที่นี้เป็น compatibility baseline ที่ทดสอบ ไม่ใช่วันที่ปัจจุบัน

กำหนด dependency overrides สำหรับช่องโหว่ใน dev tooling: miniflare>sharp 0.35.5, miniflare>undici 7.30.1, @esbuild-kit/core-utils>esbuild 0.25.12 และ minimatch@10 เป็น 11.0.1 ตรวจ audit และทดสอบ tooling ที่เกี่ยวข้องซ้ำแล้ว ไม่ override minimatch รุ่นเก่าทุก major เพราะ API อาจต่างกัน เพิ่ม pnpm audit เป็น CI gate ระดับ high
