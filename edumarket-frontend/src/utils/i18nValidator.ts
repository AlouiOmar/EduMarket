import { translations } from '../i18n/resources';

const { fr, en, ar } = translations;

export interface I18nValidationReport {
  isValid: boolean;
  totalKeysFR: number;
  totalKeysEN: number;
  totalKeysAR: number;
  missingInEN: string[];
  missingInAR: string[];
}

function extractKeys(obj: Record<string, any>, prefix = ''): string[] {
  let keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const currentKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys = keys.concat(extractKeys(value, currentKey));
    } else {
      keys.push(currentKey);
    }
  }
  return keys;
}

export function validateI18nParity(): I18nValidationReport {
  const frKeys = new Set(extractKeys(fr));
  const enKeys = new Set(extractKeys(en));
  const arKeys = new Set(extractKeys(ar));

  const missingInEN = Array.from(frKeys).filter(k => !enKeys.has(k));
  const missingInAR = Array.from(frKeys).filter(k => !arKeys.has(k));

  return {
    isValid: missingInEN.length === 0 && missingInAR.length === 0,
    totalKeysFR: frKeys.size,
    totalKeysEN: enKeys.size,
    totalKeysAR: arKeys.size,
    missingInEN,
    missingInAR,
  };
}
