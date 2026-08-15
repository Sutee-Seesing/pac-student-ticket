/**
 * PAC Student Ticket M1
 *
 * This Apps Script project is intentionally self-contained.  It requires its
 * own SPREADSHEET_ID and ADMIN_TOKEN Script Properties and never falls back
 * to an active spreadsheet, which prevents accidental coupling to another
 * PAC application.
 */
var CONFIG = {
  SHEETS: {
    SETTINGS: 'Settings',
    BOOKINGS: 'StudentBookings',
    AUDIT: 'AuditLog'
  },
  MAX_UPLOAD_BYTES: 5 * 1024 * 1024,
  ALLOWED_MIME: ['image/jpeg', 'image/png', 'image/webp'],
  BUILD_ID: 'm1.1-form-lookup-cleanup'
};

var HEADERS = {
  Settings: ['key', 'value'],
  StudentBookings: [
    'internal_id',
    'student_ticket_code',
    'created_at',
    'updated_at',
    'full_name',
    'email',
    'student_id',
    'generation',
    'rsu_connect_file_id',
    'payment_slip_file_id',
    'amount',
    'status',
    'reviewed_at',
    'reviewer',
    'admin_note',
    'assigned_performance',
    'used_at',
    'used_by',
    'request_id',
    'phone'
  ],
  AuditLog: ['timestamp', 'student_ticket_code', 'previous_status', 'new_status', 'action', 'actor', 'metadata']
};

var DEFAULT_SETTINGS = {
  EVENT_NAME: 'The Burlared (ผู้หญิงอย่างว่า)',
  EVENT_DESCRIPTION: 'สิทธิ์เข้าชมการแสดงสำหรับนักศึกษา PAC',
  STUDENT_TICKET_PRICE: '99',
  SALE_START_AT: '2026-08-19T09:00:00+07:00',
  SALE_END_AT: '2026-08-19T23:59:59+07:00',
  TIMEZONE: 'Asia/Bangkok',
  ELIGIBLE_STUDENT_PREFIXES: '66,67,68,69',
  STUDENT_ID_LENGTH: '7',
  BANK_NAME: '',
  BANK_ACCOUNT_NUMBER: '',
  BANK_ACCOUNT_HOLDER: '',
  PROMPTPAY_QR_FILE_ID: '',
  SUPPORT_CONTACT: '',
  RSU_CONNECT_FOLDER_ID: '',
  PAYMENT_SLIP_FOLDER_ID: '',
  PERFORMANCE_OPTIONS: '21 Aug 2026 · 17:00|21 Aug 2026 · 19:00|22 Aug 2026 · 17:00|22 Aug 2026 · 19:00'
};

function doGet(e) {
  var page = e && e.parameter && e.parameter.page === 'admin' ? 'Admin' : 'Index';
  return HtmlService.createTemplateFromFile(page)
    .evaluate()
    .setTitle('PAC Student Ticket · 99 บาท');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** Safe, unauthenticated customer bootstrap. It contains no IDs or tokens. */
function getPublicBootstrapJson() {
  var settings = getSettings_();
  var now = new Date();
  return JSON.stringify({
    ok: true,
    buildId: CONFIG.BUILD_ID,
    eventName: setting_(settings, 'EVENT_NAME', DEFAULT_SETTINGS.EVENT_NAME),
    eventDescription: setting_(settings, 'EVENT_DESCRIPTION', DEFAULT_SETTINGS.EVENT_DESCRIPTION),
    amount: StudentDomain.PRICE,
    saleState: saleState_(settings, now),
    saleStartAt: setting_(settings, 'SALE_START_AT', DEFAULT_SETTINGS.SALE_START_AT),
    saleEndAt: setting_(settings, 'SALE_END_AT', DEFAULT_SETTINGS.SALE_END_AT),
    timezone: setting_(settings, 'TIMEZONE', DEFAULT_SETTINGS.TIMEZONE),
    eligiblePrefixes: StudentDomain.normalizedPrefixes(setting_(settings, 'ELIGIBLE_STUDENT_PREFIXES', DEFAULT_SETTINGS.ELIGIBLE_STUDENT_PREFIXES)),
    studentIdLength: Number(setting_(settings, 'STUDENT_ID_LENGTH', DEFAULT_SETTINGS.STUDENT_ID_LENGTH)),
    payment: {
      bankName: setting_(settings, 'BANK_NAME', ''),
      accountNumber: setting_(settings, 'BANK_ACCOUNT_NUMBER', ''),
      accountHolder: setting_(settings, 'BANK_ACCOUNT_HOLDER', ''),
      supportContact: setting_(settings, 'SUPPORT_CONTACT', ''),
      promptpayQrDataUrl: promptpayQrDataUrl_(setting_(settings, 'PROMPTPAY_QR_FILE_ID', ''))
    },
    performanceOptions: StudentDomain.allowedPerformances(setting_(settings, 'PERFORMANCE_OPTIONS', DEFAULT_SETTINGS.PERFORMANCE_OPTIONS))
  });
}

/**
 * Create the new application's sheets and private Drive folders.
 * This function is deliberately manual: it is never called by doGet or any
 * customer/admin request.
 */
function setup() {
  var ss = spreadsheet_();
  ensureHeader_(ss, CONFIG.SHEETS.SETTINGS, HEADERS.Settings);
  ensureHeader_(ss, CONFIG.SHEETS.BOOKINGS, HEADERS.StudentBookings);
  ensureHeader_(ss, CONFIG.SHEETS.AUDIT, HEADERS.AuditLog);

  var settingsSheet = sheet_(CONFIG.SHEETS.SETTINGS);
  ensureSettingsValueTextFormat_(settingsSheet);
  var settings = getSettings_();
  Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) {
      appendSetting_(settingsSheet, key, DEFAULT_SETTINGS[key]);
    }
  });

  settings = getSettings_();
  var createdFolders = [];
  if (!setting_(settings, 'RSU_CONNECT_FOLDER_ID', '')) {
    var rsuFolder = DriveApp.createFolder('PAC Student Ticket · RSU Connect');
    makePrivate_(rsuFolder);
    appendSetting_(settingsSheet, 'RSU_CONNECT_FOLDER_ID', rsuFolder.getId());
    createdFolders.push('RSU Connect');
  }
  if (!setting_(settings, 'PAYMENT_SLIP_FOLDER_ID', '')) {
    var paymentFolder = DriveApp.createFolder('PAC Student Ticket · Payment Slips');
    makePrivate_(paymentFolder);
    appendSetting_(settingsSheet, 'PAYMENT_SLIP_FOLDER_ID', paymentFolder.getId());
    createdFolders.push('Payment Slips');
  }
  SpreadsheetApp.flush();
  return JSON.stringify({
    ok: true,
    message: 'สร้างโครงสร้าง PAC Student Ticket เรียบร้อยแล้ว',
    sheets: [CONFIG.SHEETS.SETTINGS, CONFIG.SHEETS.BOOKINGS, CONFIG.SHEETS.AUDIT],
    createdFolders: createdFolders
  });
}

/**
 * Customer submission. Amount, status, current time, eligibility, ticket
 * code, and performance semantics are all decided here, not by the browser.
 */
function submitStudentEntitlement(input) {
  var payload = input || {};
  var settings = getSettings_();
  assertSaleOpen_(settings);
  var validation = StudentDomain.validateCustomerInput(payload, settings);
  if (!validation.ok) throw new Error(validation.errors[0]);
  var preparedRsu = prepareUpload_(payload.rsu_connect, 'หลักฐาน RSU Connect');
  var preparedSlip = prepareUpload_(payload.payment_slip, 'สลิปการชำระเงิน');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('ระบบกำลังมีผู้ส่งข้อมูลจำนวนมาก กรุณาลองอีกครั้ง');
  var createdFileIds = [];
  var recordWritten = false;
  try {
    settings = getSettings_();
    assertSaleOpen_(settings);
    var rows = studentRows_();
    var duplicateRequest = StudentDomain.findByRequestId(rows, validation.data.request_id);
    if (duplicateRequest) return JSON.stringify(customerSuccess_(duplicateRequest));

    var eligibility = StudentDomain.canSubmitForStudent(rows, validation.data.student_id);
    if (!eligibility.allowed) throw new Error('รหัสนักศึกษานี้ใช้สิทธิ์ซื้อบัตรราคาพิเศษแล้ว');

    var ticketCode = StudentDomain.ticketCode(StudentDomain.nextTicketSequence(rows.map(function (row) {
      return row.student_ticket_code;
    })));
    var rsuFileId = saveUpload_(setting_(settings, 'RSU_CONNECT_FOLDER_ID', ''), preparedRsu, ticketCode, 'rsu-connect', createdFileIds);
    var paymentFileId = saveUpload_(setting_(settings, 'PAYMENT_SLIP_FOLDER_ID', ''), preparedSlip, ticketCode, 'payment-slip', createdFileIds);

    // A submission that crosses the server-side sale end while uploads are in
    // flight must not create an entitlement. Newly-created files are trashed
    // below when no sheet record has been written.
    assertSaleOpen_(settings);
    var now = new Date();
    var record = {
      internal_id: Utilities.getUuid(),
      student_ticket_code: ticketCode,
      created_at: now,
      updated_at: now,
      full_name: validation.data.full_name,
      email: validation.data.email,
      phone: validation.data.phone,
      student_id: validation.data.student_id,
      generation: validation.data.generation,
      rsu_connect_file_id: rsuFileId,
      payment_slip_file_id: paymentFileId,
      amount: StudentDomain.PRICE,
      status: StudentDomain.STATUSES.WAITING_REVIEW,
      reviewed_at: '',
      reviewer: '',
      admin_note: '',
      assigned_performance: '',
      used_at: '',
      used_by: '',
      request_id: validation.data.request_id
    };
    appendStudentRecord_(record);
    recordWritten = true;
    audit_(ticketCode, '', StudentDomain.STATUSES.WAITING_REVIEW, 'SUBMIT', 'customer', {
      request_id: validation.data.request_id
    });
    return JSON.stringify(customerSuccess_(record));
  } catch (error) {
    if (!recordWritten) trashFiles_(createdFileIds);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/** Customer-safe lookup by one exact Student ID or normalized phone number. */
function lookupStudentEntitlementJson(input) {
  var settings = getSettings_();
  var payload = input == null ? '' : input;
  var lookup = typeof payload === 'string' ? payload : (payload.lookup || payload.value || payload.student_id || payload.phone || '');
  var result = StudentDomain.lookupRecords(
    studentRows_(),
    lookup,
    setting_(settings, 'ELIGIBLE_STUDENT_PREFIXES', DEFAULT_SETTINGS.ELIGIBLE_STUDENT_PREFIXES),
    setting_(settings, 'STUDENT_ID_LENGTH', DEFAULT_SETTINGS.STUDENT_ID_LENGTH)
  );
  if (result.kind === 'INVALID') return JSON.stringify({ ok: false, message: 'กรุณากรอกรหัสนักศึกษาหรือเบอร์โทรศัพท์ให้ถูกต้อง' });
  if (result.kind === 'AMBIGUOUS_PHONE') return JSON.stringify({ ok: false, message: 'พบมากกว่า 1 รายการสำหรับเบอร์โทรนี้ กรุณาตรวจสอบด้วยรหัสนักศึกษา' });
  if (!result.record) {
    return JSON.stringify({ ok: false, message: result.kind === 'STUDENT_ID' ? 'ไม่พบข้อมูลสิทธิ์สำหรับรหัสนักศึกษานี้' : 'ไม่พบข้อมูลสิทธิ์สำหรับเบอร์โทรศัพท์นี้' });
  }
  return JSON.stringify({ ok: true, result: StudentDomain.publicLookupRecord(result.record) });
}

/** Admin data endpoint. Sensitive rows are only read after token validation. */
function getAdminDataJson(token, filters) {
  requireAdmin_(token);
  var settings = getSettings_();
  var all = studentRows_();
  var filtered = filterAdminRows_(all, filters || {});
  return JSON.stringify({
    ok: true,
    eventName: setting_(settings, 'EVENT_NAME', DEFAULT_SETTINGS.EVENT_NAME),
    metrics: metrics_(all),
    bookings: adminRows_(filtered, all),
    filters: filters || {},
    performanceOptions: StudentDomain.allowedPerformances(setting_(settings, 'PERFORMANCE_OPTIONS', DEFAULT_SETTINGS.PERFORMANCE_OPTIONS))
  });
}

function getAdminBookingDetailJson(token, ticketCode) {
  requireAdmin_(token);
  var record = findTicket_(ticketCode);
  if (!record) throw new Error('ไม่พบรายการ');
  var all = studentRows_();
  var duplicateEmail = emailCount_(all, record.email) > 1;
  var duplicatePhone = phoneCount_(all, record.phone) > 1;
  var timezone = setting_(getSettings_(), 'TIMEZONE', DEFAULT_SETTINGS.TIMEZONE);
  return JSON.stringify({ ok: true, booking: adminRow_(record, all, duplicateEmail, duplicatePhone, timezone) });
}

/** Return image bytes as a data URL to an authorized admin; never return IDs. */
function getAdminImageJson(token, ticketCode, kind) {
  requireAdmin_(token);
  var record = findTicket_(ticketCode);
  if (!record) throw new Error('ไม่พบรายการ');
  var fileId = String(kind) === 'rsu' ? record.rsu_connect_file_id : String(kind) === 'slip' ? record.payment_slip_file_id : '';
  if (!fileId) throw new Error('ไม่พบไฟล์หลักฐาน');
  return JSON.stringify({ ok: true, dataUrl: driveDataUrl_(fileId) });
}

function reviewStudentEntitlement(token, ticketCode, nextStatus, note, operator) {
  requireAdmin_(token);
  if (nextStatus !== StudentDomain.STATUSES.APPROVED && nextStatus !== StudentDomain.STATUSES.REJECTED) {
    throw new Error('สถานะการตรวจสอบไม่ถูกต้อง');
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('ระบบกำลังมีผู้ใช้งาน กรุณาลองอีกครั้ง');
  try {
    var record = findTicket_(ticketCode);
    if (!record) throw new Error('ไม่พบรายการ');
    var transition = StudentDomain.transitionResult(record.status, nextStatus);
    if (!transition.allowed) throw new Error('ไม่สามารถเปลี่ยนสถานะรายการนี้ได้');
    if (transition.idempotent) return JSON.stringify(adminActionResult_(record));
    var now = new Date();
    var actor = cleanOperator_(operator);
    updateStudentRecord_(record.rowNumber, {
      updated_at: now,
      status: nextStatus,
      reviewed_at: now,
      reviewer: actor,
      admin_note: nextStatus === StudentDomain.STATUSES.REJECTED ? String(note || '').trim() : ''
    });
    audit_(record.student_ticket_code, record.status, nextStatus, nextStatus === StudentDomain.STATUSES.APPROVED ? 'APPROVE' : 'REJECT', actor, {
      note: String(note || '').trim()
    });
    record.status = nextStatus;
    record.updated_at = now;
    record.reviewed_at = now;
    record.reviewer = actor;
    record.admin_note = nextStatus === StudentDomain.STATUSES.REJECTED ? String(note || '').trim() : '';
    return JSON.stringify(adminActionResult_(record));
  } finally {
    lock.releaseLock();
  }
}

function useStudentEntitlement(token, ticketCode, assignedPerformance, operator) {
  requireAdmin_(token);
  var settings = getSettings_();
  var performance = String(assignedPerformance || '').trim();
  if (performance && !StudentDomain.isAllowedPerformance(performance, setting_(settings, 'PERFORMANCE_OPTIONS', DEFAULT_SETTINGS.PERFORMANCE_OPTIONS))) {
    throw new Error('รอบการแสดงที่เลือกไม่ถูกต้อง');
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('ระบบกำลังมีผู้ใช้งาน กรุณาลองอีกครั้ง');
  try {
    var record = findTicket_(ticketCode);
    if (!record) throw new Error('ไม่พบรายการ');
    if (record.status === StudentDomain.STATUSES.USED) throw new Error('สิทธิ์นี้ถูกใช้ไปแล้ว ไม่สามารถใช้ซ้ำได้');
    if (record.status !== StudentDomain.STATUSES.APPROVED) throw new Error('ต้องอนุมัติสิทธิ์ก่อนจึงจะใช้งานได้');
    var now = new Date();
    var actor = cleanOperator_(operator);
    updateStudentRecord_(record.rowNumber, {
      updated_at: now,
      status: StudentDomain.STATUSES.USED,
      assigned_performance: performance,
      used_at: now,
      used_by: actor
    });
    audit_(record.student_ticket_code, record.status, StudentDomain.STATUSES.USED, 'USE_ENTITLEMENT', actor, {
      assigned_performance: performance
    });
    record.status = StudentDomain.STATUSES.USED;
    record.updated_at = now;
    record.assigned_performance = performance;
    record.used_at = now;
    record.used_by = actor;
    return JSON.stringify(adminActionResult_(record));
  } finally {
    lock.releaseLock();
  }
}

function getAdminCsvJson(token, filters) {
  requireAdmin_(token);
  var all = studentRows_();
  var rows = filterAdminRows_(all, filters || {});
  var settings = getSettings_();
  var timezone = setting_(settings, 'TIMEZONE', DEFAULT_SETTINGS.TIMEZONE);
  var output = [
    ['Ticket ID', 'ชื่อ-นามสกุล', 'Email', 'เบอร์โทรศัพท์', 'รหัสนักศึกษา', 'รุ่น', 'จำนวนเงิน', 'สถานะ', 'วันที่ส่ง', 'วันที่ตรวจ', 'ผู้ตรวจ', 'รอบที่ใช้สิทธิ์', 'วันที่ใช้สิทธิ์', 'หมายเหตุ']
  ];
  rows.forEach(function (record) {
    output.push([
      record.student_ticket_code,
      record.full_name,
      record.email,
      record.phone,
      record.student_id,
      record.generation,
      Number(record.amount) || StudentDomain.PRICE,
      StudentDomain.statusLabel(record.status),
      displayDateTime_(record.created_at, timezone),
      displayDateTime_(record.reviewed_at, timezone),
      record.reviewer,
      record.assigned_performance,
      displayDateTime_(record.used_at, timezone),
      record.admin_note
    ].map(StudentDomain.csvEscape));
  });
  return JSON.stringify({ ok: true, filename: 'pac-student-ticket.csv', csv: output.map(function (line) { return line.join(','); }).join('\r\n') });
}

function spreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('ยังไม่ได้ตั้งค่า SPREADSHEET_ID ของระบบนักศึกษา');
  return SpreadsheetApp.openById(id);
}

function sheet_(name) {
  var sheet = spreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('ไม่พบชีต ' + name + ' กรุณาให้เจ้าของระบบรัน setup() หนึ่งครั้ง');
  return sheet;
}

function getSettings_() {
  ensureSettingsValueTextFormat_(sheet_(CONFIG.SHEETS.SETTINGS));
  var rows = rowsFromSheet_(CONFIG.SHEETS.SETTINGS);
  var settings = {};
  rows.forEach(function (row) { settings[String(row.key)] = String(row.value == null ? '' : row.value); });
  return settings;
}

function setting_(settings, key, fallback) {
  return settings && settings[key] !== undefined && settings[key] !== '' ? String(settings[key]) : String(fallback == null ? '' : fallback);
}

function rowsFromSheet_(name) {
  var sheet = sheet_(name);
  var values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  var headers = values[0];
  return values.slice(1).map(function (row, index) {
    var item = { rowNumber: index + 2 };
    headers.forEach(function (header, column) { item[String(header)] = row[column]; });
    return item;
  }).filter(function (item) {
    return Object.keys(item).some(function (key) { return key !== 'rowNumber' && item[key] !== '' && item[key] !== null; });
  });
}

function studentRows_() {
  ensureStudentBookingsHeaders_();
  return rowsFromSheet_(CONFIG.SHEETS.BOOKINGS);
}

function ensureHeader_(spreadsheet, name, expected) {
  var sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, expected.length).setValues([expected.map(StudentDomain.safeSheetValue)]);
    return;
  }
  var width = Math.max(sheet.getLastColumn(), expected.length);
  var actual = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  for (var i = 0; i < expected.length; i++) {
    if (actual[i] && actual[i] !== expected[i]) throw new Error('ชีต ' + name + ' มีหัวตารางไม่ตรงกับระบบนักศึกษา');
    if (!actual[i]) sheet.getRange(1, i + 1).setValue(expected[i]);
  }
}

function ensureStudentBookingsHeaders_() {
  var spreadsheet = spreadsheet_();
  var sheet = spreadsheet.getSheetByName(CONFIG.SHEETS.BOOKINGS);
  if (!sheet) throw new Error('ไม่พบชีต ' + CONFIG.SHEETS.BOOKINGS + ' กรุณาให้เจ้าของระบบรัน setup() หนึ่งครั้ง');
  ensureHeader_(spreadsheet, CONFIG.SHEETS.BOOKINGS, HEADERS.StudentBookings);
}

function ensureSettingsValueTextFormat_(sheet) {
  var rowCount = Math.max(0, sheet.getLastRow() - 1);
  if (rowCount) sheet.getRange(2, 2, rowCount, 1).setNumberFormat('@');
}

function appendSetting_(sheet, key, value) {
  var rowNumber = sheet.getLastRow() + 1;
  sheet.getRange(rowNumber, 1, 1, 2).setNumberFormat('@');
  sheet.getRange(rowNumber, 1, 1, 2).setValues([[
    StudentDomain.safeSheetValue(key),
    StudentDomain.safeSheetValue(value)
  ]]);
}

function identifierHeaders_() {
  return ['student_ticket_code', 'student_id', 'generation', 'phone'];
}

function appendStudentRecord_(record) {
  var values = HEADERS.StudentBookings.map(function (header) {
    return StudentDomain.safeSheetValue(record[header]);
  });
  var sheet = sheet_(CONFIG.SHEETS.BOOKINGS);
  ensureStudentBookingsHeaders_();
  var rowNumber = sheet.getLastRow() + 1;
  var headerRow = sheet.getRange(1, 1, 1, HEADERS.StudentBookings.length).getValues()[0];
  identifierHeaders_().forEach(function (header) {
    var index = headerRow.indexOf(header);
    if (index >= 0) sheet.getRange(rowNumber, index + 1).setNumberFormat('@');
  });
  sheet.getRange(rowNumber, 1, 1, HEADERS.StudentBookings.length).setValues([values]);
}

function updateStudentRecord_(rowNumber, fields) {
  var sheet = sheet_(CONFIG.SHEETS.BOOKINGS);
  ensureStudentBookingsHeaders_();
  var headerRow = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), HEADERS.StudentBookings.length)).getValues()[0];
  Object.keys(fields).forEach(function (key) {
    var index = headerRow.indexOf(key);
    if (index >= 0) {
      if (identifierHeaders_().indexOf(key) >= 0) sheet.getRange(rowNumber, index + 1).setNumberFormat('@');
      sheet.getRange(rowNumber, index + 1).setValue(StudentDomain.safeSheetValue(fields[key]));
    }
  });
}

function findTicket_(ticketCode) {
  var code = String(ticketCode || '').trim().toUpperCase();
  return studentRows_().filter(function (record) {
    return String(record.student_ticket_code || '').trim().toUpperCase() === code;
  })[0] || null;
}

function audit_(ticketCode, previousStatus, newStatus, action, actor, metadata) {
  var data = [
    new Date(),
    ticketCode,
    previousStatus,
    newStatus,
    action,
    actor,
    JSON.stringify(metadata || {})
  ].map(StudentDomain.safeSheetValue);
  sheet_(CONFIG.SHEETS.AUDIT).appendRow(data);
}

function saleState_(settings, now) {
  return StudentDomain.saleStateAtServerTime(
    now,
    setting_(settings, 'SALE_START_AT', DEFAULT_SETTINGS.SALE_START_AT),
    setting_(settings, 'SALE_END_AT', DEFAULT_SETTINGS.SALE_END_AT)
  );
}

function assertSaleOpen_(settings) {
  var state = saleState_(settings, new Date());
  if (state === StudentDomain.SALE_STATES.CLOSED_NOT_STARTED) {
    throw new Error('ยังไม่เปิดจำหน่าย เปิดจำหน่ายบัตรราคาพิเศษวันที่ 19 สิงหาคม 2569 เวลา 09:00 น.');
  }
  if (state === StudentDomain.SALE_STATES.CLOSED_ENDED) {
    throw new Error('ปิดจำหน่ายบัตรราคาพิเศษแล้ว');
  }
  return state;
}

function prepareUpload_(file, label) {
  if (!file || typeof file !== 'object') throw new Error('กรุณาอัปโหลด' + label);
  var validation = StudentDomain.uploadValidation({
    mimeType: file.mimeType || file.type,
    sizeBytes: file.sizeBytes == null ? file.size : file.sizeBytes
  });
  if (!validation.ok) throw new Error(validation.error);
  var dataUrl = String(file.dataUrl || '');
  var match = /^data:([^;]+);base64,(.*)$/i.exec(dataUrl);
  if (!match || String(match[1]).toLowerCase() !== validation.mimeType) throw new Error('ไฟล์' + label + 'ไม่ถูกต้อง');
  var bytes;
  try {
    bytes = Utilities.base64Decode(match[2].replace(/\s/g, ''));
  } catch (error) {
    throw new Error('อ่านไฟล์' + label + 'ไม่สำเร็จ');
  }
  if (!bytes.length || bytes.length > CONFIG.MAX_UPLOAD_BYTES) throw new Error('ไฟล์ต้องมีขนาดไม่เกิน 5 MB');
  if (!imageSignatureMatches_(bytes, validation.mimeType)) throw new Error('ไฟล์' + label + 'ไม่ใช่ภาพที่รองรับ');
  return {
    blob: Utilities.newBlob(bytes, validation.mimeType),
    mimeType: validation.mimeType,
    sizeBytes: bytes.length
  };
}

function saveUpload_(folderId, prepared, ticketCode, label, createdFileIds) {
  if (!folderId) throw new Error('ยังไม่ได้ตั้งค่าโฟลเดอร์จัดเก็บไฟล์ส่วนตัว');
  var folder = DriveApp.getFolderById(String(folderId));
  makePrivate_(folder);
  var fileName = ticketCode + '-' + label + '.' + StudentDomain.extensionForMime(prepared.mimeType);
  var file = folder.createFile(prepared.blob.setName(fileName));
  makePrivate_(file);
  createdFileIds.push(file.getId());
  return file.getId();
}

function imageSignatureMatches_(bytes, mimeType) {
  function at(index) { return Number(bytes[index]) & 255; }
  function ascii(start, length) {
    var result = '';
    for (var i = 0; i < length; i++) result += String.fromCharCode(at(start + i));
    return result;
  }
  var mime = String(mimeType || '').toLowerCase();
  if (mime === 'image/jpeg') return at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff;
  if (mime === 'image/png') return ascii(0, 8) === '\x89PNG\r\n\x1a\n';
  if (mime === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
  return false;
}

function makePrivate_(driveItem) {
  // Fail closed: if this cannot be enforced, do not continue storing an
  // upload whose sharing state has not been verified.
  driveItem.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
}

function trashFiles_(fileIds) {
  (fileIds || []).forEach(function (fileId) {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (ignored) {}
  });
}

function promptpayQrDataUrl_(fileId) {
  if (!fileId) return '';
  try { return driveDataUrl_(fileId); } catch (ignored) { return ''; }
}

function driveDataUrl_(fileId) {
  var blob = DriveApp.getFileById(String(fileId)).getBlob();
  var mime = String(blob.getContentType() || '').toLowerCase();
  if (['image/jpeg', 'image/png', 'image/webp'].indexOf(mime) < 0) throw new Error('ไฟล์ภาพไม่รองรับ');
  var bytes = blob.getBytes();
  if (bytes.length > 8 * 1024 * 1024) throw new Error('ไฟล์ภาพมีขนาดใหญ่เกินไป');
  return 'data:' + mime + ';base64,' + Utilities.base64Encode(bytes);
}

function requireAdmin_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN') || '';
  if (!StudentDomain.adminTokenMatches(expected, token)) throw new Error('ไม่มีสิทธิ์เข้าถึงส่วนเจ้าหน้าที่');
}

function filterAdminRows_(rows, filters) {
  var input = filters || {};
  var status = String(input.status || '').trim();
  var generation = String(input.generation || '').trim().toLowerCase();
  var filtered = (rows || []).filter(function (record) {
    return (!status || record.status === status) &&
      (!generation || String(record.generation || '').toLowerCase().indexOf(generation) >= 0) &&
      StudentDomain.matchesQuery(record, input.query || '');
  });
  var sort = String(input.sort || '').trim();
  if (!sort && status === StudentDomain.STATUSES.WAITING_REVIEW) sort = 'oldest';
  return StudentDomain.sortRecords(filtered, sort || 'newest');
}

function metrics_(rows) {
  var all = rows || [];
  function count(status) { return all.filter(function (record) { return record.status === status; }).length; }
  return {
    total: all.length,
    waiting: count(StudentDomain.STATUSES.WAITING_REVIEW),
    approved: count(StudentDomain.STATUSES.APPROVED),
    rejected: count(StudentDomain.STATUSES.REJECTED),
    used: count(StudentDomain.STATUSES.USED),
    confirmedRevenue: StudentDomain.confirmedRevenue(all)
  };
}

function adminRows_(rows, all) {
  var timezone = setting_(getSettings_(), 'TIMEZONE', DEFAULT_SETTINGS.TIMEZONE);
  return (rows || []).map(function (record) {
    return adminRow_(record, all, emailCount_(all, record.email) > 1, phoneCount_(all, record.phone) > 1, timezone);
  });
}

function adminRow_(record, all, duplicateEmail, duplicatePhone, timezone) {
  return {
    ticketId: String(record.student_ticket_code || ''),
    fullName: String(record.full_name || ''),
    email: String(record.email || ''),
    phone: String(record.phone || ''),
    studentId: String(record.student_id || ''),
    generation: String(record.generation || ''),
    amount: Number(record.amount) || StudentDomain.PRICE,
    status: String(record.status || ''),
    statusLabel: StudentDomain.statusLabel(record.status),
    createdAt: displayDateTime_(record.created_at, timezone || DEFAULT_SETTINGS.TIMEZONE),
    reviewedAt: displayDateTime_(record.reviewed_at, timezone || DEFAULT_SETTINGS.TIMEZONE),
    reviewer: String(record.reviewer || ''),
    adminNote: String(record.admin_note || ''),
    assignedPerformance: String(record.assigned_performance || ''),
    usedAt: displayDateTime_(record.used_at, timezone || DEFAULT_SETTINGS.TIMEZONE),
    usedBy: String(record.used_by || ''),
    hasRsuConnect: Boolean(record.rsu_connect_file_id),
    hasPaymentSlip: Boolean(record.payment_slip_file_id),
    duplicateEmail: Boolean(duplicateEmail),
    duplicatePhone: Boolean(duplicatePhone)
  };
}

function emailCount_(rows, email) {
  var value = String(email || '').trim().toLowerCase();
  if (!value) return 0;
  return distinctStudentCount_(rows, function (record) { return String(record.email || '').trim().toLowerCase() === value; });
}

function phoneCount_(rows, phone) {
  var value = StudentDomain.normalizeThaiPhone(phone);
  if (!value) return 0;
  return distinctStudentCount_(rows, function (record) { return StudentDomain.normalizeThaiPhone(record.phone) === value; });
}

function distinctStudentCount_(rows, predicate) {
  var seen = {};
  (rows || []).filter(predicate).forEach(function (record) {
    var studentId = StudentDomain.normalizeStudentId(record.student_id) || String(record.rowNumber || 'unknown');
    seen[studentId] = true;
  });
  return Object.keys(seen).length;
}

function customerSuccess_(record) {
  var safe = StudentDomain.publicRecord(record);
  return {
    ok: true,
    ticketId: safe.ticketId,
    status: safe.status,
    statusLabel: safe.statusLabel,
    amount: StudentDomain.PRICE,
    message: 'รับข้อมูลแล้ว',
    explanation: 'เจ้าหน้าที่กำลังตรวจสอบข้อมูล RSU Connect และสลิปการชำระเงิน',
    reminder: 'บัตรประเภทนี้ไม่เลือกรอบล่วงหน้า กรุณาติดต่อเจ้าหน้าที่หน้างานเพื่อเลือกรอบการแสดง'
  };
}

function adminActionResult_(record) {
  return {
    ok: true,
    ticketId: String(record.student_ticket_code || ''),
    status: String(record.status || ''),
    statusLabel: StudentDomain.statusLabel(record.status)
  };
}

function cleanOperator_(operator) {
  var value = String(operator || '').trim().replace(/[\r\n]/g, ' ');
  return value ? value.slice(0, 80) : 'admin';
}

function displayDateTime_(value, timezone) {
  if (!value) return '-';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, timezone || DEFAULT_SETTINGS.TIMEZONE, 'dd/MM/yyyy HH:mm');
  }
  return String(value);
}
