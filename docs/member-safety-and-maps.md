# สมาชิก รถ แผนที่ และค่าเดินทาง

ขอบเขตที่เจ้าของยืนยัน 11 พฤศจิกายน 2026: สมาชิกต้องกรอกข้อมูลและผ่าน Root/Admin ตรวจอนุมัติก่อนประกาศเที่ยว/ส่งคำขอ; รถต้องมีข้อมูล/รูป/ทะเบียนและผ่านตรวจ. ราคาต่อคนคงที่ตามจำนวนส่วนที่เจ้าของตั้ง ไม่คำนวณเก็บเพิ่มจากคนที่มาแล้วเมื่อที่นั่งไม่เต็ม. Root/Admin เปลี่ยนไปใช้อีเมลและรหัสผ่านแยกจาก LINE ของผู้ใช้ทั่วไป ตาม admin-email-auth.md

## หน้าใช้งาน

- `/` สมาชิก LINE, สถานะสมัคร และเที่ยว/คำขอของตน. `/account` กรอก/แก้ไขข้อมูลส่วนตัวและรถ; `/admin` สำหรับ Admin/Root และ `/root` เฉพาะ Root. ไม่รวมเครื่องมือคนขับกับหน้า staff
- ข้อมูลสมัคร: ชื่อจริง เบอร์โทร รูปใบหน้าปัจจุบัน ประเภทหลักฐาน บัตรประชาชนไทยหรือพาสปอร์ต หมายเลข ประเทศ และรูปหลักฐาน พร้อมยินยอมเวอร์ชัน2026-11-11
- เช็ค checksum บัตรไทยและรูปแบบพาสปอร์ตเท่านั้น ไม่เชื่อมทะเบียนราษฎร์ ไม่ตรวจใบหน้าชีวมิติ และไม่อ้างว่ารับรองเอกสารจากรัฐ. ผู้ดูแลต้องเปรียบเทียบรูป/ข้อมูลด้วยตนเอง
- ข้อมูลรถ: ยี่ห้อ รุ่น สี ทะเบียน จังหวัด ความจุ รูปรถ และรูปป้าย. มีรายการยี่ห้อ/รุ่นเริ่มต้นให้เลือกและพิมพ์เพิ่มเติมได้ ไม่ใช่ข้อมูลทะเบียนกรมขนส่ง. บันทึกรถไว้เลือกใช้ซ้ำ
- กรอก/แก้ไขแล้วสถานะ pending; ต้องตรวจใหม่ทุกครั้ง. stale version409. รถที่มีเที่ยวอนาคตซึ่งมี accepted passengers แก้ไม่ได้จนยกเลิกเที่ยวหรือเดินทางผ่านไป. ข้อมูลรถ/ราคาที่อยู่ในเที่ยวไม่ถูกเปลี่ยนตามการแก้รถ
- Admin/Root เปิดข้อมูลเป็นรายรายการ มี audit ทั้งการเปิดดูเอกสารและผลตรวจ ต้องให้เหตุผล ใช้ optimistic version ไม่อนุมัติรายการของบัญชีเดียวกัน. รายการตรวจ keyset20รายการ มีโหลดเพิ่ม
- ตรวจสิทธิ์และสถานะฝั่ง API/transaction ทั้งสร้าง/แก้เที่ยว ส่งคำขอ และตอบรับ. ถือ profile/vehicle share locks ขณะยืนยัน. รถต้องตรงเจ้าของ รุ่น สี ความจุ และเวอร์ชันที่อนุมัติ. การยกเลิกและดูประวัติของตนยังทำได้แม้อยู่ระหว่างตรวจใหม่. Root moderation ยังทำผ่าน staff APIs ได้
- รายการ public ไม่เผยชื่อจริง/เบอร์/เลขเอกสาร/ทะเบียน/รูปเอกสาร. รูปรถให้สมาชิกที่อนุมัติแล้วดูผ่าน authorized endpoint. จุดรับ–ส่งและระยะที่ระบุในเที่ยวเป็นข้อมูลผู้ใช้ทั่วไป จึงแนะนำจุดนัดรับสาธารณะ

## ที่เก็บรูปและข้อมูล

Private R2 binding `PRIVATE_DOCUMENTS` ไม่ใช้ public r2.dev/custom domain. รูปเข้ารหัส AES-256-GCM ก่อน R2; รูปอ่านผ่าน authenticated endpoint เท่านั้น. ข้อมูลส่วนตัวและทะเบียนใน Postgres เป็น encrypted JSON; lists มีเฉพาะสถานะ/ID/เลขท้าย4ตัวสำหรับผู้ดูแล ไม่มีข้อมูลลับใน public DTO

`MEMBER_DATA_KEY`: master secret32bytes แบบbase64 ใน Environment production. AAD ผูก ciphertext กับเจ้าของ/ชนิด/ID เพื่อป้องกันสลับข้อมูล. ห้ามเปลี่ยน key โดยไม่มี migration และสำรอง keyนอกแชตไว้ การทำ keyหายทำให้เอกสารเดิมอ่านไม่ได้

ฟอร์มรับต้นฉบับ JPEG/PNG≤8MB ย่อภาพและ re-encode ผ่าน canvas เพื่อลด metadata แล้วรับฝั่ง API≤512KiB เฉพาะ MIME/signature JPEG/PNG ไม่รับ SVG/HTML. ไม่ใช่ malware scanner; ผู้ดูแลต้องปฏิเสธรูปอ่านไม่ออก/ไม่ตรงหลักฐาน. APIรับ rawภาพจากผู้ใช้โดยตรงได้ จึงไม่อ้างว่า client re-encode รับประกันตัด metadata ทุก API client

จำกัด25 uploads/วัน/บัญชี,100ไฟล์/บัญชี,2500ไฟล์/วันรวม และ plaintext6GiBรวมใน dedicated bucket (encrypted base64ประมาณ8GiB) เพื่อสำรองพื้นที่ใน R2 free allowance. Transaction lockป้องกัน quota race; metadata/commitล้มเหลวพยายามลบ objectที่เพิ่งสร้าง. ขีดจำกัดนี้ไม่วัด objectsที่สร้างนอกแอปหรือบัญชีอื่น จึงไม่รับรองค่าใช้จ่ายทั้งบัญชี Cloudflare

R2ยังไม่ได้เปิดใช้ตามที่เจ้าของแจ้ง. ถ้าไม่มี bucket/key หน้าเว็บไม่รับเอกสารและ API fail closed. ตั้ง bucketภายหลังได้โดยไม่เปิดบริการ. ยังไม่มีการลบบัญชี/กำหนด retention อัตโนมัติในรุ่นนี้; การลบเอกสารต้องดำเนินการโดยผู้ดูแลตามคำขอและนโยบายที่เจ้าของกำหนด ไม่ควรอ้างว่าเป็นระบบตรวจเอกสารอัตโนมัติหรือรับรองการปฏิบัติตามกฎหมายครบแล้ว

## แผนที่และระยะทาง

Leaflet1.9.4 + OpenStreetMap raster tiles พร้อม attribution และ tile-specific Referrer-Policy. ไม่ prefetch/offline/bulk download; browserใช้ HTTPcacheตามผู้ให้บริการ. [OSM Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) ไม่มี SLA/ไม่รองรับ trafficไม่จำกัด

เลือกจุดรับ/ส่งโดยคลิกหรือกรอกพิกัด. คำนวณถนนผ่าน OpenRouteService/HeiGIT server-side เฉพาะเมื่อกดปุ่ม ไม่ส่ง API keyไปbrowser. Endpointใหม่ `https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson` ตาม [ประกาศผู้ให้บริการ](https://ask.openrouteservice.org/t/deprecating-api-openrouteservice-org-in-favour-of-api-heigit-org/7912). ไม่ใช้ endpointเดิมที่ยุติให้บริการเดือนพฤศจิกายน2026

`ORS_API_KEY` เป็นsecret. จำกัด10requests/นาที/คน และ500/วันรวม, providerยังมี quotaของตน. ถ้าขาดkey/quota/networkไม่พร้อม ให้กรอกระยะทางเองและติดป้าย manual; ไม่เปลี่ยนระยะเส้นตรงเป็นถนนโดยเงียบๆ ไม่ใช่ระบบนำทาง turn-by-turn/ติดตามรถสด/คำนวณรถติด

APIเซ็น road quote ด้วยกุญแจที่ deriveแยกจาก master, ผูกพิกัด/ระยะ/หมดอายุ15นาที. สร้างหรือแก้เที่ยวที่อ้าง source=road ต้องตรวจ proof. หมุดเปลี่ยนแล้วล้างระยะเดิม; ต้องคำนวณใหม่หรือระบุmanual. รายละเอียด publicแสดงหมุดและระยะที่บันทึกไว้ ไม่ fetch routingใหม่ทุกครั้งที่อ่าน

## หลักคำนวณ

ใช้จำนวนเต็มสตางค์:

- fuel = round(distanceKm × fuelSatangPerKm)
- operations = round(distanceKm × operationsSatangPerKm)
- total = fuel + operations + extra เช่น ทางด่วน
- pricePerSeat = ceil(total / shares) ปัดขึ้นหน่วยสตางค์

ตัวอย่าง100กม.,น้ำมัน3บาท/กม.,เสื่อม/ดำเนินงาน1บาท/กม.,ทางด่วน50บาท → รวม450บาท. หาร3ส่วน=150บาท/คน คง150แม้มีผู้ร่วมเพียง1คน. ส่วนที่ไม่มีผู้ร่วมเจ้าของรับผิดชอบ ไม่มีราคาอัตโนมัติหลังตอบรับ

จำนวนส่วน1–9 ต้องไม่น้อยกว่าที่นั่งที่เปิดรับ เพื่อไม่ตั้งยอดเต็มเที่ยวเกินต้นทุนโดยจำนวนส่วนผิดกัน (ไม่นับเศษปัดขึ้นไม่เกินshares−1สตางค์). ถ้าต้องการหารเพียง2ส่วน ให้เปิดรับไม่เกิน2ที่นั่ง แม้รถจุได้มากกว่า. อัตราเป็นข้อมูลเจ้าของกรอก ไม่ใช่อัตราทางราชการ และยังไม่มีการชำระเงิน

## นำขึ้นจริง

ต้องรวม Root/Admin role base และงานนี้ผ่านreview/CIก่อน. Migration0010 เพิ่ม3ตาราง/รายละเอียดsafety/หลักฐานstaff session → appTables13/migrations11. รัน Root Admin schema upgrade check ก่อน; สำรอง/ตรวจrestoreและเลือก allow_existing_dataเมื่อมีข้อมูล แล้วupgrade (7/9/10→11). ไม่แก้ประวัติ0000–0009

ทำ Neon Auth/email ตาม admin-email-auth.md. R2เลือกStandard dedicated bucket เช่นcoago-private-members ปิดpublicทั้งหมด ตั้ง Variable `COAGO_PRIVATE_DOCUMENTS_BUCKET`. ตั้งSecret `MEMBER_DATA_KEY` และ optional `ORS_API_KEY`. ไม่ใส่รหัสผ่านRootในGitHub. maintenance_updateจากmainขณะservice/registrationclosed

ยืนยันด้วยบัญชีทดสอบสองคน: สมัคร→pending→review→approved, แก้→pending, cross-user file403/404, รถapproved/capacity, routeจริง/manualfallback/quoteexpiry, fixedpriceแม้คนไม่เต็ม, request/accept/refund, adminstaffcookieไม่ให้LINEยึดสิทธิ์. ไม่ใช้เอกสารจริงใน automated tests. ยังไม่ได้migrate/deploy/ส่งอีเมล/อัปโหลดR2จริงจากงานพัฒนา

ค่าใช้จ่ายตรวจ11พ.ย.2026: [R2 pricing](https://developers.cloudflare.com/r2/pricing/) Free Standard10GB-month,1MClassA/10MClassB; เกินมีค่าบริการ ไม่เปิด paid หรือผูกบัตรโดยอัตโนมัติ. [ORS FAQ](https://giscience.github.io/openrouteservice/frequently-asked-questions) และ dashboardเป็นแหล่งquota keyจริง. Workers/Hyperdrive/Neonมีquotaแยก ไม่รับรองว่าแอปฟรีทุกปริมาณผู้ใช้

รุ่นถัดไปเพิ่มใบขับขี่/ประกาศหารถ/สถานะเดินทาง/คิวLINE: schema ปัจจุบัน12migrations/19tables ให้ใช้ [runbookล่าสุด](community-safety-and-journeys.md) แทนจำนวนรุ่น0010ข้างต้น.
