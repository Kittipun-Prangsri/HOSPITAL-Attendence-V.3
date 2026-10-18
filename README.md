# KHH HRM — ระบบลงเวลาและบริหารงานบุคคล โรงพยาบาลคลองหาด

ระบบลงเวลาปฏิบัติงานและบริหารงานบุคคล ทำงานร่วมกับเครื่องสแกนใบหน้า Hikvision และฐานข้อมูล HOSoffice
มีหน้าเว็บสำหรับเจ้าหน้าที่และผู้ดูแล, LINE OA / Telegram สำหรับแจ้งเตือน และหน้า LINE (LIFF) สำหรับสแกนใบหน้าผ่านมือถือ

- Production: https://attendance.kittikhos.site (Windows server, PM2 `attendance-system`)
- ตรวจสุขภาพระบบ: `GET /health` → `{"status":"ok", …}`

---

## ฟีเจอร์

### เจ้าหน้าที่
| ฟีเจอร์ | ที่ใช้ |
|---|---|
| ตารางเวรของฉัน, การลา (ยื่น/สิทธิ์คงเหลือ/ไฟล์แนบ), ขอ OT, แจ้งสาเหตุการลงเวลา | เว็บ |
| **สแกนใบหน้าผ่านมือถือ** (ลงทะเบียน → อนุมัติ → สแกนเข้า/ออก + GPS) | LINE (LIFF) `/m/face` |
| **เดือนนี้ของฉัน**: ปฏิทินสถานะรายวัน แตะวันที่สาย/ขาดแล้วแจ้งเหตุได้ทันที | LINE (LIFF) `/m/face?tab=month` |
| ปุ่มตอบกลับด่วน: สแกนใบหน้า, เดือนนี้, สแกนล่าสุด, ประวัติวันนี้, สิทธิ์ลาคงเหลือ, ยื่นใบลา, ตารางเวร, ขอไอดี | LINE OA |
| ผูก LINE เอง (login ครั้งเดียว), เชื่อม Telegram ด้วยลิงก์ใช้ครั้งเดียว | LINE (LIFF) |
| ความปลอดภัยบัญชี: แอป Authenticator / รหัสทาง Telegram / รหัสกู้คืน | เว็บ `/security` |

### หัวหน้ากลุ่มงาน
อนุมัติใบลา, OT, คำร้องแก้ต่าง และการสแกนนอกพื้นที่ **เฉพาะบุคลากรในกลุ่มงานที่ดูแล** (ไม่รวมของตนเอง) — Super Admin กำหนดที่ *สิทธิ์ตามบทบาท → หัวหน้ากลุ่มงาน*

### ผู้ดูแลระบบ
- แดชบอร์ด, ตรวจสอบเข้า–ออกงาน, ทะเบียนบุคลากร, จัดตารางเวร
- รายงานรายวัน/รายเดือน/ชั่วโมงทำงาน และ **ชุดรายงาน HR (Excel)**: สรุปรายเดือน (มา/สาย/ขาด/ลาแยกประเภท/OT/ค่า OT), ปฏิทินรายวัน, OT, ใบลา
- วันหยุดราชการ, สิทธิ์การลาตามประเภทบุคลากร, **อัตราค่า OT**, **ช่วงเครื่องสแกนขัดข้อง**
- ใบหน้า / สแกนมือถือ: อนุมัติใบหน้า, คิวการสแกนนอกพื้นที่, ตั้งค่าจุดสแกน (พิกัด + รัศมี)
- จัดการผู้ใช้, สถานะ LINE/Telegram/โควตา/เครื่องสแกน/สำรองข้อมูล, บันทึกการใช้งาน (audit)

### งานอัตโนมัติ (cron ใน `scripts/attendance_cron.js`)
| เวลา | งาน |
|---|---|
| ทุก 5 นาที | ตรวจการเชื่อมต่อฐานข้อมูล → เตือนแอดมินเมื่อล่ม/กลับมา |
| ทุก 10 นาที (จ–ศ 07:30–16:30) | เครื่องสแกนเงียบเกิน 45 นาที → เตือนแอดมิน |
| 01:00 | ซิงก์ขาด/สาย (incident) เดือนนี้และเดือนก่อน |
| 02:00 | ลบรูปตอนสแกนมือถือที่เกินระยะเก็บ |
| 03:00 | **สำรองฐานข้อมูล** (`.sql.gz`, เก็บ 14 วัน) |
| 08:30 จ–ศ | เตือนคำขอที่ค้างอนุมัติเกิน 2 วัน |
| 17:30 จ–ศ | เตือนลืมสแกนออก (Telegram) |
| ศุกร์ 17:00 | สรุปรายสัปดาห์ |

---

## กฎสำคัญของระบบ
- **ขาด/สาย** (incident): วันที่มีชื่อในตารางเวร เทียบเวลาเริ่มเวร (ตั้งค่า → ประเภทเวร; ค่าเริ่มต้น เช้า 08:00 บ่าย 16:00 ดึก 00:00) โดยนับการสแกนตั้งแต่ 3 ชม. ก่อนถึง 8 ชม. หลังเริ่มเวร · เจ้าหน้าที่เวร (template 2) นับเฉพาะวันที่มีเวร · สายสำนักงานนับ จ–ศ ที่ไม่ใช่วันหยุด · ไม่นับวันลา และช่วงเครื่องสแกนขัดข้อง
- **การลา**: ปีงบประมาณเริ่ม 1 ต.ค. · ไม่นับวันหยุด (ยกเว้นลาคลอด/อุปสมบท) · ลาป่วยตั้งแต่ 3 วันต้องแนบใบรับรองแพทย์
- **ค่า OT**: อัตราต่อชั่วโมงตามประเภทวัน (วันทำการ/วันหยุด) และประเภทบุคลากร มีเพดานชั่วโมงต่อวันรวมทุกคำขอ — ค่าเริ่มต้น 50/60 บาท 4/7 ชม. (**ให้งานการเงินตรวจสอบ**)
- **สแกนผ่านมือถือ**: ภาพหน้าตรงต้องตรงกับใบหน้าที่อนุมัติ + ภาพหันหน้าตามคำสั่งสุ่ม (server ตรวจเอง) + อยู่ในรัศมี → บันทึกลง `hikvision` ทันที; นอกพื้นที่/GPS ไม่แม่น/คะแนนก้ำกึ่ง → รอหัวหน้าอนุมัติ
- **LINE OA โควตา push 300/เดือน**: `LINE_PUSH_POLICY=important` (ค่าเริ่มต้น) — LINE ส่งเฉพาะผลอนุมัติ/เตือนค้างส่ง/แจ้งแอดมิน; การ์ดสแกนไป Telegram; ปุ่มและคำตอบแชตใช้ reply (ฟรี)
- **ระบบไม่เขียน `hosoffice.hr_person` เลย** — อ่านผ่าน VIEW `hospital_db.v_staff` (ข้อมูลที่งานบุคคลแก้ใน HOSoffice เห็นทันที) ส่วนที่ระบบนี้แก้เก็บใน hospital_db และมีผลเหนือค่าของ HOSoffice:
  `app_accounts` (บทบาท/รหัสผ่าน/ปิดบัญชี) · `staff_profiles` (ชื่อเล่น เบอร์ อีเมล เวร เวลาเข้า–ออก; แก้ให้ตรงกับ HOSoffice = กลับไปใช้ค่า HOSoffice) · `messaging_links` (LINE/Telegram)
  — สร้างบัญชีได้เฉพาะคนที่มีในทะเบียน HOSoffice แล้ว · `npm run migrate` สร้าง VIEW ใหม่ทุกครั้ง (รองรับคอลัมน์ที่ HOSoffice เพิ่ม)
- **แอดมิน login ด้วยรหัสผ่าน ต้องยืนยัน 2 ขั้น** (Authenticator หรือ Telegram) · login ผ่าน LINE ไม่ได้สิทธิ์แอดมิน

---

## เทคโนโลยี
Node.js + Express · EJS + Tailwind CSS 3 · MySQL (2 ฐาน: `hospital_db` ของระบบนี้ และ `hosoffice`) · express-mysql-session · helmet · LINE Messaging API + LIFF · Telegram Bot · `@vladmandic/human` (จดจำใบหน้า, WASM) · exceljs · node-cron · PM2

```
src/            controllers, routes, middleware, services, utils, constants
views/          หน้าเว็บ (EJS)  ·  views/mobile-face.ejs = หน้า LIFF
public/         css (build แล้ว), js, images
scripts/        migrations.js, attendance_cron.js, backup_db.js, rebuild_incidents.js
test/           unit (node --test) และ test/integration (MySQL จริง)
docs/           line-richmenu (ภาพและไฟล์ต้นฉบับ Rich Menu)
```

---

## ติดตั้ง (เครื่องใหม่)
```bash
npm install
cp .env.example .env        # แล้วแก้ค่าตามด้านล่าง
npm run migrate             # สร้าง/อัปเดตตารางใน hospital_db
npm run build               # build CSS (Tailwind)
npm start                   # หรือ npm run dev
```
ตั้งรหัสผ่านให้บัญชีที่ยังไม่มี: `NEW_PASSWORD="…" npm run reset-password -- <HR_CID>`

### ค่าใน `.env` ที่สำคัญ
| ค่า | ใช้ทำอะไร |
|---|---|
| `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME_HOSPITAL`, `DB_NAME_HOSOFFICE` | ฐานข้อมูล |
| `SESSION_SECRET` | สุ่มยาว ๆ (ใช้เข้ารหัสรหัสลับ Authenticator ด้วย — **ห้ามเปลี่ยน** หลังมีคนตั้งค่าแล้ว) |
| `PORT`, `SYSTEM_URL` | พอร์ต และ URL สาธารณะ (ใช้ในลิงก์แจ้งเตือน) |
| `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `LINE_ADMIN_USER_ID` | LINE OA (secret ใช้ตรวจลายเซ็น webhook) |
| `LINE_LOGIN_CHANNEL_ID`, `LIFF_ID` | LINE Login channel + LIFF (endpoint `https://<โดเมน>/m/face`, Full, openid+profile) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`, `ENABLE_TELEGRAM_POLLING=true` | Telegram bot (polling ต้องเปิดเพื่อรับคำสั่ง/ผูกบัญชี) |
| `FACE_TEMPLATE_KEY` | กุญแจเข้ารหัสใบหน้า 64 hex (**สำรองเก็บไว้ หายแล้วต้องลงทะเบียนใหม่ทุกคน**) |
| `BACKUP_DIR`, `BACKUP_KEEP_DAYS`, `BACKUP_HOSOFFICE_TABLES=hikvision` | สำรองข้อมูล |
| `LINE_PUSH_POLICY`, `REALTIME_COPY_ADMIN`, `FORGOT_CHECKOUT_TIME`, `SCANNER_SILENCE_MINUTES`, `SCANNER_WATCH_HOURS` | ปรับพฤติกรรมการแจ้งเตือน |
| `ADMIN_MFA=off` | **ฉุกเฉินเท่านั้น**: ปิดการบังคับยืนยัน 2 ขั้น |

รายละเอียดทุกค่าอยู่ใน `.env.example`

---

## Deploy บน server (Windows PowerShell — พิมพ์ทีละบรรทัด, ไม่ใช้ `&&`)
```powershell
cd D:\website\HOSPITAL-Attendence-V.3-main
git checkout -- public/css/erp.css      # ไฟล์นี้ถูก build ทับบน server ทำให้ pull ไม่ได้
git pull origin main
npm install                              # เมื่อมีแพ็กเกจใหม่
npm run migrate                          # เมื่อมี migration ใหม่ (ดูบรรทัด "Applied …")
pm2 restart attendance-system --update-env
pm2 logs attendance-system --lines 30 --nostream
```
ตรวจ: เปิด `/health` · ถ้าเปลี่ยนกฎนับขาด/สาย ให้คำนวณย้อนหลัง
`node scripts/rebuild_incidents.js --from 2025-10 --to 2026-10` (ดูตัวเลข) แล้วเติม `--confirm`

> ใช้ `node scripts/xxx.js --flag` แทน `npm run xxx -- --flag` บน PowerShell (npm ตัด flag ทิ้ง)

---

## งานดูแลระบบ
- **สำรอง/กู้คืน**: `npm run backup` สำรองทันที · กู้คืน: แตก `.gz` (7-Zip) → Navicat *Execute SQL File* ลงฐานข้อมูลใหม่ก่อน ตรวจแล้วค่อยสลับ · ควรคัดลอกโฟลเดอร์สำรองออกนอกเครื่องสัปดาห์ละครั้ง
- **เครื่องสแกนขัดข้อง** (ข้อมูลไม่เข้า): ดึงย้อนหลังจากเครื่อง Hikvision ถ้าทำได้ แล้ว rebuild; ถ้าไม่ได้ บันทึกช่วงที่ *วันหยุดและนโยบายการลา → เครื่องสแกนขัดข้อง*
- **แอดมินถูกล็อกยืนยัน 2 ขั้น**: ใช้รหัสกู้คืน → หรือแอดมินอีกคน → สุดท้าย `ADMIN_MFA=off` + `pm2 restart … --update-env` แล้วรีบตั้งค่าใหม่และลบออก
- **โควตา LINE**: ดูที่ *ผู้ใช้งาน → แท็บแจ้งเตือนล้มเหลว* (กล่อง LINE OA)

---

## คู่มือ: ตั้งค่าแอป Authenticator (แอดมิน)
1. ติดตั้ง **Google Authenticator** หรือ **Microsoft Authenticator** บนมือถือ
2. เว็บ → *บริการตนเอง → ความปลอดภัยบัญชี* → **ตั้งค่าแอป Authenticator** → สแกน QR ด้วยแอป (ปุ่ม +)
3. พิมพ์ตัวเลข 6 หลักจากแอป → **ยืนยัน** → **พิมพ์/คัดลอกรหัสกู้คืน 8 ชุด** เก็บไว้นอกมือถือ (แสดงครั้งเดียว)
4. ทุกครั้งที่ login: รหัสผ่าน → ตัวเลข 6 หลักจากแอป
- รหัสไม่ผ่าน: เปิด *วันที่และเวลาอัตโนมัติ* ในมือถือ · ลืมมือถือ: ใช้รหัสกู้คืนหรือ *ส่งรหัสทาง Telegram* · เปลี่ยนเครื่อง: ปิดแล้วตั้งค่าใหม่

---

## พัฒนาและทดสอบ
```bash
npm test                    # unit tests
npm run test:integration    # สร้างฐานข้อมูลทดสอบ khh_test_* บน MySQL ในเครื่อง (root ไม่มีรหัส) แล้วลบทิ้ง
npm run watch:css           # Tailwind ระหว่างแก้หน้าเว็บ
```
- ภาษาไทยเพี้ยนบน server: MySQL ของโรงพยาบาลบังคับ tis620 — ระบบสั่ง `SET NAMES utf8mb4` ทุก connection แล้ว (`src/config/db.js`) อย่าลบออก
- ไฟล์ CSS/JS ของระบบอ้างด้วย `asset('/css/erp.css')` (มีเลขเวอร์ชันตามเนื้อหา) เพราะ proxy หน้าเว็บสั่ง cache 4 ชั่วโมง

## ความปลอดภัย (สรุป)
CSRF token ทุก API ที่แก้ข้อมูล · helmet/CSP · session ใน MySQL · จำกัด login ผิด 10 ครั้ง/15 นาที · ตรวจลายเซ็น LINE webhook · ข้อมูลใบหน้าเข้ารหัส AES-256-GCM และขอความยินยอมตาม PDPA · ยืนยัน 2 ขั้นสำหรับแอดมิน · audit log ทุกการอนุมัติ/แก้ไขสำคัญ
