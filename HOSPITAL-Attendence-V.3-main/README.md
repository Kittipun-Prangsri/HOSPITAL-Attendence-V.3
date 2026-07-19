# Hospital Attendance System V.3

ระบบบริหารจัดการการลงเวลาทำงานสำหรับโรงพยาบาล (Hospital Attendance Management System) เชื่อมต่อข้อมูลจากเครื่องสแกนใบหน้า Hikvision และระบบ Hosoffice

## 🚀 ฟีเจอร์หลัก
- **Dashboard**: แสดงสถานะบุคลากรแบบ Real-time (เข้างาน, สาย, ลา)
- **Personnel Management**: จัดการข้อมูลบุคลากรและประวัติการลงเวลา
- **Scheduling**: ระบบจัดตารางเวร (Shift Scheduling) สำหรับพยาบาลและเจ้าหน้าที่
- **Reports**: รายงานสรุปการปฏิบัติงานรายวัน รายเดือน และสรุปชั่วโมงทำงาน
- **RBAC**: ระบบควบคุมสิทธิ์การใช้งาน (Admin, Manager, Staff)

## 🛠 เทคโนโลยีที่ใช้
- **Backend**: Node.js, Express
- **Database**: MySQL (MariaDB)
- **Frontend**: EJS (Embedded JavaScript templates), CSS
- **Integration**: Hikvision Face Recognition Terminal API/Database

## 📁 โครงสร้างโปรเจค
- `src/`: โค้ดหลักของระบบ (Controllers, Routes, Middleware, Constants)
- `views/`: หน้าจอการใช้งาน (EJS)
- `public/`: ไฟล์ Static เช่น CSS, Images
- `data/`: เก็บข้อมูล JSON สำหรับตารางเวรและ Seed ข้อมูล
- `scripts/`: สคริปต์สำหรับซิงค์ข้อมูลและตั้งค่าระบบ

## ⚙️ การติดตั้งและใช้งาน

1. ติดตั้ง Dependencies:
   ```bash
   npm install
   ```

2. ตั้งค่า Environment Variables:
   สร้างไฟล์ `.env` โดยคัดลอกตัวอย่างจาก `.env.example` แล้วระบุค่าการเชื่อมต่อฐานข้อมูล

3. ตั้งค่าฐานข้อมูลครั้งแรก:
   ```bash
   npm run init-db
   ```

4. เริ่มใช้งานโปรเจค:
   - โหมดปกติ: `npm start`
   - โหมดพัฒนา: `npm run dev` (ใช้ nodemon)

## 🔐 ข้อมูลการเข้าสู่ระบบ (เริ่มต้น)
- **Admin**: `admin` / `root1234`
- **User**: `staff` / `staff1234`
