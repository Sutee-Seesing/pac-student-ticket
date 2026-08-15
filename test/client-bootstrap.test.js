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

test('customer page contains Thai-first performance and payment disclaimers', () => {
  assert.match(index, /บัตรราคาพิเศษสำหรับนักศึกษา 99 บาท/);
  assert.match(index, /ไม่สามารถเลือกรอบการแสดงล่วงหน้าได้/);
  assert.match(index, /การชำระเงินยังไม่ถือว่าได้รับสิทธิ์/);
  assert.match(index, /หลักฐานยืนยันสถานะนักศึกษา/);
  assert.match(index, /สลิปการชำระเงิน/);
});

test('customer page has no quantity selector or performance-selection control', () => {
  assert.doesNotMatch(index, /name=["']quantity["']/i);
  assert.doesNotMatch(index, /id=["']quantity["']/i);
  assert.doesNotMatch(index, /เลือกจำนวน/);
  assert.doesNotMatch(index, /name=["']performance["']/i);
});

test('server source contains independent authorization, LockService, and private Drive handling', () => {
  assert.match(code, /ADMIN_TOKEN/);
  assert.match(code, /LockService\.getScriptLock\(\)/);
  assert.match(code, /setSharing\(DriveApp\.Access\.PRIVATE/);
  assert.match(code, /getAdminImageJson/);
  assert.match(code, /request_id/);
});

test('server source never falls back to an active spreadsheet', () => {
  assert.doesNotMatch(code, /SpreadsheetApp\.getActive/);
  assert.match(code, /SpreadsheetApp\.openById/);
});

test('Admin page exposes all required tabs and action labels', () => {
  for (const label of ['ภาพรวม', 'รอตรวจสอบ', 'อนุมัติแล้ว', 'ปฏิเสธ', 'ใช้สิทธิ์แล้ว', 'รายการทั้งหมด', 'ส่งออก CSV', 'ดู RSU Connect', 'ดูสลิป']) assert.match(admin, new RegExp(label));
  assert.match(admin, /ยืนยันใช้สิทธิ์/);
});

test('deployment guardrails are represented in the owner documentation', () => {
  const deployment = fs.readFileSync(path.join(root, 'DEPLOYMENT_GUIDE.md'), 'utf8');
  assert.match(deployment, /ห้ามใช้ Production `pac-ticket-booking` Script ID/);
  assert.match(deployment, /ห้ามเลือก Library deployment/);
  assert.match(deployment, /Codex ไม่ได้สร้างหรือแก้ไข Deployment/);
});
