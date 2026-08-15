/**
 * Pure business rules for the PAC 99 THB student entitlement application.
 *
 * This file is intentionally usable in both Apps Script and Node.  The
 * Apps Script service layer owns Sheets, Drive, locks, and authorization;
 * this module owns the rules that must remain easy to test locally.
 */
var StudentDomain = (function () {
  var PRICE = 99;
  var MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
  var GENERATION_MIN = 1;
  var GENERATION_MAX = 99;
  var ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
  var STATUSES = {
    WAITING_REVIEW: 'WAITING_REVIEW',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    USED: 'USED'
  };
  var SALE_STATES = {
    CLOSED_NOT_STARTED: 'CLOSED_NOT_STARTED',
    OPEN: 'OPEN',
    CLOSED_ENDED: 'CLOSED_ENDED'
  };
  var STATUS_LABELS = {
    WAITING_REVIEW: 'รอตรวจสอบ',
    APPROVED: 'อนุมัติแล้ว',
    REJECTED: 'ปฏิเสธ',
    USED: 'ใช้สิทธิ์แล้ว'
  };
  var DEFAULT_PREFIXES = ['66', '67', '68', '69'];
  var DEFAULT_PERFORMANCES = [
    '21 Aug 2026 · 17:00',
    '21 Aug 2026 · 19:00',
    '22 Aug 2026 · 17:00',
    '22 Aug 2026 · 19:00'
  ];
  var GENERIC_REJECTED_MESSAGE = 'รายการไม่ผ่านการตรวจสอบ กรุณาติดต่อเจ้าหน้าที่ PAC หากต้องการข้อมูลเพิ่มเติม';

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function parseMillis(value) {
    if (value instanceof Date) return value.getTime();
    var millis = Date.parse(text(value));
    return isFinite(millis) ? millis : NaN;
  }

  function saleStateAtServerTime(serverNow, startAt, endAt) {
    var now = parseMillis(serverNow);
    var start = parseMillis(startAt);
    var end = parseMillis(endAt);
    if (!isFinite(now) || !isFinite(start) || !isFinite(end) || start > end) {
      throw new Error('Invalid sale window.');
    }
    if (now < start) return SALE_STATES.CLOSED_NOT_STARTED;
    if (now > end) return SALE_STATES.CLOSED_ENDED;
    return SALE_STATES.OPEN;
  }

  function isSaleOpenAtServerTime(serverNow, startAt, endAt) {
    return saleStateAtServerTime(serverNow, startAt, endAt) === SALE_STATES.OPEN;
  }

  function normalizedPrefixes(value) {
    if (Array.isArray(value)) return value.map(text).filter(Boolean);
    return text(value).split(',').map(function (item) { return item.trim(); }).filter(Boolean);
  }

  function normalizeStudentId(value) {
    return text(value).replace(/\s+/g, '');
  }

  function isPositiveGeneration(value) {
    var raw = text(value);
    if (!/^\d+$/.test(raw)) return false;
    var number = Number(raw);
    return Number.isInteger(number) && number >= GENERATION_MIN && number <= GENERATION_MAX;
  }

  function isEligibleStudentId(value, prefixes, length) {
    var id = normalizeStudentId(value);
    var expectedLength = Number(length || 7);
    var allowed = normalizedPrefixes(prefixes || DEFAULT_PREFIXES);
    if (!/^\d+$/.test(id) || id.length !== expectedLength) return false;
    return allowed.some(function (prefix) { return id.indexOf(prefix) === 0; });
  }

  function isReasonableEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value));
  }

  function normalizeThaiPhone(value) {
    var raw = text(value);
    if (!raw || !/^[+\d\s().-]+$/.test(raw)) return null;
    var digits = raw.replace(/\D/g, '');
    if (/^66[689]\d{8}$/.test(digits)) digits = '0' + digits.slice(2);
    return /^0[689]\d{8}$/.test(digits) ? digits : null;
  }

  function isValidThaiPhone(value) {
    return Boolean(normalizeThaiPhone(value));
  }

  function normalizeSubmission(payload) {
    var input = payload || {};
    return {
      full_name: text(input.full_name),
      email: text(input.email).toLowerCase(),
      phone: normalizeThaiPhone(input.phone) || '',
      student_id: normalizeStudentId(input.student_id),
      generation: text(input.generation),
      request_id: text(input.request_id),
      amount: PRICE,
      status: STATUSES.WAITING_REVIEW
    };
  }

  function validateCustomerInput(payload, settings) {
    var data = normalizeSubmission(payload);
    var config = settings || {};
    var errors = [];
    if (!data.full_name || data.full_name.length > 120) errors.push('กรุณากรอกชื่อ-นามสกุล');
    if (!isReasonableEmail(data.email) || data.email.length > 160) errors.push('กรุณากรอกอีเมลให้ถูกต้อง');
    if (!data.phone) errors.push('กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง');
    if (!isEligibleStudentId(data.student_id, config.ELIGIBLE_STUDENT_PREFIXES || DEFAULT_PREFIXES, config.STUDENT_ID_LENGTH || 7)) {
      errors.push('สิทธิ์นี้สำหรับนักศึกษารหัสขึ้นต้น 66–69 เท่านั้น กรุณาตรวจสอบรหัสนักศึกษา');
    }
    if (!isPositiveGeneration(data.generation)) errors.push('กรุณากรอกรุ่นเป็นตัวเลขตั้งแต่ 1–99');
    if (!data.request_id || data.request_id.length < 8 || data.request_id.length > 120) errors.push('ไม่พบรหัสคำขอ กรุณาลองส่งข้อมูลอีกครั้ง');
    return { ok: errors.length === 0, errors: errors, data: data };
  }

  function canSubmitForStudent(records, studentId) {
    var id = normalizeStudentId(studentId);
    var matches = (records || []).filter(function (record) {
      return normalizeStudentId(record.student_id) === id;
    });
    if (!matches.length) return { allowed: true, reason: 'NO_HISTORY' };
    if (matches.some(function (record) {
      return record.status === STATUSES.WAITING_REVIEW || record.status === STATUSES.APPROVED || record.status === STATUSES.USED;
    })) {
      return { allowed: false, reason: 'ACTIVE_ENTITLEMENT_EXISTS' };
    }
    if (matches.every(function (record) { return record.status === STATUSES.REJECTED; })) {
      return { allowed: true, reason: 'REJECTED_HISTORY_ONLY' };
    }
    return { allowed: false, reason: 'UNKNOWN_HISTORY_STATE' };
  }

  function findByRequestId(records, requestId) {
    var id = text(requestId);
    return (records || []).filter(function (record) { return text(record.request_id) === id; })[0] || null;
  }

  function uploadValidation(file) {
    var input = file || {};
    var mimeType = text(input.mimeType || input.type).toLowerCase();
    var size = Number(input.sizeBytes == null ? input.size : input.sizeBytes);
    if (ALLOWED_MIME.indexOf(mimeType) < 0) return { ok: false, error: 'รองรับเฉพาะไฟล์ JPEG, PNG หรือ WEBP เท่านั้น' };
    if (!isFinite(size) || size <= 0 || size > MAX_UPLOAD_BYTES) return { ok: false, error: 'ไฟล์ต้องมีขนาดไม่เกิน 5 MB' };
    return { ok: true, mimeType: mimeType, sizeBytes: size };
  }

  function extensionForMime(mimeType) {
    return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[text(mimeType).toLowerCase()] || 'bin';
  }

  function ticketCode(sequence) {
    var number = Number(sequence);
    if (!Number.isInteger(number) || number < 1) throw new Error('Invalid ticket sequence.');
    var digits = String(number);
    return 'PAC-STU-' + (digits.length < 4 ? ('0000' + digits).slice(-4) : digits);
  }

  function nextTicketSequence(codes) {
    var max = 0;
    (codes || []).forEach(function (code) {
      var match = /^PAC-STU-(\d+)$/.exec(text(code));
      if (match) max = Math.max(max, Number(match[1]));
    });
    return max + 1;
  }

  function canTransition(from, to) {
    if (from === STATUSES.WAITING_REVIEW && (to === STATUSES.APPROVED || to === STATUSES.REJECTED)) return true;
    return from === STATUSES.APPROVED && to === STATUSES.USED;
  }

  function transitionResult(from, to) {
    if (from === to) return { allowed: true, idempotent: true };
    return { allowed: canTransition(from, to), idempotent: false };
  }

  function statusLabel(status) {
    return STATUS_LABELS[text(status)] || 'ไม่ทราบสถานะ';
  }

  function confirmedRevenue(records) {
    return (records || []).filter(function (record) {
      return record.status === STATUSES.APPROVED || record.status === STATUSES.USED;
    }).reduce(function (sum, record) {
      var amount = Number(record.amount);
      return sum + (isFinite(amount) && amount >= 0 ? amount : 0);
    }, 0);
  }

  function safeSheetValue(value) {
    if (value instanceof Date) return value;
    var stringValue = String(value == null ? '' : value);
    return /^[=+\-@]/.test(stringValue) ? "'" + stringValue : stringValue;
  }

  function csvEscape(value) {
    var stringValue = String(value == null ? '' : value);
    return /[",\n\r]/.test(stringValue) ? '"' + stringValue.replace(/"/g, '""') + '"' : stringValue;
  }

  function allowedPerformances(value) {
    var input = Array.isArray(value) ? value : text(value).split('|');
    var values = input.map(text).filter(Boolean);
    return values.length ? values : DEFAULT_PERFORMANCES.slice();
  }

  function isAllowedPerformance(value, options) {
    return allowedPerformances(options).indexOf(text(value)) >= 0;
  }

  function publicRecord(record) {
    var row = record || {};
    var status = text(row.status);
    return {
      ticketId: text(row.student_ticket_code),
      name: text(row.full_name),
      amount: Number(row.amount) || PRICE,
      status: status,
      statusLabel: statusLabel(status),
      rejectionNote: status === STATUSES.REJECTED ? text(row.admin_note) : '',
      used: status === STATUSES.USED || Boolean(row.used_at),
      assignedPerformance: status === STATUSES.USED ? text(row.assigned_performance) : ''
    };
  }

  function recordTime(record) {
    var millis = parseMillis(record && record.created_at);
    return isFinite(millis) ? millis : 0;
  }

  function preferredLookupRecord(records) {
    var priority = {};
    priority[STATUSES.USED] = 1;
    priority[STATUSES.APPROVED] = 2;
    priority[STATUSES.WAITING_REVIEW] = 3;
    priority[STATUSES.REJECTED] = 4;
    return (records || []).slice().sort(function (a, b) {
      var aPriority = priority[a.status] || 99;
      var bPriority = priority[b.status] || 99;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return recordTime(b) - recordTime(a);
    })[0] || null;
  }

  function uniqueNormalizedStudentIds(records) {
    var seen = {};
    (records || []).forEach(function (record) {
      var id = normalizeStudentId(record.student_id);
      if (id) seen[id] = true;
    });
    return Object.keys(seen);
  }

  function lookupRecords(records, input, prefixes, length) {
    var raw = text(input);
    var studentId = normalizeStudentId(raw);
    if (isEligibleStudentId(studentId, prefixes || DEFAULT_PREFIXES, length || 7)) {
      var studentMatches = (records || []).filter(function (record) {
        return normalizeStudentId(record.student_id) === studentId;
      });
      return { kind: 'STUDENT_ID', normalized: studentId, record: preferredLookupRecord(studentMatches), records: studentMatches };
    }
    var phone = normalizeThaiPhone(raw);
    if (!phone) return { kind: 'INVALID', normalized: '', record: null, records: [] };
    var phoneMatches = (records || []).filter(function (record) {
      return normalizeThaiPhone(record.phone) === phone;
    });
    var ids = uniqueNormalizedStudentIds(phoneMatches);
    if (ids.length > 1) return { kind: 'AMBIGUOUS_PHONE', normalized: phone, record: null, records: phoneMatches };
    return { kind: 'PHONE', normalized: phone, studentId: ids[0] || '', record: preferredLookupRecord(phoneMatches), records: phoneMatches };
  }

  function publicLookupRecord(record) {
    var row = record || {};
    var status = text(row.status);
    var result = {
      ticketId: text(row.student_ticket_code),
      amount: Number(row.amount) || PRICE,
      status: status,
      statusLabel: statusLabel(status),
      used: status === STATUSES.USED || Boolean(row.used_at),
      assignedPerformance: status === STATUSES.USED ? text(row.assigned_performance) : ''
    };
    if (status === STATUSES.REJECTED) result.message = GENERIC_REJECTED_MESSAGE;
    return result;
  }

  function adminTokenMatches(expected, provided) {
    return Boolean(text(expected)) && text(expected) === text(provided);
  }

  function matchesQuery(record, query) {
    var q = text(query).toLowerCase();
    if (!q) return true;
    var phoneQuery = q.replace(/\D/g, '');
    return [record.student_ticket_code, record.full_name, record.email, record.student_id, record.phone].some(function (value) {
      return text(value).toLowerCase().indexOf(q) >= 0;
    }) || Boolean(phoneQuery && text(record.phone).indexOf(phoneQuery) >= 0);
  }

  function sortRecords(records, sort) {
    var copy = (records || []).slice();
    var mode = text(sort) || 'newest';
    copy.sort(function (a, b) {
      if (mode === 'oldest') return parseMillis(a.created_at) - parseMillis(b.created_at);
      if (mode === 'name') return text(a.full_name).localeCompare(text(b.full_name), 'th');
      if (mode === 'student_id') return text(a.student_id).localeCompare(text(b.student_id));
      return parseMillis(b.created_at) - parseMillis(a.created_at);
    });
    return copy;
  }

  return {
    PRICE: PRICE,
    MAX_UPLOAD_BYTES: MAX_UPLOAD_BYTES,
    GENERATION_MIN: GENERATION_MIN,
    GENERATION_MAX: GENERATION_MAX,
    GENERIC_REJECTED_MESSAGE: GENERIC_REJECTED_MESSAGE,
    ALLOWED_MIME: ALLOWED_MIME.slice(),
    STATUSES: STATUSES,
    SALE_STATES: SALE_STATES,
    DEFAULT_PREFIXES: DEFAULT_PREFIXES.slice(),
    DEFAULT_PERFORMANCES: DEFAULT_PERFORMANCES.slice(),
    saleStateAtServerTime: saleStateAtServerTime,
    isSaleOpenAtServerTime: isSaleOpenAtServerTime,
    normalizedPrefixes: normalizedPrefixes,
    normalizeStudentId: normalizeStudentId,
    isEligibleStudentId: isEligibleStudentId,
    isPositiveGeneration: isPositiveGeneration,
    isReasonableEmail: isReasonableEmail,
    normalizeThaiPhone: normalizeThaiPhone,
    isValidThaiPhone: isValidThaiPhone,
    normalizeSubmission: normalizeSubmission,
    validateCustomerInput: validateCustomerInput,
    canSubmitForStudent: canSubmitForStudent,
    findByRequestId: findByRequestId,
    uploadValidation: uploadValidation,
    extensionForMime: extensionForMime,
    ticketCode: ticketCode,
    nextTicketSequence: nextTicketSequence,
    canTransition: canTransition,
    transitionResult: transitionResult,
    statusLabel: statusLabel,
    confirmedRevenue: confirmedRevenue,
    safeSheetValue: safeSheetValue,
    csvEscape: csvEscape,
    allowedPerformances: allowedPerformances,
    isAllowedPerformance: isAllowedPerformance,
    publicRecord: publicRecord,
    preferredLookupRecord: preferredLookupRecord,
    lookupRecords: lookupRecords,
    publicLookupRecord: publicLookupRecord,
    adminTokenMatches: adminTokenMatches,
    matchesQuery: matchesQuery,
    sortRecords: sortRecords
  };
}());

if (typeof module !== 'undefined' && module.exports) module.exports = StudentDomain;
