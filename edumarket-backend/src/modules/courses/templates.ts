import crypto from 'node:crypto';
import { contentSnapshot, workingCopy } from './publication.js';
import type { OutlineContainer, OutlineItem } from './structure.js';

/**
 * Course templates and their independent class instances (e.g. "Angular" → Classe A, Classe B, Classe C).
 *
 * An instance keeps a link to its template: for every item copied, the content hash of the template item and of the instance
 * item at the time of the copy (or of the last synchronization). Comparing each side with its own stored hash tells whether the
 * template changed since, whether the class adapted the item locally, or both (conflict). Nothing is ever applied automatically.
 */
export interface TemplateLinkItem { templateItemId: string; instanceItemId: string; templateContainerId: string; instanceContainerId: string; templateHash: string; instanceHash: string }
export interface TemplateLink { templateId: string; syncedAt: string | Date; items: TemplateLinkItem[] }
export type DiffStatus = 'unchanged' | 'template_changed' | 'locally_modified' | 'conflict' | 'added_in_template' | 'removed_in_template' | 'removed_locally';

const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value as object).sort().map(key => [key, stable((value as Record<string, unknown>)[key])])) : value;

/** Hash of what an author sees (working copy). Block ids are excluded: copies get fresh ids for the same content. */
export function contentHash(item: OutlineItem) {
  const snapshot = contentSnapshot(workingCopy(item)) as Record<string, unknown>;
  const blocks = Array.isArray(snapshot.blocks) ? snapshot.blocks.map((block: any) => { const { id: _id, asset: _asset, captionsUrl: _captions, ...rest } = block; return rest; }) : snapshot.blocks;
  const quiz = snapshot.quiz && typeof snapshot.quiz === 'object' ? { ...(snapshot.quiz as object), id: undefined } : snapshot.quiz;
  return crypto.createHash('sha256').update(JSON.stringify(stable({ ...snapshot, blocks, quiz }))).digest('hex');
}

/** Link built right after a whole-course copy: containers and items keep their order, so they pair by position. */
export function linkByPosition(template: OutlineContainer[], instance: OutlineContainer[]): TemplateLinkItem[] {
  return template.flatMap((container, containerIndex) => container.lessons.flatMap((item, itemIndex) => {
    const copy = instance[containerIndex]?.lessons[itemIndex];
    return copy ? [{ templateItemId: item.id, instanceItemId: copy.id, templateContainerId: container.id, instanceContainerId: instance[containerIndex].id, templateHash: contentHash(item), instanceHash: contentHash(copy) }] : [];
  }));
}

export interface DiffRow { status: DiffStatus; templateItemId?: string; instanceItemId?: string; title: string; templateContainerTitle?: string; instanceTitle?: string }

export function diffTemplate(template: OutlineContainer[], instance: OutlineContainer[], link: TemplateLink): DiffRow[] {
  const templateItems = new Map(template.flatMap(container => container.lessons.map(item => [item.id, { item, container }] as const)));
  const instanceItems = new Map(instance.flatMap(container => container.lessons.map(item => [item.id, item] as const)));
  const linked = new Set(link.items.map(entry => entry.templateItemId));
  const rows: DiffRow[] = link.items.map(entry => {
    const source = templateItems.get(entry.templateItemId), local = instanceItems.get(entry.instanceItemId);
    if (!source) return { status: 'removed_in_template', templateItemId: entry.templateItemId, instanceItemId: entry.instanceItemId, title: local?.title || '', instanceTitle: local?.title };
    if (!local) return { status: 'removed_locally', templateItemId: entry.templateItemId, title: source.item.title, templateContainerTitle: source.container.title };
    const templateChanged = contentHash(source.item) !== entry.templateHash;
    const localChanged = contentHash(local) !== entry.instanceHash;
    const status: DiffStatus = templateChanged && localChanged ? 'conflict' : templateChanged ? 'template_changed' : localChanged ? 'locally_modified' : 'unchanged';
    return { status, templateItemId: entry.templateItemId, instanceItemId: entry.instanceItemId, title: source.item.title, templateContainerTitle: source.container.title, instanceTitle: local.title };
  });
  for (const [id, { item, container }] of templateItems) if (!linked.has(id)) rows.push({ status: 'added_in_template', templateItemId: id, title: item.title, templateContainerTitle: container.title });
  return rows;
}
