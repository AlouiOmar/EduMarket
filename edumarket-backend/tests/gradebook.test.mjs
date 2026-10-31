import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

const { computeGrades, round2, countedScore } = await import('../dist/modules/gradebook/compute.js');
const { createZip, readZip, safeZipPath, ZipError } = await import('../dist/common/zip.js');
const { buildXlsx } = await import('../dist/common/xlsx.js');

const categories = [{ id: 'hw', name: 'Devoirs', weight: 40 }, { id: 'ex', name: 'Examens', weight: 60 }];
const columns = [
  { id: 'a1', categoryId: 'hw', maxPoints: 20, countsInFinal: true, missingAsZero: false },
  { id: 'a2', categoryId: 'hw', maxPoints: 10, countsInFinal: true, missingAsZero: false },
  { id: 'e1', categoryId: 'ex', maxPoints: 100, countsInFinal: true, missingAsZero: false },
];

describe('grade calculation', () => {
  test('weighted categories, points-weighted inside a category, /20 conversion', () => {
    const result = computeGrades(categories, columns, [{ columnId: 'a1', score: 15 }, { columnId: 'a2', score: 9 }, { columnId: 'e1', score: 70 }]);
    // Devoirs 24/30 = 80 %, Examens 70 % → 0.4×80 + 0.6×70 = 74 % → 14.8/20
    assert.equal(result.categories[0].percent, 80);
    assert.equal(result.percent, 74);
    assert.equal(result.outOf20, 14.8);
  });

  test('a missing grade is never a zero; weights renormalize over graded categories', () => {
    const result = computeGrades(categories, columns, [{ columnId: 'a1', score: 10 }]);
    assert.equal(result.categories[1].percent, null, 'no exam grade: category excluded, not 0');
    assert.equal(result.percent, 50);
    assert.equal(computeGrades(categories, columns, []).outOf20, null, 'no grade at all: null, not 0');
    assert.equal(computeGrades(categories, columns, [{ columnId: 'a1', score: 0 }]).percent, 0, 'an explicit 0 counts');
  });

  test('missing-as-zero only after the (individually extended) due date; excused entries are excluded', () => {
    const now = new Date('2026-11-10T00:00:00Z');
    const column = { id: 'c', categoryId: 'hw', maxPoints: 10, countsInFinal: true, missingAsZero: true, dueAt: '2026-11-01T00:00:00Z' };
    assert.equal(countedScore(column, undefined, now), 0);
    assert.equal(countedScore(column, { columnId: 'c', score: null, dueAt: '2026-11-20T00:00:00Z' }, now), null, 'extension not expired');
    assert.equal(countedScore({ ...column, missingAsZero: false }, undefined, now), null);
    assert.equal(countedScore(column, { columnId: 'c', score: 7, excused: true }, now), null);
  });

  test('columns excluded from the final grade and zero-weight categories do not count', () => {
    const result = computeGrades([{ id: 'hw', name: 'H', weight: 1 }, { id: 'z', name: 'Z', weight: 0 }],
      [{ id: 'a', categoryId: 'hw', maxPoints: 10, countsInFinal: false, missingAsZero: false }, { id: 'b', categoryId: 'hw', maxPoints: 10, countsInFinal: true, missingAsZero: false }, { id: 'c', categoryId: 'z', maxPoints: 10, countsInFinal: true, missingAsZero: false }],
      [{ columnId: 'a', score: 0 }, { columnId: 'b', score: 5 }, { columnId: 'c', score: 0 }]);
    assert.equal(result.percent, 50);
  });

  test('rounding: half away from zero to 2 decimals', () => {
    assert.equal(round2(12.345), 12.35);
    assert.equal(round2(1.005), 1.01);
    assert.equal(round2(2 / 3 * 100), 66.67);
  });
});

describe('zip and xlsx', () => {
  test('zip round trip with UTF-8 names', () => {
    const zip = createZip([{ name: 'imsmanifest.xml', data: '<manifest/>' }, { name: 'cours/leçon 1.html', data: Buffer.from('<p>é</p>') }]);
    const entries = readZip(zip);
    assert.deepEqual(entries.map(entry => entry.path), ['imsmanifest.xml', 'cours/leçon 1.html']);
    assert.equal(entries[1].data.toString(), '<p>é</p>');
  });

  test('unsafe paths, bombs and corruption are refused', () => {
    for (const name of ['../evil.js', '/etc/passwd', 'a\\b.js', 'C:/x', 'a/../../b', './a']) assert.equal(safeZipPath(name), null, name);
    assert.throws(() => readZip(createZip([{ name: '../evil.js', data: 'x' }])), error => error instanceof ZipError && error.code === 'ZIP_UNSAFE_PATH');
    const bomb = createZip([{ name: 'big.txt', data: Buffer.alloc(2 * 1024 * 1024) }]);
    assert.throws(() => readZip(bomb, { maxEntries: 10, maxEntryBytes: 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 }), error => error.code === 'ZIP_ENTRY_TOO_LARGE');
    const corrupted = Buffer.from(createZip([{ name: 'a.txt', data: 'hello world hello world' }]));
    corrupted[35] ^= 0xff;
    assert.throws(() => readZip(corrupted), error => error instanceof ZipError);
    assert.throws(() => readZip(Buffer.from('not a zip')), error => error.code === 'ZIP_INVALID');
  });

  test('xlsx: valid package, text cells never become formulas', () => {
    const file = buildXlsx('Notes', [['Étudiant', 'Note'], ['=HYPERLINK("x")', 14.5]]);
    const entries = readZip(file);
    const sheet = entries.find(entry => entry.path === 'xl/worksheets/sheet1.xml').data.toString();
    assert.match(sheet, /t="inlineStr"><is><t xml:space="preserve">=HYPERLINK\(&quot;x&quot;\)<\/t>/);
    assert.match(sheet, /<v>14.5<\/v>/);
    assert.doesNotMatch(sheet, /<f>/);
    assert.ok(entries.some(entry => entry.path === '[Content_Types].xml'));
    assert.equal(typeof zlib.crc32, 'function');
  });
});
