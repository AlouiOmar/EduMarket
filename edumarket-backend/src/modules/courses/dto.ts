import { studentOutline, type OutlineContainer } from './structure.js';
import { publicationStatus } from './publication.js';

const assetUrl = (courseId: unknown, assetId: unknown) => `/courses/${courseId}/assets/${assetId}`;
const coverImage = (course: any) => course.banner?.assetId ? `/courses/${course._id}/banner` : '';

/** Attaches url/name/size of the referenced course assets to blocks (missing files resolve to `asset: null`). */
const resolveBlocks = (course: any, blocks: unknown, assets: any[]) => Array.isArray(blocks) ? blocks.map((block: any) => {
  if (!block?.assetId) return block;
  const asset = assets.find(candidate => String(candidate._id) === block.assetId);
  const captions = block.captionsAssetId ? assets.find(candidate => String(candidate._id) === block.captionsAssetId) : undefined;
  return {
    ...block,
    asset: asset ? { url: assetUrl(course._id, asset._id), name: asset.originalName, size: asset.size, mimeType: asset.mimeType } : null,
    ...(captions ? { captionsUrl: assetUrl(course._id, captions._id) } : {}),
  };
}) : [];

/** Catalogue view: published outline only (titles and durations), no content. */
export const toPublicCourse = (course: any) => ({
  ...course,
  coverImage: coverImage(course),
  chapters: studentOutline(course.chapters || []).map(chapter => ({
    id: chapter.id, title: chapter.title, order: chapter.order, kind: chapter.kind || 'module', description: chapter.description || '',
    lessons: chapter.lessons.map((lesson: any) => ({
      id: lesson.id, title: lesson.title, chapterId: lesson.chapterId, durationMinutes: lesson.durationMinutes,
      type: lesson.type, commentsCount: lesson.commentsCount,
    })),
  })),
});

/** Manager view: full outline with every asset resolved. */
export const withCourseAssets = (course: any, assets: any[] = []) => ({
  ...course,
  coverImage: coverImage(course),
  bannerUrl: course.banner?.assetId ? assetUrl(course._id, course.banner.assetId) : '',
  chapters: (course.chapters as OutlineContainer[]).map((chapter: any) => ({
    ...chapter,
    kind: chapter.kind || 'module',
    visibility: chapter.visibility === 'hidden' ? 'hidden' : 'visible',
    thumbnailUrl: chapter.thumbnail?.assetId && assets.some(asset => String(asset._id) === chapter.thumbnail.assetId) ? assetUrl(course._id, chapter.thumbnail.assetId) : '',
    lessons: chapter.lessons.map((lesson: any) => {
      if (lesson.locked) return lesson;
      const lessonAssets = assets.filter(asset => asset.lessonId && asset.lessonId === lesson.id);
      const video = lessonAssets.find(asset => asset.kind === 'video');
      const uploadedResources = lessonAssets.filter(asset => asset.kind === 'resource').map(asset => ({
        id: String(asset._id), title: asset.originalName, type: asset.mimeType === 'application/pdf' ? 'pdf' : 'zip', size: `${(asset.size / (1024 * 1024)).toFixed(1)} MB`,
        url: assetUrl(course._id, asset._id),
      }));
      const resources = (lesson.resources || []).map((resource: any) => ({
        id: String(resource.id || ''), title: String(resource.title || ''), type: resource.type, size: resource.size,
        url: String(resource.url || ''),
      }));
      return {
        ...lesson, visibility: lesson.visibility === 'hidden' ? 'hidden' : 'visible', revision: lesson.revision || 0,
        videoUrl: video ? assetUrl(course._id, video._id) : lesson.videoUrl, resources: [...resources, ...uploadedResources],
        blocks: resolveBlocks(course, lesson.blocks, assets),
        publicationStatus: publicationStatus(lesson),
        ...(lesson.draft ? { draft: { ...lesson.draft, blocks: resolveBlocks(course, lesson.draft.blocks, assets) } } : {}),
      };
    }),
  })),
});

/**
 * Learner view: only available containers/items (see studentOutline), locked items reduced to their title, answer keys removed.
 * `completedIds` drives sequential modules; without it every sequential module is locked after its first item.
 */
export const toStudentCourse = (course: any, assets: any[] = [], completedIds: Iterable<string> = []) => {
  const visible = { ...course, chapters: studentOutline(course.chapters || [], { completedIds }) };
  const resolved = withCourseAssets(visible, assets);
  return {
    ...resolved,
    structureVersion: undefined,
    chapters: resolved.chapters.map((chapter: any) => ({
      ...chapter,
      lessons: chapter.lessons.map((lesson: any) => ({
        ...lesson,
        availableFrom: undefined, availableUntil: undefined, revision: undefined,
        // Drafts, planned publications and authoring metadata never reach learners.
        draft: undefined, scheduledPublishAt: undefined, publishedBy: undefined, publicationStatus: undefined,
        quiz: lesson.quiz ? {
          ...lesson.quiz,
          questions: lesson.quiz.questions?.map((question: any) => ({
            id: question.id, question: question.question, options: question.options,
          })),
        } : undefined,
      })),
    })),
  };
};
