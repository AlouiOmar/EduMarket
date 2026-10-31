import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/unit_test';
process.env.JWT_SECRET ||= 'test-secret-must-contain-more-than-32-characters';

const { signV4, documentStore } = await import('../dist/integrations/documentStore.js');
const { inspectDocument, TRANSITIONS, CANDIDATE_EDITABLE, encryptSensitive, decryptSensitive, missingItems } = await import('../dist/modules/teacher-applications/rules.js');

test('S3 signature matches the AWS Signature V4 reference example (GET Object)', () => {
  const empty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const header = signV4({
    method: 'GET', url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'), headers: { range: 'bytes=0-9', 'x-amz-content-sha256': empty, 'x-amz-date': '20130524T000000Z' },
    payloadHash: empty, region: 'us-east-1', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', date: new Date('2013-05-24T00:00:00Z'),
  });
  assert.equal(header, 'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

test('documents: the real content decides; extension and declared type must agree; active PDF content is refused', () => {
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF');
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  assert.equal(inspectDocument(pdf, 'application/pdf', 'cv.pdf').mimeType, 'application/pdf');
  assert.equal(inspectDocument(png, 'image/png', 'scan.PNG').extension, 'png');
  assert.equal(inspectDocument(jpeg, 'image/jpeg', 'photo.jpeg').extension, 'jpg');
  assert.equal(inspectDocument(pdf, 'application/pdf', 'cv.exe').error, 'DOCUMENT_TYPE_MISMATCH');
  assert.equal(inspectDocument(png, 'application/pdf', 'cv.pdf').error, 'DOCUMENT_TYPE_MISMATCH');
  assert.equal(inspectDocument(Buffer.from('MZ\x90\x00'), 'application/pdf', 'cv.pdf').error, 'INVALID_DOCUMENT_CONTENT');
  assert.equal(inspectDocument(Buffer.from('%PDF-1.4\n<< /Launch /F (cmd.exe) >>\n%%EOF'), 'application/pdf', 'x.pdf').error, 'DOCUMENT_ACTIVE_CONTENT');
  assert.equal(inspectDocument(Buffer.from('%PDF-1.4\n<< /EmbeddedFile 2 0 R >>\n%%EOF'), 'application/pdf', 'x.pdf').error, 'DOCUMENT_ACTIVE_CONTENT');
  assert.match(inspectDocument(pdf, 'application/pdf', 'cv.pdf').sha256, /^[a-f0-9]{64}$/);
});

test('workflow: the candidate only submits and resubmits; every review decision belongs to the administration', () => {
  const byCandidate = Object.entries(TRANSITIONS).filter(([, rule]) => rule.by === 'candidate').map(([name]) => name).sort();
  assert.deepEqual(byCandidate, ['resubmit', 'submit']);
  assert.deepEqual(TRANSITIONS.approve.from, ['under_review']);
  assert.deepEqual(TRANSITIONS.suspend.from, ['approved']);
  assert.deepEqual(CANDIDATE_EDITABLE, ['draft', 'additional_information_required']);
  assert.ok(!Object.values(TRANSITIONS).some(rule => rule.from.includes('rejected')), 'a refusal is final for that file');
});

test('identity numbers are encrypted (random IV, authenticated) and a minor or an expired document blocks submission', () => {
  const first = encryptSensitive('AB123456'), second = encryptSensitive('AB123456');
  assert.notEqual(first, second); assert.equal(decryptSensitive(first), 'AB123456');
  const tampered = first.slice(0, -2) + (first.endsWith('AA') ? 'BB' : 'AA');
  assert.throws(() => decryptSensitive(tampered));
  const missing = missingItems({ personal: { birthDate: new Date(Date.now() - 10 * 365 * 86_400_000) }, identity: { expiresAt: new Date(Date.now() - 86_400_000) }, documents: [] });
  assert.ok(missing.includes('personal.adult') && missing.includes('identity.expired') && missing.includes('documents.identity') && missing.includes('terms'));
});

test('local document store refuses keys it did not generate (no path traversal)', async () => {
  await assert.rejects(documentStore().get('../../etc/passwd'), /INVALID_DOCUMENT_KEY/);
  await assert.rejects(documentStore().put('cv.pdf', Buffer.from('x'), 'application/pdf'), /INVALID_DOCUMENT_KEY/);
});
