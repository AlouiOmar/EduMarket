import { blockAssetIds } from './blocks.js';
import { contentSnapshot } from './publication.js';
import type { OutlineContainer } from './structure.js';

/**
 * Where a course file is used. A file is "unused" only when no current content, pending draft, archived version, thumbnail,
 * banner, assignment attachment or legacy lesson media refers to it. Unused files can be quarantined, and only quarantined files
 * that are still unused after the delay are deleted (see files.routes.ts).
 */
export type ReferenceKind = 'published' | 'draft' | 'version' | 'thumbnail' | 'banner' | 'assignment' | 'lesson_media';
export interface FileReference { kind: ReferenceKind; label: string }

export function fileReferences(input: {
  chapters: OutlineContainer[]; bannerAssetId?: string;
  versions: Array<{ itemId: string; version: number; title: string; snapshot: unknown }>;
  assignments: Array<{ title: string; attachments?: Array<{ assetId?: string }> }>;
  lessonAssets: Array<{ _id: unknown; lessonId?: string }>;
}) {
  const references = new Map<string, FileReference[]>();
  const add = (assetId: string | undefined, reference: FileReference) => { if (assetId) references.set(assetId, [...(references.get(assetId) || []), reference]); };
  const itemTitles = new Map<string, string>();
  for (const container of input.chapters) {
    add(container.thumbnail?.assetId, { kind: 'thumbnail', label: container.title });
    for (const item of container.lessons) {
      itemTitles.set(item.id, String(item.title || ''));
      for (const id of blockAssetIds(item.blocks)) add(id, { kind: 'published', label: String(item.title || '') });
      if (item.draft) for (const id of blockAssetIds(contentSnapshot(item.draft as Record<string, unknown>).blocks)) add(id, { kind: 'draft', label: String(item.title || '') });
    }
  }
  add(input.bannerAssetId, { kind: 'banner', label: '' });
  for (const version of input.versions) for (const id of blockAssetIds((version.snapshot as { blocks?: unknown })?.blocks)) add(id, { kind: 'version', label: `${version.title} (v${version.version})` });
  for (const assignment of input.assignments) for (const file of assignment.attachments || []) add(file.assetId, { kind: 'assignment', label: assignment.title });
  for (const asset of input.lessonAssets) if (asset.lessonId && itemTitles.has(asset.lessonId)) add(String(asset._id), { kind: 'lesson_media', label: itemTitles.get(asset.lessonId)! });
  return references;
}
