import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/edumarket_test';
process.env.JWT_SECRET ||= 'test-secret-must-contain-more-than-32-characters';
process.env.CORS_ORIGIN ||= 'http://localhost:3000';

const { applyMove, studentOutline, accessibleItems, countableItems, studentCanAccessAsset, cloneContainer, remapAssets } = await import('../dist/modules/courses/structure.js');
const { blocksSchema, sanitizeRichText, sanitizeHtmlBlock, normalizeEmbedUrl } = await import('../dist/modules/courses/blocks.js');

const item = (id, chapterId, extra = {}) => ({ id, chapterId, title: id, type: 'text', ...extra });
const outline = () => [
  { id: 'c1', title: 'Chapitre 1', lessons: [item('l1', 'c1'), item('l2', 'c1'), item('l3', 'c1')] },
  { id: 'c2', title: 'Chapitre 2', lessons: [item('l4', 'c2')] },
  { id: 'c3', title: 'Chapitre 3', lessons: [] },
];
const ids = chapters => chapters.map(chapter => `${chapter.id}:${chapter.lessons.map(lesson => lesson.id).join(',')}`);

test('moves chapter 3 before chapter 1 and renumbers positions', () => {
  const moved = applyMove(outline(), { type: 'container', id: 'c3', toIndex: 0 });
  assert.deepEqual(moved.map(chapter => chapter.id), ['c3', 'c1', 'c2']);
  assert.deepEqual(moved.map(chapter => chapter.order), [0, 1, 2]);
});

test('moves a lesson to the last position of its module', () => {
  const moved = applyMove(outline(), { type: 'item', id: 'l1', toContainerId: 'c1', toIndex: 2 });
  assert.deepEqual(ids(moved)[0], 'c1:l2,l3,l1');
  assert.deepEqual(moved[0].lessons.map(lesson => lesson.order), [0, 1, 2]);
});

test('moves a lesson to another module and updates its parent', () => {
  const moved = applyMove(outline(), { type: 'item', id: 'l2', toContainerId: 'c3', toIndex: 0 });
  assert.deepEqual(ids(moved), ['c1:l1,l3', 'c2:l4', 'c3:l2']);
  assert.equal(moved[2].lessons[0].chapterId, 'c3');
});

test('keeps the content of a moved lesson untouched', () => {
  const source = outline();
  source[0].lessons[0] = item('l1', 'c1', { blocks: [{ id: 'b1', type: 'text', html: '<p>x</p>' }], quiz: { id: 'q', questions: [] }, visibility: 'hidden' });
  const moved = applyMove(source, { type: 'item', id: 'l1', toContainerId: 'c2', toIndex: 1 });
  const lesson = moved[1].lessons[1];
  assert.deepEqual(lesson.blocks, source[0].lessons[0].blocks);
  assert.equal(lesson.visibility, 'hidden');
  assert.deepEqual(lesson.quiz, { id: 'q', questions: [] });
  assert.equal(source[0].lessons[0].chapterId, 'c1', 'source outline is not mutated');
});

test('rejects invalid moves: unknown ids, item as parent, container into container, out-of-range positions', () => {
  assert.throws(() => applyMove(outline(), { type: 'item', id: 'nope', toContainerId: 'c1', toIndex: 0 }), { code: 'ITEM_NOT_FOUND' });
  assert.throws(() => applyMove(outline(), { type: 'item', id: 'l1', toContainerId: 'l2', toIndex: 0 }), { code: 'INVALID_DESTINATION' });
  assert.throws(() => applyMove(outline(), { type: 'item', id: 'l1', toContainerId: 'l1', toIndex: 0 }), { code: 'INVALID_DESTINATION' });
  assert.throws(() => applyMove(outline(), { type: 'container', id: 'c1', toIndex: 3 }), { code: 'INVALID_POSITION' });
  assert.throws(() => applyMove(outline(), { type: 'item', id: 'l1', toContainerId: 'c2', toIndex: 5 }), { code: 'INVALID_POSITION' });
  assert.throws(() => applyMove(outline(), { type: 'container', id: 'c1', toIndex: -1 }), { code: 'INVALID_POSITION' });
  // A container is never a valid item destination target id for another container (no third level exists in the model).
  assert.throws(() => applyMove(outline(), { type: 'container', id: 'l1', toIndex: 0 }), { code: 'CONTAINER_NOT_FOUND' });
});

test('long outlines: moving across 100 modules keeps every element exactly once', () => {
  const chapters = Array.from({ length: 100 }, (_, index) => ({ id: `c${index}`, title: `C${index}`, lessons: Array.from({ length: 20 }, (_, lessonIndex) => item(`c${index}-l${lessonIndex}`, `c${index}`)) }));
  let moved = applyMove(chapters, { type: 'container', id: 'c99', toIndex: 0 });
  moved = applyMove(moved, { type: 'item', id: 'c0-l0', toContainerId: 'c99', toIndex: 20 });
  assert.equal(moved[0].id, 'c99');
  assert.equal(moved[0].lessons.at(-1).id, 'c0-l0');
  const all = moved.flatMap(chapter => chapter.lessons.map(lesson => lesson.id));
  assert.equal(all.length, 2000);
  assert.equal(new Set(all).size, 2000);
});

test('student outline hides hidden and out-of-window content and never exposes children of hidden parents', () => {
  const now = new Date('2026-10-26T10:00:00Z');
  const chapters = [
    { id: 'c1', title: 'Visible', lessons: [item('l1', 'c1'), item('l2', 'c1', { visibility: 'hidden' }), item('l3', 'c1', { availableFrom: '2026-11-01T00:00:00Z' }), item('l4', 'c1', { availableUntil: '2026-10-01T00:00:00Z' })] },
    { id: 'c2', title: 'Hidden', visibility: 'hidden', lessons: [item('l5', 'c2', { visibility: 'visible' })] },
    { id: 'c3', title: 'Scheduled', visibility: 'visible', availableFrom: '2026-12-01T00:00:00Z', lessons: [item('l6', 'c3')] },
  ];
  assert.deepEqual(ids(studentOutline(chapters, { now })), ['c1:l1']);
  assert.deepEqual(ids(studentOutline(chapters, { now: new Date('2026-12-02T00:00:00Z') })), ['c1:l1,l3', 'c3:l6']);
  assert.deepEqual(countableItems(chapters).map(lesson => lesson.id), ['l1', 'l3', 'l4', 'l6'], 'scheduled content counts towards completion, hidden content does not');
});

test('sequential modules lock items after the first uncompleted one and strip their content', () => {
  const chapters = [{ id: 'c1', title: 'Seq', sequential: true, lessons: [item('l1', 'c1', { textContent: 'a' }), item('l2', 'c1', { textContent: 'b', blocks: [{ id: 'b', type: 'text', html: 'secret' }] }), item('l3', 'c1')] }];
  const fresh = studentOutline(chapters);
  assert.equal(fresh[0].lessons[0].locked, undefined);
  assert.equal(fresh[0].lessons[1].locked, true);
  assert.equal(fresh[0].lessons[1].blocks, undefined);
  assert.equal(fresh[0].lessons[1].textContent, undefined);
  assert.deepEqual(accessibleItems(chapters, { completedIds: ['l1'] }).map(lesson => lesson.id), ['l1', 'l2']);
  assert.deepEqual(accessibleItems(chapters, { completedIds: ['l1', 'l2'] }).map(lesson => lesson.id), ['l1', 'l2', 'l3']);
});

test('students reach only assets of content they can open', () => {
  const course = {
    banner: { assetId: 'banner' },
    chapters: [
      { id: 'c1', title: 'A', thumbnail: { assetId: 'thumb' }, lessons: [item('l1', 'c1', { blocks: [{ id: 'b', type: 'image', assetId: 'img1' }] }), item('l2', 'c1', { visibility: 'hidden', blocks: [{ id: 'b2', type: 'file', assetId: 'hiddenFile' }] })] },
      { id: 'c2', title: 'B', visibility: 'hidden', thumbnail: { assetId: 'hiddenThumb' }, lessons: [item('l3', 'c2')] },
    ],
  };
  assert.equal(studentCanAccessAsset(course, { _id: 'banner' }), true);
  assert.equal(studentCanAccessAsset(course, { _id: 'thumb' }), true);
  assert.equal(studentCanAccessAsset(course, { _id: 'img1' }), true);
  assert.equal(studentCanAccessAsset(course, { _id: 'hiddenFile' }), false);
  assert.equal(studentCanAccessAsset(course, { _id: 'hiddenThumb' }), false);
  assert.equal(studentCanAccessAsset(course, { _id: 'video', lessonId: 'l1' }), true);
  assert.equal(studentCanAccessAsset(course, { _id: 'video', lessonId: 'l3' }), false);
});

test('duplicated containers get fresh ids, stay hidden and keep order; asset remapping drops unknown media', () => {
  const source = { id: 'c1', title: 'Module', visibility: 'visible', thumbnail: { assetId: 'a1', alt: 'x' }, lessons: [item('l1', 'c1', { blocks: [{ id: 'b1', type: 'image', assetId: 'a2', alt: 'y' }, { id: 'b2', type: 'file', assetId: 'gone' }] }), item('l2', 'c1')] };
  const copy = cloneContainer(source, { titleSuffix: ' (copie)' });
  assert.notEqual(copy.id, 'c1');
  assert.equal(copy.title, 'Module (copie)');
  assert.equal(copy.visibility, 'hidden');
  assert.deepEqual(copy.lessons.map(lesson => lesson.title), ['l1', 'l2']);
  assert.ok(copy.lessons.every(lesson => lesson.chapterId === copy.id && lesson.visibility === 'hidden' && !['l1', 'l2'].includes(lesson.id)));
  assert.notEqual(copy.lessons[0].blocks[0].id, 'b1');
  const [remapped] = remapAssets([copy], new Map([['a1', 'n1'], ['a2', 'n2']]));
  assert.equal(remapped.thumbnail.assetId, 'n1');
  assert.deepEqual(remapped.lessons[0].blocks.map(block => block.assetId), ['n2']);
});

test('rich text sanitization removes scripts, handlers and dangerous URLs but keeps structure', () => {
  const html = sanitizeRichText('<h2 onclick="x()">Titre</h2><script>alert(1)</script><p>Texte <a href="javascript:alert(1)">bad</a> <a href="https://angular.dev">ok</a></p><img src=x onerror=alert(1)><iframe src="https://evil.test"></iframe><table><tr><td>1</td></tr></table><pre><code class="language-typescript">@for (x of xs; track x)</code></pre>');
  assert.doesNotMatch(html, /<script|onclick|onerror|javascript:|iframe|<img/i);
  assert.match(html, /<h2>Titre<\/h2>/);
  assert.match(html, /<a href="https:\/\/angular.dev" rel="noopener noreferrer nofollow" target="_blank">ok<\/a>/);
  assert.match(html, /<table>/);
  assert.match(html, /class="language-typescript"/);
});

test('HTML block sanitization keeps presentational markup only', () => {
  const html = sanitizeHtmlBlock('<div style="color:red;background:url(javascript:alert(1));position:fixed" onmouseover="x()"><img src="https://cdn.test/a.png" alt="A"><img src="data:image/png;base64,AAA"><form action="https://x"><input></form><svg><script>1</script></svg><object data="x"></object></div>');
  assert.match(html, /style="color:red"/);
  assert.match(html, /<img src="https:\/\/cdn.test\/a.png" alt="A" \/>/);
  assert.doesNotMatch(html, /url\(|position|onmouseover|data:|form|input|svg|script|object/i);
});

test('video embeds accept YouTube/Vimeo only and are normalized', () => {
  assert.equal(normalizeEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(normalizeEmbedUrl('https://youtu.be/dQw4w9WgXcQ'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(normalizeEmbedUrl('https://vimeo.com/123456789'), 'https://player.vimeo.com/video/123456789');
  assert.equal(normalizeEmbedUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(normalizeEmbedUrl('https://evil.test/embed/dQw4w9WgXcQ'), null);
  assert.equal(normalizeEmbedUrl('javascript:alert(1)'), null);
});

test('block schema validates sources, alt text, unique ids and sanitizes on parse', () => {
  const parsed = blocksSchema.parse([
    { id: 'a', type: 'text', html: '<p>ok</p><script>x</script>' },
    { id: 'b', type: 'code', language: 'typescript', code: 'const count = signal(0);' },
    { id: 'c', type: 'image', url: 'https://cdn.test/a.png', alt: 'Schéma' },
    { id: 'd', type: 'video', title: 'Démo', embedUrl: 'https://youtu.be/dQw4w9WgXcQ' },
    { id: 'e', type: 'divider' },
  ]);
  assert.equal(parsed[0].html, '<p>ok</p>');
  assert.equal(parsed[3].embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(blocksSchema.safeParse([{ id: 'a', type: 'image', url: 'https://cdn.test/a.png' }]).success, false, 'alt text required');
  assert.equal(blocksSchema.safeParse([{ id: 'a', type: 'image', url: 'https://cdn.test/a.png', decorative: true }]).success, true);
  assert.equal(blocksSchema.safeParse([{ id: 'a', type: 'image', url: 'http://cdn.test/a.png', alt: 'x' }]).success, false, 'https only');
  assert.equal(blocksSchema.safeParse([{ id: 'a', type: 'video', title: 'x', embedUrl: 'https://evil.test/v' }]).success, false);
  assert.equal(blocksSchema.safeParse([{ id: 'a', type: 'video', title: 'x' }]).success, false, 'a video needs a source');
  assert.equal(blocksSchema.safeParse([{ id: 'a', type: 'divider' }, { id: 'a', type: 'divider' }]).success, false, 'duplicate ids');
  assert.equal(blocksSchema.safeParse([{ id: 'a', type: 'quiz' }, { id: 'b', type: 'quiz' }]).success, false, 'single quiz block');
  assert.equal(blocksSchema.safeParse([{ id: 'a', type: 'code', language: 'php', code: '' }]).success, false);
});
