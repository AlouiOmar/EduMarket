import { validateI18nParity } from '../src/utils/i18nValidator';

// Fails when an English or Arabic key is missing compared with French (the reference locale).
const report = validateI18nParity();
console.log(`FR ${report.totalKeysFR} keys, EN ${report.totalKeysEN}, AR ${report.totalKeysAR}`);
if (!report.isValid) {
  console.error('Missing in EN:', report.missingInEN);
  console.error('Missing in AR:', report.missingInAR);
  process.exit(1);
}
