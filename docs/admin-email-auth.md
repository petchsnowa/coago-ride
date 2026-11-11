# Root/Admin ใช้อีเมลและรหัสผ่าน

คำสั่งล่าสุดของเจ้าของให้ staffเลิกใช้ LINE. สมาชิกทั่วไปยัง LINE; staffใช้emailเป็นusernameพร้อมpasswordและemailVerified=true จาก Neon Managed Better Auth. `/root` ใช้Rootเท่านั้น `/admin` ใช้Root/Admin. ไม่มีการเก็บรหัสผ่านหรือhashรหัสผ่านในCOAGO/Worker/GitHub; providerรับผิดชอบpassword hashing/reset

## ตั้งค่าก่อนสลับ

1. ในcoago-production branch production เปิด Better Auth / Managed Better Auth ตามNeon Console; เปิดEmail+PasswordและVerify at Sign-upแบบverification codes. ปิดAllow Localhostสำหรับproduction และใส่trusted domain `https://coago.space`. ตั้งแอปCOAGO Admin
2. คัดลอกAuth base URL ใส่GitHub Environment production Variable `NEON_ADMIN_AUTH_URL`. APIรับเฉพาะHTTPS *.neon.tech ไม่มีuserinfo/query/hash ไม่ใช้ URLจากbrowser และไม่followredirect
3. เจ้าของเลือกและบันทึก Secret `ROOT_ADMIN_EMAIL` เองตามที่ยืนยัน ไม่ส่งในแชต. ก่อนcutoverให้เจ้าของเตรียมบัญชีอีเมลนี้ในproviderและยืนยันการรับอีเมล/ตั้งpasswordด้วยตนเอง. ไม่มีfirst-user root/seedpassword/defaultpassword
4. สร้าง32random bytes ด้วย `openssl rand -base64 32` ในเครื่องที่เชื่อถือได้ ใส่Secret `MEMBER_DATA_KEY`. สำรองkeyแยก ห้ามส่งค่าในแชต/commit/เปลี่ยน keyโดยไม่ย้ายข้อมูล
5. ตั้งผู้ส่งอีเมล: Neon shared SMTPใช้dev/test; productionใช้Custom SMTP. ตัวเลือกResend Free (ตรวจ11พ.ย.2026) 3,000เมล/เดือน100/วัน. ยืนยันsender domain/subdomainที่ควบคุม เช่นauth.coago.space ตามDKIM/SPFที่ผู้ให้บริการออกให้ ใช้ SMTPในNeon ไม่ใส่SMTP/Resend keyในfrontend. ไม่เปิดpaid/add-ons/pay-as-you-goโดยอัตโนมัติ
6. ผ่านschemaupgradeและCIก่อน maintenance_update. อย่าเปลี่ยนบริการเป็นopenก่อนทดสอบRootใหม่ครบ. โค้ดเก่าบนเว็บจริงยังไม่เปลี่ยนจากการเตรียมPRนี้

[Neon pricing](https://neon.com/pricing): Managed Better Authอยู่Free allowance (ปัจจุบัน60,000 MAU/project); ไม่ต้องเปิดSupabase. [Neon production checklist](https://neon.com/docs/auth/production-checklist): shared SMTPสำหรับdev/test,แนะนำcustomสำหรับproduction; verification codeรองรับทั้งสอง. [Resend pricing](https://resend.com/pricing): Free3k/100วัน. การส่งฟรีมีquota/เงื่อนไข ไม่รับรองส่งไม่จำกัดหรือส่งถึงทุกmailbox

## การเข้าระบบ

- Rootใช้emailตรงกับsecretเท่านั้น หลังproviderยืนยันจริงจึงสร้างidentity `admin_email` และroot_verifiedsession. บัญชี LINEเดิมไม่ถูกยกระดับหรือโยงอีเมลโดยอัตโนมัติ เมื่อNEON_ADMIN_AUTH_URLถูกตั้ง staff APIอ่านเฉพาะcookieใหม่ `__Host-coago_admin`
- Root /root → เพิ่มบัญชีAdminด้วยemail/name/reason. ผู้ได้รับสิทธิ์เปิด/adminเลือกตั้งบัญชีตามคำเชิญ ตั้งpassword≥12ตัวอักษร ยืนยันOTP6หลักจากอีเมล แล้วlogin. ไม่ส่งรหัสผ่านตั้งต้นให้คนอื่น. Providerอาจเปิดpublicsignupตามข้อจำกัดNeon แต่COAGOไม่ให้staff session/roleแก่คนนอกallowlist/invitation
- กรณีบัญชีproviderมีอยู่แล้ว จะไม่เปลี่ยนเป็นหน้าverifyโดยเงียบๆ ให้ใช้login/forgot. ไม่รับ emailVerified หรือroleจากbrowser
- APIserverส่งcredentialsให้pinnedproviderผ่านTLSไม่followredirect อ่านcookieopaqueจากproviderและตรวจ/get-sessionฝั่งserver. ไม่ส่งprovider tokenให้browser/ไม่เก็บlocalStorage
- staffcookieSecure/HttpOnly/SameSiteLax/host-only1ชั่วโมง. Proofprovider cookieในDBเข้ารหัสAES-GCMผูกsessionhash. ทุกstaff requestตรวจprovider sessionยังvalid, emailVerified, identityตรงproof และrole/statusจากCOAGOใหม่. providerล้มเหลว/ถูก revokeให้failclosed
- CSRF+exact Origin+JSONสำหรับwrite; root-onlyrole/accounts/settings; Adminไม่จัดการRoot/peer. เปลี่ยนrole/suspendลบstaff sessionsทันทีพร้อมauditตามเดิม
- Resetpasswordผ่านลิงก์อีเมลของproviderแล้วส่งtokenกลับBFF; สำเร็จจะเพิกถอนCOAGOstaff sessionsทุกบัญชีเพื่อไม่ทิ้งsessionเก่าจากpasswordreset ไม่กระทบLINEmember sessions. ต้องให้staffloginใหม่ทั้งหมด
- Login/verify/resetจำกัด8attempts/10นาทีทั้งIPและemail. Mailbudget10/วัน/email,80/วันรวมช่วยกันส่งspamและสำรองquota. ไม่ใส่email/password/tokenลงlogs

## Manual acceptance / recovery

ทดสอบด้วยอีเมลRootจริง: unverifiedเข้าไม่ได้→OTP→login, refreshsession, logout, wrongpassword/rate, forgot/resetและsessionเก่าถูกตัด. Rootเพิ่มemailAdminคนที่อนุญาตแล้วให้เจ้าตัวตั้ง/ยืนยันเอง; adminไม่มีrole/settings,ถูกถอนสิทธิ์ใช้ต่อไม่ได้. สมาชิก LINEหรือการเปลี่ยนชื่อcookie userไปเป็นstaffไม่ให้สิทธิ์. `/root` ไม่เปิดแก่Adminแม้เข้าระบบผ่านแล้ว

หากprovider/SMTPยังไม่ได้ตั้ง จะยังไม่พร้อมเข้าสู่ระบบใหม่ ห้ามถือว่าmockedCIคือliveemailacceptance. ใช้NeonConsoleของเจ้าของกู้/ตรวจemailและresetด้วยผู้ควบคุมจริง ไม่มีbackdoorpasswordหรือfallbackLINEเมื่อเปิดemailmode. เปลี่ยนROOT_ADMIN_EMAILผ่านdeploymentได้เฉพาะการกู้ที่เจ้าของควบคุม และต้องยืนยันอีเมลใหม่จริงก่อนใช้งาน. ดูแลbackup/restoreNeonและmasterkeyนอกแชต

งานนี้ไม่ได้สร้างNeonAuth/Resend account ไม่ได้แก้DNSsender/ส่งอีเมลจริง ไม่ได้รู้Root email/password และยังไม่ได้ปรับbillingplan
