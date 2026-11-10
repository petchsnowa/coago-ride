# Phase 2D — เริ่มส่งคำขอร่วมเดินทาง

เจ้าของสั่งเริ่มระบบส่งคำขอ และให้คง PR #6 โดยไม่ merge งานนี้ต่อบน branch codex/trip-status-header ไม่ปรับดีไซน์หน้ารายการเพิ่มและไม่ merge/deploy production

กติการะยะแรกที่ใช้ในการพัฒนา: 1คำขอ=1ที่นั่ง, สถานะpending/cancelledเท่านั้น คำขอpendingไม่ใช่การได้ที่นั่งและไม่หัก/คืนที่นั่ง ยังไม่มีตอบรับ/ปฏิเสธ/ชำระเงิน ขั้นตอบรับและการจัดสรรที่นั่งเป็นงานถัดไป

ต้อง login ก่อนส่ง ดู หรือยกเลิกคำขอ ห้ามขอเที่ยวของตน เที่ยวที่ปิด/ออกเดินทาง/ไม่มีที่นั่งรับคำขอใหม่ไม่ได้ 1คนมีpendingได้1รายการต่อเที่ยว ยกเลิกpendingได้ทุกเวลาเพราะยังไม่จองจริง ส่งใหม่หลังยกเลิกได้เฉพาะเที่ยวที่ยังเปิด/อยู่ในอนาคต ใช้requestIdใหม่ การretryด้วยrequestIdเดิมต้องคืนคำขอเดิมแม้ยกเลิกไปแล้ว ไม่สร้างคำขอใหม่โดยเงียบๆ

ผู้โดยสารดูรายการของตนและยกเลิกpendingได้ เจ้าของเที่ยวดูเฉพาะคำขอของเที่ยวตน เห็นชื่อแสดงของผู้ขอเท่าที่จำเป็น ไม่มีLINEID/subject/เบอร์โทร/ทะเบียนเต็ม ก่อนส่งหน้าจอระบุว่าจะส่งชื่อแสดงให้เจ้าของเที่ยวเห็น

บันทึกversionเที่ยวตอนส่ง หากเจ้าของแก้รายละเอียดภายหลัง แสดงtripChangedเพื่อให้ตรวจข้อมูลล่าสุด ประวัติคำขอแสดงรายละเอียดเที่ยวปัจจุบัน ไม่ใช่snapshotราคาที่ตกลงกันแล้ว เพราะยังไม่มีการตอบรับ ก่อนเพิ่มการตอบรับต้องกำหนดreconfirmation/snapshot/seat allocationให้ครบ

ยกเลิกเที่ยวไม่ลบประวัติpending แต่แสดงว่าเที่ยวยกเลิก/ออกเดินทางแล้วแทนรอตอบรับ ส่วนผู้ขอยังยกเลิกpendingของตนได้ ไม่มีการส่งคำขอใหม่ให้เที่ยวที่ไม่พร้อม

API: /api/ride-requests/mine และ /incoming (owner-onlyผ่านsession,20รายการ+cursor), /for-trip/:tripId (contextของผู้ใช้เอง), POST / (tripId+requestId), POST /:id/cancel (emptyJSON) เขียนต้องOrigin+CSRF+strictJSON+bodylimit ใช้transaction/rowlockเที่ยวและunique indexesเพื่อกันduplicate/concurrent cancellation ไม่มีuserIDsจากclientเป็นแหล่งสิทธิ์

ผลtests/CI/remoteอยู่ในPR #6 จะระบุแยกmock/localDB/Workers/remote ใช้synthetic accountsในการทดสอบหลายฝ่ายแล้วcleanup ข้อมูลทดสอบNeonยังauto-deleteตามเดิม ต้องใช้บัญชีLINEคนละบัญชีสำหรับmanual driver/passenger ไม่ใช้บัญชีเจ้าของขอเที่ยวตัวเอง

## Verification

Local: unit/API/contractรวม134testsผ่าน; browserรวม40รายการทั้งเดิมและnewrequestflowผ่านทั้งdesktop/mobile (mockAPI) รวมcreate/pending/reload/cancel/logout,driverincoming/own-tripguard และlostresponseใช้keyเดิม PostgreSQLจริง17.11/PostGIS3.5.7: concurrent same-keyและdifferent-key,actor isolation,request replayหลังcancel,resubmit,trip cancel race,tripChanged,no seat mutation,DBconstraints,pagination ผ่าน LocalWorkersจริงตรวจหลายฝ่ายผ่านauth/session/pgTCP โดยจำลองเฉพาะLINEtoken/verify

Run links/CI/remoteผลจริงดูในPR #6 ต้องตรวจ remoteWorkers→Hyperdrive→Neon ก่อนอ้างว่า remoteผ่าน ใช้synthetic sessionsไม่ใช่realLINEหลายบัญชีของเจ้าของ; manualจริงยังรอเจ้าของลองด้วยLINE2บัญชี เก็บข้อมูลtestภายใต้auto-deleteเดิม ไม่มีproductionchanges

คำขอpendingที่tripยกเลิก/ออกเดินทางแล้วต้องแสดงสถานะเที่ยวไม่พร้อมทั้งdialogและรายการส่วนตัว แม้responseเป็นการreplayของคำขอเก่า ไม่แสดงว่ารอตอบรับเที่ยวที่ปิดไปแล้ว
