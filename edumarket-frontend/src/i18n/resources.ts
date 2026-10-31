import { fr } from './locales/fr';
import { en } from './locales/en';
import { ar } from './locales/ar';
import { platformFr } from './locales/platform.fr';
import { platformEn } from './locales/platform.en';
import { platformAr } from './locales/platform.ar';
import { uiFr } from './locales/ui.fr';
import { uiEn } from './locales/ui.en';
import { uiAr } from './locales/ui.ar';
import { contentFr, contentFrExtensions } from './locales/content.fr';
import { contentEn, contentEnExtensions } from './locales/content.en';
import { contentAr, contentArExtensions } from './locales/content.ar';
import { lmsFr, lmsFrExtensions } from './locales/lms.fr';
import { lmsEn, lmsEnExtensions } from './locales/lms.en';
import { lmsAr, lmsArExtensions } from './locales/lms.ar';
import { calendarFr, calendarFrExtensions } from './locales/calendar.fr';
import { calendarEn, calendarEnExtensions } from './locales/calendar.en';
import { calendarAr, calendarArExtensions } from './locales/calendar.ar';
import { teacherApplicationFr, teacherApplicationFrExtensions } from './locales/teacherApplication.fr';
import { teacherApplicationEn, teacherApplicationEnExtensions } from './locales/teacherApplication.en';
import { teacherApplicationAr, teacherApplicationArExtensions } from './locales/teacherApplication.ar';

type Extensions = { apiErrors: object; calendarKinds: object; notificationTemplates: object };
/** Adds the course-content keys that belong to namespaces defined elsewhere (API errors, calendar kinds, notification templates). */
const withContent = <T extends { apiErrors: object; calendar: { kinds: object }; notificationTemplates: object }>(tree: T, content: object, extensions: Extensions) => ({
  ...tree, ...content,
  apiErrors: { ...tree.apiErrors, ...extensions.apiErrors },
  calendar: { ...tree.calendar, kinds: { ...tree.calendar.kinds, ...extensions.calendarKinds } },
  notificationTemplates: { ...tree.notificationTemplates, ...extensions.notificationTemplates },
});

/** Final translation trees: historical UI locales plus the platform workflow namespaces. */
export const translations = {
  fr: withContent(withContent(withContent(withContent({ ...fr, ...platformFr, ...uiFr }, contentFr, contentFrExtensions), lmsFr, lmsFrExtensions), calendarFr, calendarFrExtensions), teacherApplicationFr, teacherApplicationFrExtensions),
  en: withContent(withContent(withContent(withContent({ ...en, ...platformEn, ...uiEn }, contentEn, contentEnExtensions), lmsEn, lmsEnExtensions), calendarEn, calendarEnExtensions), teacherApplicationEn, teacherApplicationEnExtensions),
  ar: withContent(withContent(withContent(withContent({ ...ar, ...platformAr, ...uiAr }, contentAr, contentArExtensions), lmsAr, lmsArExtensions), calendarAr, calendarArExtensions), teacherApplicationAr, teacherApplicationArExtensions),
};
