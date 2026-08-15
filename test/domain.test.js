const test = require('node:test');
const assert = require('node:assert/strict');
const Domain = require('../src/Domain.js');

const START = '2026-08-19T09:00:00+07:00';
const END = '2026-08-19T23:59:59+07:00';
const settings = { ELIGIBLE_STUDENT_PREFIXES: '66,67,68,69', STUDENT_ID_LENGTH: '7' };

test('sale window: 19 Aug 08:59:59 Bangkok is closed before opening', () => {
  assert.equal(Domain.saleStateAtServerTime('2026-08-19T08:59:59+07:00', START, END), Domain.SALE_STATES.CLOSED_NOT_STARTED);
});

test('sale window: exact start is open', () => {
  assert.equal(Domain.saleStateAtServerTime(START, START, END), Domain.SALE_STATES.OPEN);
});

test('sale window: exact end is open', () => {
  assert.equal(Domain.saleStateAtServerTime(END, START, END), Domain.SALE_STATES.OPEN);
});

test('sale window: 20 Aug 00:00 Bangkok is closed after ending', () => {
  assert.equal(Domain.saleStateAtServerTime('2026-08-20T00:00:00+07:00', START, END), Domain.SALE_STATES.CLOSED_ENDED);
});

test('sale window uses server time rather than a client-provided time', () => {
  const clientClock = START;
  const serverClock = '2026-08-20T00:00:00+07:00';
  assert.equal(Domain.saleStateAtServerTime(serverClock, START, END), Domain.SALE_STATES.CLOSED_ENDED);
  assert.notEqual(clientClock, serverClock);
});

test('student ID 6605810 is valid', () => assert.equal(Domain.isEligibleStudentId('6605810', settings.ELIGIBLE_STUDENT_PREFIXES, 7), true));
test('student ID 6700000 is valid', () => assert.equal(Domain.isEligibleStudentId('6700000', settings.ELIGIBLE_STUDENT_PREFIXES, 7), true));
test('student ID 6800000 is valid', () => assert.equal(Domain.isEligibleStudentId('6800000', settings.ELIGIBLE_STUDENT_PREFIXES, 7), true));
test('student ID 6900000 is valid', () => assert.equal(Domain.isEligibleStudentId('6900000', settings.ELIGIBLE_STUDENT_PREFIXES, 7), true));
test('student ID 6500000 is invalid', () => assert.equal(Domain.isEligibleStudentId('6500000', settings.ELIGIBLE_STUDENT_PREFIXES, 7), false));
test('student ID 7000000 is invalid', () => assert.equal(Domain.isEligibleStudentId('7000000', settings.ELIGIBLE_STUDENT_PREFIXES, 7), false));
test('wrong-length student ID is invalid', () => assert.equal(Domain.isEligibleStudentId('660581', settings.ELIGIBLE_STUDENT_PREFIXES, 7), false));
test('non-numeric student ID is invalid', () => assert.equal(Domain.isEligibleStudentId('66A5810', settings.ELIGIBLE_STUDENT_PREFIXES, 7), false));

test('existing WAITING_REVIEW blocks a second entitlement', () => {
  assert.equal(Domain.canSubmitForStudent([{ student_id: '6605810', status: 'WAITING_REVIEW' }], '6605810').allowed, false);
});

test('existing APPROVED blocks a second entitlement', () => {
  assert.equal(Domain.canSubmitForStudent([{ student_id: '6605810', status: 'APPROVED' }], '6605810').allowed, false);
});

test('existing USED blocks a second entitlement', () => {
  assert.equal(Domain.canSubmitForStudent([{ student_id: '6605810', status: 'USED' }], '6605810').allowed, false);
});

test('only previous REJECTED records allow resubmission', () => {
  const result = Domain.canSubmitForStudent([
    { student_id: '6605810', status: 'REJECTED' },
    { student_id: '6605810', status: 'REJECTED' }
  ], '6605810');
  assert.deepEqual(result, { allowed: true, reason: 'REJECTED_HISTORY_ONLY' });
});

test('a request_id already recorded is found for idempotent retry', () => {
  const record = { request_id: 'request-12345678', student_ticket_code: 'PAC-STU-0001' };
  assert.equal(Domain.findByRequestId([record], 'request-12345678'), record);
});

test('fixed pricing ignores client amount, quantity, and performance fields', () => {
  const normalized = Domain.normalizeSubmission({
    full_name: 'A Student', email: 'a@example.com', phone: '064-279-0662', student_id: '6605810', generation: '19', request_id: 'request-12345678',
    amount: 1, quantity: 99, performance: '21 Aug 2026 · 17:00'
  });
  assert.equal(normalized.amount, 99);
  assert.equal(normalized.phone, '0642790662');
  assert.equal(normalized.status, 'WAITING_REVIEW');
  assert.equal('quantity' in normalized, false);
  assert.equal('performance' in normalized, false);
});

test('WAITING_REVIEW contributes zero confirmed revenue', () => {
  assert.equal(Domain.confirmedRevenue([{ status: 'WAITING_REVIEW', amount: 99 }]), 0);
});

test('APPROVED contributes its stored amount', () => {
  assert.equal(Domain.confirmedRevenue([{ status: 'APPROVED', amount: 99 }]), 99);
});

test('USED contributes its stored amount', () => {
  assert.equal(Domain.confirmedRevenue([{ status: 'USED', amount: 99 }]), 99);
});

test('REJECTED contributes zero confirmed revenue', () => {
  assert.equal(Domain.confirmedRevenue([{ status: 'REJECTED', amount: 99 }]), 0);
});

test('WAITING_REVIEW to APPROVED is allowed', () => assert.equal(Domain.canTransition('WAITING_REVIEW', 'APPROVED'), true));
test('WAITING_REVIEW to REJECTED is allowed', () => assert.equal(Domain.canTransition('WAITING_REVIEW', 'REJECTED'), true));
test('APPROVED to USED is allowed', () => assert.equal(Domain.canTransition('APPROVED', 'USED'), true));
test('REJECTED to APPROVED is blocked', () => assert.equal(Domain.canTransition('REJECTED', 'APPROVED'), false));
test('USED cannot be reused', () => assert.equal(Domain.canTransition('USED', 'USED'), false));
test('repeating the same review status is idempotent', () => assert.deepEqual(Domain.transitionResult('APPROVED', 'APPROVED'), { allowed: true, idempotent: true }));

test('valid JPEG upload is accepted', () => assert.equal(Domain.uploadValidation({ mimeType: 'image/jpeg', sizeBytes: 100 }).ok, true));
test('valid PNG upload is accepted', () => assert.equal(Domain.uploadValidation({ mimeType: 'image/png', sizeBytes: 100 }).ok, true));
test('valid WEBP upload is accepted', () => assert.equal(Domain.uploadValidation({ mimeType: 'image/webp', sizeBytes: 100 }).ok, true));
test('unsupported MIME upload is rejected', () => assert.equal(Domain.uploadValidation({ mimeType: 'application/pdf', sizeBytes: 100 }).ok, false));
test('oversize upload is rejected', () => assert.equal(Domain.uploadValidation({ mimeType: 'image/jpeg', sizeBytes: Domain.MAX_UPLOAD_BYTES + 1 }).ok, false));

test('ticket IDs are human-readable and sequence-based', () => {
  assert.equal(Domain.ticketCode(1), 'PAC-STU-0001');
  assert.equal(Domain.ticketCode(42), 'PAC-STU-0042');
  assert.equal(Domain.ticketCode(10000), 'PAC-STU-10000');
  assert.equal(Domain.nextTicketSequence(['PAC-STU-0001', 'PAC-STU-0041', 'PAC-STU-0007']), 42);
});

test('sheet formula injection is neutralized', () => {
  assert.equal(Domain.safeSheetValue('=HYPERLINK("https://example.com")'), "'=HYPERLINK(\"https://example.com\")");
  assert.equal(Domain.safeSheetValue('Normal text'), 'Normal text');
});

test('customer response contains no internal or Drive identifiers', () => {
  const response = Domain.publicRecord({
    internal_id: 'uuid-secret', student_ticket_code: 'PAC-STU-0001', full_name: 'A Student', amount: 99,
    status: 'WAITING_REVIEW', rsu_connect_file_id: 'drive-secret', payment_slip_file_id: 'drive-secret-2', admin_note: 'private'
  });
  const serialized = JSON.stringify(response);
  assert.equal(serialized.includes('uuid-secret'), false);
  assert.equal(serialized.includes('drive-secret'), false);
  assert.equal(Object.keys(response).some((key) => /file|uuid|token|audit/i.test(key)), false);
});

test('Admin token comparison requires the configured token', () => {
  assert.equal(Domain.adminTokenMatches('student-admin-secret', 'student-admin-secret'), true);
  assert.equal(Domain.adminTokenMatches('student-admin-secret', 'production-secret'), false);
  assert.equal(Domain.adminTokenMatches('', 'anything'), false);
});

test('customer input validates email, phone, generation, and fixed student rules', () => {
  const result = Domain.validateCustomerInput({ full_name: 'A Student', email: 'a@example.com', phone: '0642790662', student_id: '6605810', generation: '19', request_id: 'request-12345678' }, settings);
  assert.equal(result.ok, true);
  assert.equal(Domain.validateCustomerInput({ full_name: 'A Student', email: 'not-an-email', phone: '0642790662', student_id: '6605810', generation: '19', request_id: 'request-12345678' }, settings).ok, false);
});

test('generation 19 is valid', () => assert.equal(Domain.isPositiveGeneration('19'), true));
test('generation 1 is valid', () => assert.equal(Domain.isPositiveGeneration('1'), true));
test('generation 99 is valid', () => assert.equal(Domain.isPositiveGeneration('99'), true));
test('generation 0 is invalid', () => assert.equal(Domain.isPositiveGeneration('0'), false));
test('negative generation is invalid', () => assert.equal(Domain.isPositiveGeneration('-1'), false));
test('decimal generation is invalid', () => assert.equal(Domain.isPositiveGeneration('1.5'), false));
test('text generation is invalid', () => assert.equal(Domain.isPositiveGeneration('abc'), false));
test('empty generation is invalid', () => assert.equal(Domain.isPositiveGeneration(''), false));

test('valid Thai phone is accepted and keeps its leading zero', () => {
  assert.equal(Domain.normalizeThaiPhone('0642790662'), '0642790662');
  assert.equal(Domain.normalizeThaiPhone('064-279-0662'), '0642790662');
});

test('international Thai phone normalizes to local format', () => {
  assert.equal(Domain.normalizeThaiPhone('+66 64 279 0662'), '0642790662');
});

test('invalid Thai phone is rejected', () => {
  assert.equal(Domain.normalizeThaiPhone('0742790662'), null);
  assert.equal(Domain.normalizeThaiPhone('064279066'), null);
  assert.equal(Domain.normalizeThaiPhone('phone-0642790662'), null);
});

test('new identifier values remain text semantics', () => {
  const normalized = Domain.normalizeSubmission({ phone: '0642790662', student_id: '6605810', generation: '01' });
  assert.equal(normalized.phone, '0642790662');
  assert.equal(normalized.student_id, '6605810');
  assert.equal(normalized.generation, '01');
  assert.equal(Domain.safeSheetValue(normalized.phone), '0642790662');
  assert.equal(Domain.safeSheetValue(normalized.student_id), '6605810');
  assert.equal(Domain.safeSheetValue(normalized.generation), '01');
});

test('Student ID lookup prefers active entitlement over older rejected history', () => {
  const rejected = { student_id: '6605810', status: 'REJECTED', created_at: '2026-08-19T10:00:00+07:00', student_ticket_code: 'PAC-STU-0001', amount: 99 };
  const waiting = { student_id: '6605810', status: 'WAITING_REVIEW', created_at: '2026-08-19T11:00:00+07:00', student_ticket_code: 'PAC-STU-0002', amount: 99 };
  const result = Domain.lookupRecords([rejected, waiting], '6605810', settings.ELIGIBLE_STUDENT_PREFIXES, 7);
  assert.equal(result.record, waiting);
});

test('Student ID lookup prioritizes USED, then APPROVED, then WAITING_REVIEW', () => {
  const records = [
    { student_id: '6605810', status: 'WAITING_REVIEW', created_at: '2026-08-19T12:00:00+07:00' },
    { student_id: '6605810', status: 'APPROVED', created_at: '2026-08-19T11:00:00+07:00' },
    { student_id: '6605810', status: 'USED', created_at: '2026-08-19T10:00:00+07:00' }
  ];
  assert.equal(Domain.lookupRecords(records, '6605810', settings.ELIGIBLE_STUDENT_PREFIXES, 7).record, records[2]);
});

test('only rejected Student ID history returns the latest rejected record', () => {
  const oldRejected = { student_id: '6605810', status: 'REJECTED', created_at: '2026-08-19T10:00:00+07:00', student_ticket_code: 'PAC-STU-0001' };
  const latestRejected = { student_id: '6605810', status: 'REJECTED', created_at: '2026-08-19T12:00:00+07:00', student_ticket_code: 'PAC-STU-0002' };
  assert.equal(Domain.lookupRecords([oldRejected, latestRejected], '6605810', settings.ELIGIBLE_STUDENT_PREFIXES, 7).record, latestRejected);
});

test('unknown eligible Student ID returns no lookup record', () => {
  const result = Domain.lookupRecords([], '6605810', settings.ELIGIBLE_STUDENT_PREFIXES, 7);
  assert.equal(result.kind, 'STUDENT_ID');
  assert.equal(result.record, null);
});

test('exact phone lookup works and applies the same history priority', () => {
  const rejected = { student_id: '6605810', phone: '0642790662', status: 'REJECTED', created_at: '2026-08-19T10:00:00+07:00' };
  const approved = { student_id: '6605810', phone: '064-279-0662', status: 'APPROVED', created_at: '2026-08-19T11:00:00+07:00' };
  const result = Domain.lookupRecords([rejected, approved], '+66 64 279 0662', settings.ELIGIBLE_STUDENT_PREFIXES, 7);
  assert.equal(result.kind, 'PHONE');
  assert.equal(result.record, approved);
});

test('shared phone across Student IDs returns an ambiguous lookup result', () => {
  const result = Domain.lookupRecords([
    { student_id: '6605810', phone: '0642790662', status: 'APPROVED' },
    { student_id: '6705810', phone: '0642790662', status: 'APPROVED' }
  ], '064-279-0662', settings.ELIGIBLE_STUDENT_PREFIXES, 7);
  assert.equal(result.kind, 'AMBIGUOUS_PHONE');
  assert.equal(result.record, null);
});

test('phone duplicates do not block a different Student ID purchase', () => {
  const result = Domain.canSubmitForStudent([{ student_id: '6605810', phone: '0642790662', status: 'APPROVED' }], '6705810');
  assert.equal(result.allowed, true);
});

test('public lookup response is minimal and never exposes personal or internal metadata', () => {
  const response = Domain.publicLookupRecord({
    student_ticket_code: 'PAC-STU-0001', full_name: 'A Student', email: 'a@example.com', phone: '0642790662', amount: 99,
    status: 'REJECTED', admin_note: 'private reason', reviewer: 'staff', internal_id: 'uuid', rsu_connect_file_id: 'drive-1', payment_slip_file_id: 'drive-2'
  });
  assert.equal(response.ticketId, 'PAC-STU-0001');
  assert.equal(response.message, Domain.GENERIC_REJECTED_MESSAGE);
  assert.equal('name' in response, false);
  assert.equal('full_name' in response, false);
  assert.equal('email' in response, false);
  assert.equal('phone' in response, false);
  assert.equal(JSON.stringify(response).includes('drive-1'), false);
  assert.equal(JSON.stringify(response).includes('private reason'), false);
  assert.equal(JSON.stringify(response).includes('staff'), false);
});

test('venue performance options are limited to the four configured values', () => {
  const options = Domain.DEFAULT_PERFORMANCES;
  assert.equal(options.length, 4);
  assert.equal(Domain.isAllowedPerformance(options[0], options), true);
  assert.equal(Domain.isAllowedPerformance('19 Aug 2026 · 20:00', options), false);
});

test('partial Admin search includes email, name, and Student ID fields', () => {
  const record = { student_ticket_code: 'PAC-STU-0001', full_name: 'สมชาย ใจดี', email: 'somchai@example.com', phone: '0642790662', student_id: '6605810' };
  assert.equal(Domain.matchesQuery(record, 'somchai@'), true);
  assert.equal(Domain.matchesQuery(record, 'ใจดี'), true);
  assert.equal(Domain.matchesQuery(record, '6605'), true);
  assert.equal(Domain.matchesQuery(record, '064-279-0662'), true);
  assert.equal(Domain.matchesQuery(record, 'missing'), false);
});
