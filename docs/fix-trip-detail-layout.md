# แก้ส่วนหัวรายละเอียดเที่ยว

10 พฤศจิกายน 2026: เจ้าของส่งภาพเว็บจริงที่ค้นหาและเปิดรายละเอียดสำเร็จ แต่หัวข้อถูกบีบหลายบรรทัดและปุ่มปิดล้นกรอบ

สาเหตุ: global button width:100% ประกอบกับ flex-shrink:0 ใน detail header ทำให้ปุ่มกินความกว้างทั้งแถวและเบียดหัวข้อ เมื่อจอเกิน breakpoint มือถือ640px

แก้เฉพาะส่วนหัวให้เป็น CSS Grid (minmax(0,1fr) auto) หัวข้อมีพื้นที่ยืดหยุ่น ปุ่มกว้างพอดีข้อความและอยู่ในกรอบ บนมือถือ640pxลงมาแยกเป็นหนึ่งคอลัมน์พร้อมปุ่มเต็มแถว

เพิ่ม browser regression ตรวจหัวข้อ/ขอบปุ่มและ overflow ที่390/640/641/768/1024/1440px ก่อนแก้ testล้มที่641px หลังแก้ผ่าน พร้อมภาพหน้าจอdesktop/mobileใน test artifacts และตรวจด้วยตา

Local: lint/typecheck,108tests,build/Workers dry run และชุดbrowser ตรวจทั้ง owner CRUD/discovery เดิมกับ layout regression ผ่าน ผลCIและstagingดูได้จาก PR บน branch codex/fix-trip-detail-layout

รอบนี้ไม่มีการเปลี่ยน API/contracts/schema/migrations ใช้ COAGO Test เดิม ไม่มีproduction deployment/DNS/channel changes ภาพที่เจ้าของส่งยืนยัน manual search/detail จริงแล้ว ยังไม่ใช่การยืนยัน manual cancelled-search flow
