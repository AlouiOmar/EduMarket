import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const { parseManifest, checkFilePolicy, validateCmi, outcome, ScormError } = await import('../dist/modules/scorm/manifest.js');

export const manifest12 = (href = 'index.html') => `<?xml version="1.0"?>
<manifest identifier="com.edumarket.signals" version="1" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org1"><organization identifier="org1"><title>Signals &amp; computed</title>
    <item identifier="item1" identifierref="res1"><title>Leçon</title></item></organization></organizations>
  <resources><resource identifier="res1" type="webcontent" adlcp:scormtype="sco" href="${href}"><file href="index.html"/></resource></resources>
</manifest>`;

describe('SCORM manifest', () => {
  test('SCORM 1.2: version, title, launch file', () => {
    assert.deepEqual(parseManifest(manifest12()), { version: '1.2', identifier: 'com.edumarket.signals', title: 'Signals & computed', launchPath: 'index.html' });
  });

  test('SCORM 2004 with xml:base and query string', () => {
    const xml = `<manifest identifier="m" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"><metadata><schemaversion>2004 4th Edition</schemaversion></metadata>
      <organizations default="o"><organization identifier="o"><title>T</title><item identifier="i" identifierref="r"/></organization></organizations>
      <resources xml:base="content/"><resource identifier="r" adlcp:scormType="sco" href="sco/start.html?lang=fr"/></resources></manifest>`;
    assert.deepEqual(parseManifest(xml), { version: '2004', identifier: 'm', title: 'T', launchPath: 'content/sco/start.html' });
  });

  test('invalid manifests are refused (no launch, path escape, external URL, DTD entities, unknown version)', () => {
    const fails = (xml, code) => assert.throws(() => parseManifest(xml), error => error instanceof ScormError && error.code === code);
    fails('<not-a-manifest/>', 'SCORM_MANIFEST_INVALID');
    fails(manifest12('../../etc/passwd'), 'SCORM_LAUNCH_MISSING');
    fails(manifest12('https://evil.example/x.html'), 'SCORM_LAUNCH_MISSING');
    fails(`<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>${manifest12()}`, 'SCORM_MANIFEST_INVALID');
    fails(manifest12().replace('<schemaversion>1.2</schemaversion>', '<schemaversion>9</schemaversion>').replace('adlcp_rootv1p2', 'x'), 'SCORM_VERSION_UNSUPPORTED');
  });

  test('file policy: static web content only', () => {
    assert.doesNotThrow(() => checkFilePolicy(['index.html', 'js/app.js', 'img/logo.svg', 'media/video.mp4', 'imsmanifest.xml']));
    for (const bad of ['tool.exe', 'backend/index.php', 'run.sh', 'lib.dll', 'Makefile', 'page.jsp']) assert.throws(() => checkFilePolicy(['index.html', bad]), error => error.code === 'SCORM_FORBIDDEN_FILE', bad);
  });
});

describe('SCORM runtime data', () => {
  test('only whitelisted, valid elements are kept', () => {
    const { accepted, rejected } = validateCmi('1.2', { 'cmi.core.lesson_status': 'completed', 'cmi.core.score.raw': '85', 'cmi.core.student_id': 'hack', 'cmi.core.lesson_status_x': 'x', 'cmi.suspend_data': 'x'.repeat(5000) });
    assert.deepEqual(accepted, { 'cmi.core.lesson_status': 'completed', 'cmi.core.score.raw': '85' });
    assert.deepEqual(rejected.sort(), ['cmi.core.lesson_status_x', 'cmi.core.student_id', 'cmi.suspend_data']);
    assert.deepEqual(validateCmi('2004', { 'cmi.score.scaled': '1.5', 'cmi.completion_status': 'completed' }).accepted, { 'cmi.completion_status': 'completed' });
  });

  test('outcome: completion, success and percentage per version', () => {
    assert.deepEqual(outcome('1.2', { 'cmi.core.lesson_status': 'passed', 'cmi.core.score.raw': '17', 'cmi.core.score.max': '20' }), { completed: true, passed: true, percent: 85, suspended: false });
    assert.deepEqual(outcome('1.2', { 'cmi.core.lesson_status': 'incomplete', 'cmi.core.exit': 'suspend' }), { completed: false, passed: null, percent: null, suspended: true });
    assert.deepEqual(outcome('2004', { 'cmi.completion_status': 'completed', 'cmi.success_status': 'failed', 'cmi.score.scaled': '0.4' }), { completed: true, passed: false, percent: 40, suspended: false });
  });
});
