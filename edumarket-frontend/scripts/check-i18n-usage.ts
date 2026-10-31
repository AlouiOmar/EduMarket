import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { translations } from '../src/i18n/resources';

/**
 * Fails when a static `t('namespace.key')` call in src/ references a key missing from the French resources.
 * Dynamic keys (template literals) are skipped; plural forms resolve through `_one`/`_other` suffixes.
 */
const french = translations.fr as unknown as Record<string, unknown>;
const has = (key: string) => {
  const lookup = (candidate: string) => candidate.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), french) !== undefined;
  return lookup(key) || lookup(`${key}_one`) || lookup(`${key}_other`);
};
const files: string[] = [];
const walk = (dir: string) => readdirSync(dir).forEach(name => {
  const full = path.join(dir, name);
  if (statSync(full).isDirectory()) { if (name !== 'i18n' && name !== 'mocks') walk(full); }
  else if (/\.(tsx?|jsx?)$/.test(name)) files.push(full);
});
walk(path.resolve('src'));
const missing: string[] = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\bt\(\s*'([a-zA-Z][\w-]*(?:\.[\w-]+)+)'/g)) {
    if (!has(match[1])) missing.push(`${path.relative(process.cwd(), file)}: ${match[1]}`);
  }
}
console.log(`${files.length} files scanned, ${missing.length} missing keys`);
if (missing.length) { console.error(missing.join('\n')); process.exit(1); }
