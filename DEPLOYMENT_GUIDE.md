# คู่มือการตั้งค่าและ Deploy — เจ้าของระบบเท่านั้น

เอกสารนี้เป็นคำแนะนำเท่านั้น Codex ไม่ได้สร้างหรือแก้ไข Deployment ใด ๆ

## ข้อควรระวังเรื่องการแยกระบบ

นี่คือแอปพลิเคชัน PAC Student Ticket แยกจาก `pac-ticket-booking` โดยสมบูรณ์

- ห้ามใช้ Production `pac-ticket-booking` Script ID
- ห้ามใช้ Production Spreadsheet ID
- ห้ามใช้ Production `ADMIN_TOKEN`
- ห้ามใช้ข้อมูล Bookings หรือ Performances ของระบบเดิม
- ห้ามเลือก Library deployment
- ห้ามเปิดหรือแก้ไข Deployment ของระบบเดิม

## ขั้นตอนของเจ้าของระบบ

1. สร้าง Google Sheet ใหม่สำหรับระบบนักศึกษาโดยเฉพาะ
2. สร้าง Apps Script standalone project ใหม่โดยเฉพาะ ห้ามสร้างจากหรือผูกกับโปรเจกต์ระบบบัตรปกติ
3. ใน Script Properties ของโปรเจกต์ใหม่ เพิ่ม:
   - `SPREADSHEET_ID` = ID ของ Google Sheet ใหม่
   - `ADMIN_TOKEN` = token ใหม่ที่ไม่ใช้ร่วมกับระบบอื่น
4. คัดลอก `.clasp.json.example` เป็น `.clasp.json` ในเครื่อง แล้วใส่ **Script ID ใหม่ของนักศึกษา** เท่านั้น:

   ```json
   {
     "scriptId": "NEW_STUDENT_APPS_SCRIPT_ID",
     "rootDir": "src"
   }
   ```

5. ตรวจ `clasp status` ให้แน่ใจว่าชี้ไปยัง Script ID ใหม่ แล้วจึงรัน `clasp push`
6. เปิด Apps Script editor ของโปรเจกต์ใหม่และให้เจ้าของระบบรัน `setup()` **ด้วยตนเองหนึ่งครั้ง**
7. ตรวจสอบว่า Sheet ใหม่มี `Settings`, `StudentBookings`, `AuditLog` และ Drive มีโฟลเดอร์ใหม่สองโฟลเดอร์ที่ยังเป็นส่วนตัว
8. เติมค่าธนาคารและข้อมูลติดต่อใน `Settings` ของ Sheet ใหม่ รวมถึง `PROMPTPAY_QR_FILE_ID` หากต้องการใช้ QR
9. ตรวจสอบสิทธิ์ของบัญชีเจ้าของระบบและสิทธิ์เข้าถึง Drive ตามนโยบายองค์กร
10. สร้าง Web App deployment **ด้วยตนเอง** จากโปรเจกต์ใหม่เท่านั้น:
    - Execute as: เจ้าของระบบ
    - Who has access: เลือกตามกลุ่มผู้ใช้งานที่ต้องการ
    - ห้ามเลือก Library deployment
11. ทดสอบ customer page, status lookup และ Admin page ด้วยข้อมูลทดสอบที่ไม่มีข้อมูลส่วนบุคคลจริงก่อนเปิดใช้งาน

อย่าขอให้โค้ดสร้าง `/exec` URL แทนเจ้าของระบบ และอย่ารัน `clasp deploy` เป็นส่วนหนึ่งของ M1 นี้

## การเปลี่ยนค่าในอนาคต

ค่าช่วงเวลาขายและรายการรอบการแสดงอ่านจาก `Settings` ของระบบใหม่นี้เท่านั้น ขณะที่ราคาถูกบังคับในโค้ดเป็น 99 บาทเสมอ การเปลี่ยนแปลงหลังเปิดขายควรผ่านการทดสอบและการอนุมัติของเจ้าของระบบ
