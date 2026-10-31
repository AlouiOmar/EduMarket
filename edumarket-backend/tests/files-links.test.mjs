import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/unused_test';
process.env.JWT_SECRET ||= 'test-secret-must-contain-more-than-32-characters';
const { isBlockedAddress, collectLinks, checkLink } = await import('../dist/modules/courses/links.js');
const { fileReferences } = await import('../dist/modules/courses/files.js');
const { blocksSchema } = await import('../dist/modules/courses/blocks.js');

describe('link checker safety', () => {
  test('private, loopback, link-local, CGNAT and reserved addresses are blocked', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', 'not-an-ip']) {
      assert.equal(isBlockedAddress(address), true, address);
    }
    for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111']) assert.equal(isBlockedAddress(address), false, address);
  });

  test('requests to private hosts, other ports or credentials are refused before any network access', async () => {
    assert.equal((await checkLink('http://127.0.0.1/admin')).status, 'blocked');
    assert.equal((await checkLink('http://169.254.169.254/latest/meta-data')).error, 'PRIVATE_ADDRESS');
    assert.equal((await checkLink('https://example.com:22/')).error, 'PORT_NOT_ALLOWED');
    assert.equal((await checkLink('https://user:pass@example.com/')).error, 'UNSUPPORTED_URL');
    assert.equal((await checkLink('ftp://example.com/file')).status, 'blocked');
  });

  test('links are collected from link items and block HTML (published content and drafts), with their locations', () => {
    const chapters = [{ id: 'c1', title: 'Chapitre 1', lessons: [
      { id: 'l1', title: 'Doc', type: 'link', url: 'https://angular.dev/guide' },
      { id: 'l2', title: 'Cours', type: 'text', blocks: [{ id: 'b', type: 'text', html: '<p><a href="https://angular.dev/guide">guide</a> <a href="mailto:x@y.z">m</a></p>' }], draft: { title: 'Cours', type: 'text', blocks: [{ id: 'b', type: 'text', html: '<a href="https://rxjs.dev/">rx</a>' }] } },
    ] }];
    const links = collectLinks(chapters);
    assert.deepEqual([...links.keys()].sort(), ['https://angular.dev/guide', 'https://rxjs.dev/']);
    assert.deepEqual(links.get('https://angular.dev/guide').map(location => location.itemId), ['l1']);
    assert.deepEqual(links.get('https://rxjs.dev/').map(location => location.itemId), ['l2'], 'working copy (draft) links are checked');
  });
});

describe('file references', () => {
  test('a file is used by published content, drafts, archived versions, thumbnails, banner, assignments or lesson media', () => {
    const references = fileReferences({
      chapters: [{ id: 'c1', title: 'M', thumbnail: { assetId: 'thumb' }, lessons: [
        { id: 'l1', title: 'A', blocks: [{ id: 'b', type: 'image', assetId: 'pub' }], draft: { blocks: [{ id: 'b', type: 'file', assetId: 'draft' }] } },
      ] }],
      bannerAssetId: 'banner',
      versions: [{ itemId: 'l1', version: 1, title: 'A', snapshot: { blocks: [{ id: 'b', type: 'image', assetId: 'old' }] } }],
      assignments: [{ title: 'TP', attachments: [{ assetId: 'attach' }] }],
      lessonAssets: [{ _id: 'video', lessonId: 'l1' }, { _id: 'orphan-video', lessonId: 'deleted-lesson' }],
    });
    const kinds = id => (references.get(id) || []).map(reference => reference.kind);
    assert.deepEqual(kinds('pub'), ['published']); assert.deepEqual(kinds('draft'), ['draft']); assert.deepEqual(kinds('old'), ['version']);
    assert.deepEqual(kinds('thumb'), ['thumbnail']); assert.deepEqual(kinds('banner'), ['banner']); assert.deepEqual(kinds('attach'), ['assignment']);
    assert.deepEqual(kinds('video'), ['lesson_media']); assert.deepEqual(kinds('orphan-video'), [], 'media of a deleted lesson is unused');
  });
});

describe('math blocks', () => {
  test('LaTeX with a text alternative is accepted; link and resource commands are refused', () => {
    const parsed = blocksSchema.parse([{ id: 'm1', type: 'math', latex: '\\frac{a}{b} = \\sqrt{x^2}', description: 'a sur b égale racine de x carré' }]);
    assert.equal(parsed[0].display, 'block');
    assert.throws(() => blocksSchema.parse([{ id: 'm2', type: 'math', latex: '\\href{javascript:alert(1)}{x}' }]));
    assert.throws(() => blocksSchema.parse([{ id: 'm3', type: 'math', latex: '\\includegraphics{http://evil/x.png}' }]));
    assert.throws(() => blocksSchema.parse([{ id: 'm4', type: 'math', latex: '' }]));
  });
});
