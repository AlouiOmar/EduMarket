/**
 * Course outline migration (idempotent, non-destructive).
 *
 * The application already treats missing fields as their legacy meaning (no visibility = visible, array index = position), so
 * this migration is optional. It makes the data explicit: renumbers `order` from the array position, aligns each item's
 * `chapterId` with its container, sets `kind: 'module'`, `visibility: 'visible'` and `revision: 0` where missing, and
 * initialises `structureVersion`. Nothing is deleted and no visible content becomes hidden.
 *
 * Usage: MONGODB_URI=mongodb://... node scripts/migrate-course-outline.mjs           (dry run: reports what would change)
 *        MONGODB_URI=mongodb://... node scripts/migrate-course-outline.mjs --apply   (writes)
 */
import mongoose from 'mongoose';
import 'dotenv/config';

const apply = process.argv.includes('--apply');
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('Set MONGODB_URI.');

await mongoose.connect(uri);
const courses = mongoose.connection.collection('courses');
let scanned = 0, changed = 0;
for await (const course of courses.find({}, { projection: { chapters: 1, structureVersion: 1 } })) {
  scanned += 1;
  const chapters = (course.chapters || []).map((chapter, index) => ({
    ...chapter, order: index, kind: chapter.kind || 'module', visibility: chapter.visibility || 'visible',
    lessons: (chapter.lessons || []).map((lesson, lessonIndex) => ({
      ...lesson, chapterId: chapter.id, order: lessonIndex, visibility: lesson.visibility || 'visible', revision: lesson.revision ?? 0,
    })),
  }));
  const needsUpdate = course.structureVersion === undefined || JSON.stringify(chapters) !== JSON.stringify(course.chapters || []);
  if (!needsUpdate) continue;
  changed += 1;
  // Guarded by the version read above: a course edited meanwhile is skipped and picked up by the next run.
  if (apply) await courses.updateOne({ _id: course._id, structureVersion: course.structureVersion ?? { $exists: false } }, { $set: { chapters, structureVersion: course.structureVersion ?? 0 } });
}
console.log(`${scanned} course(s) scanned, ${changed} ${apply ? 'updated' : 'would be updated (dry run, pass --apply to write)'}.`);
await mongoose.disconnect();
