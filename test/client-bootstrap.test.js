const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const clientHtml = fs.readFileSync(path.join(root, 'src', 'ClientBootstrap.html'), 'utf8');
const clientScript = clientHtml.match(/<script>([\s\S]*)<\/script>/)[1];
const context = {};
vm.runInNewContext(clientScript, context);
const Client = context.StudentClient;
const index = fs.readFileSync(path.join(root, 'src', 'Index.html'), 'utf8');
const code = fs.readFileSync(path.join(root, 'src', 'Code.gs'), 'utf8');
const domain = fs.readFileSync(path.join(root, 'src', 'Domain.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'src', 'Admin.html'), 'utf8');

test('client bootstrap accepts a valid server response and fixed amount', () => {
  const data = Client.parseBootstrap(JSON.stringify({ ok: true, amount: 99, saleState: 'OPEN', performanceOptions: [], payment: {} }));
  assert.equal(data.amount, 99);
});

test('client bootstrap rejects a non-fixed price response', () => {
  assert.throws(() => Client.parseBootstrap({ ok: true, amount: 120, saleState: 'OPEN' }));
});

test('client banner has the required pre-sale and post-sale Thai messages', () => {
  assert.match(Client.saleBanner({ saleState: 'CLOSED_NOT_STARTED' }).title, /ยังไม่เปิดจำหน่าย/);
  assert.match(Client.saleBanner({ saleState: 'CLOSED_ENDED' }).title, /ปิดจำหน่าย/);
  assert.equal(Client.saleBanner({ saleState: 'OPEN' }).tone, 'open');
});

test('client escaping is safe for customer lookup rendering', () => {
  assert.equal(Client.escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('client enforces positive integer generation 1 through 99', () => {
  assert.equal(Client.isPositiveGeneration('19'), true);
  assert.equal(Client.isPositiveGeneration('1'), true);
  assert.equal(Client.isPositiveGeneration('99'), true);
  assert.equal(Client.isPositiveGeneration('0'), false);
  assert.equal(Client.isPositiveGeneration('-1'), false);
  assert.equal(Client.isPositiveGeneration('1.5'), false);
  assert.equal(Client.isPositiveGeneration('abc'), false);
  assert.equal(Client.isPositiveGeneration(''), false);
});

test('client normalizes Thai phone formats', () => {
  assert.equal(Client.normalizeThaiPhone('0642790662'), '0642790662');
  assert.equal(Client.normalizeThaiPhone('064-279-0662'), '0642790662');
  assert.equal(Client.normalizeThaiPhone('+66 64 279 0662'), '0642790662');
  assert.equal(Client.normalizeThaiPhone('0742790662'), null);
});

test('customer page contains Thai-first performance and payment disclaimers', () => {
  assert.match(index, /บัตรราคาพิเศษสำหรับนักศึกษา 99 บาท/);
  assert.match(index, /ไม่สามารถเลือกรอบการแสดงล่วงหน้าได้/);
  assert.match(index, /การชำระเงินยังไม่ถือว่าได้รับสิทธิ์/);
  assert.match(index, /หลักฐานยืนยันสถานะนักศึกษา/);
  assert.match(index, /สลิปการชำระเงิน/);
  assert.match(index, /เบอร์โทรศัพท์/);
  assert.match(index, /1\. ข้อมูลผู้ซื้อ/);
  assert.match(index, /2\. ยืนยันสถานะนักศึกษา/);
  assert.match(index, /3\. ชำระเงิน/);
});

test('customer page removes required confirmation checkboxes and misleading stepper', () => {
  assert.doesNotMatch(index, /type=["']checkbox["']/i);
  assert.doesNotMatch(index, /confirmStudent|confirmPayment/);
  assert.doesNotMatch(index, /class=["']steps["']/i);
});

test('customer page has no quantity selector or performance-selection control', () => {
  assert.doesNotMatch(index, /name=["']quantity["']/i);
  assert.doesNotMatch(index, /id=["']quantity["']/i);
  assert.doesNotMatch(index, /เลือกจำนวน/);
  assert.doesNotMatch(index, /name=["']performance["']/i);
});

test('customer lookup uses one Student-ID-or-phone field only', () => {
  assert.match(index, /รหัสนักศึกษาหรือเบอร์โทรศัพท์/);
  assert.match(index, /เช่น 6612345 หรือ 0612345678/);
  assert.doesNotMatch(index, /lookupTicket|lookupStudentId/);
});

test('server source contains independent authorization, LockService, and private Drive handling', () => {
  assert.match(code, /ADMIN_TOKEN/);
  assert.match(code, /LockService\.getScriptLock\(\)/);
  assert.match(code, /setSharing\(DriveApp\.Access\.PRIVATE/);
  assert.match(code, /getAdminImageJson/);
  assert.match(code, /request_id/);
  assert.match(code, /phone/);
  assert.match(code, /setNumberFormat\('@'\)/);
  assert.match(code, /lookupRecords/);
  assert.match(code, /publicLookupRecord/);
  assert.match(domain, /phone: normalizeThaiPhone/);
  assert.match(code, /'เบอร์โทรศัพท์'/);
});

test('customer status card renders venue verification fields and used performance label', () => {
  assert.match(index, /r\.studentId/);
  assert.match(index, /r\.generation/);
  assert.match(index, /r\.phone/);
  assert.match(index, /รอบที่เข้าชม/);
});

test('server source never falls back to an active spreadsheet', () => {
  assert.doesNotMatch(code, /SpreadsheetApp\.getActive/);
  assert.match(code, /SpreadsheetApp\.openById/);
});

test('Admin page exposes all required tabs and action labels', () => {
  for (const label of ['ภาพรวม', 'รอตรวจสอบ', 'อนุมัติแล้ว', 'ปฏิเสธ', 'ใช้สิทธิ์แล้ว', 'รายการทั้งหมด', 'ส่งออก CSV', 'ดู RSU Connect', 'ดูสลิป']) assert.match(admin, new RegExp(label));
  assert.match(admin, /ยืนยันใช้สิทธิ์/);
  assert.match(admin, /เบอร์โทรศัพท์/);
  assert.match(admin, /duplicatePhone/);
});

test('deployment guardrails are represented in the owner documentation', () => {
  const deployment = fs.readFileSync(path.join(root, 'DEPLOYMENT_GUIDE.md'), 'utf8');
  assert.match(deployment, /ห้ามใช้ Production `pac-ticket-booking` Script ID/);
  assert.match(deployment, /ห้ามเลือก Library deployment/);
  assert.match(deployment, /Codex ไม่ได้สร้างหรือแก้ไข Deployment/);
});
