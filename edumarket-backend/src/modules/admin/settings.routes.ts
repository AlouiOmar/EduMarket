import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AuditEvent } from './audit.model.js';
import { PlatformSettings } from './settings.model.js';

export const adminSettingsRoutes = Router();
export const platformStatusRoutes = Router();
let maintenanceCache: { expires: number; value: boolean } | undefined;

const defaultSubscription = { enabled: false, monthlyPrice: 29, yearlyPrice: 279 };
const defaultOffline = { enabled: true, instructions: '' };
export const getSettings = async () => {
  if (mongoose.connection.readyState !== 1) return { _id: 'global', commissionRate: 20, maintenanceMode: false, subscription: defaultSubscription, offlinePayments: defaultOffline, updatedAt: null };
  const settings = await PlatformSettings.findById('global').lean();
  return settings
    ? { ...settings, subscription: { ...defaultSubscription, ...(settings.subscription || {}) }, offlinePayments: { ...defaultOffline, ...((settings as any).offlinePayments || {}) } }
    : { _id: 'global', commissionRate: 20, maintenanceMode: false, subscription: defaultSubscription, offlinePayments: defaultOffline, updatedAt: null };
};
const settingsDto = (settings: Awaited<ReturnType<typeof getSettings>>) => ({ commissionRate: settings.commissionRate, maintenanceMode: settings.maintenanceMode, subscription: settings.subscription, offlinePayments: settings.offlinePayments, updatedAt: settings.updatedAt });

export const isMaintenanceEnabled = async () => {
  if (maintenanceCache && maintenanceCache.expires > Date.now()) return maintenanceCache.value;
  const settings = await getSettings();
  maintenanceCache = { expires: Date.now() + 5_000, value: settings.maintenanceMode };
  return maintenanceCache.value;
};

export const invalidateMaintenanceCache = () => { maintenanceCache = undefined; };

adminSettingsRoutes.use(authenticate, allowRoles('admin'));
adminSettingsRoutes.get('/', async (_req, res, next) => {
  try {
    res.json({ success: true, data: settingsDto(await getSettings()) });
  } catch (error) { next(error); }
});

adminSettingsRoutes.patch('/', async (req: AuthRequest, res, next) => {
  try {
    const changes = z.object({
      commissionRate: z.number().min(0).max(50).optional(),
      maintenanceMode: z.boolean().optional(),
      subscription: z.object({ enabled: z.boolean().optional(), monthlyPrice: z.number().min(1).max(10000).optional(), yearlyPrice: z.number().min(1).max(100000).optional() }).strict().optional(),
      offlinePayments: z.object({ enabled: z.boolean().optional(), instructions: z.string().trim().max(2000).optional() }).strict().optional(),
    }).strict().refine((value) => Object.keys(value).length > 0).parse(req.body);
    const { subscription, offlinePayments, ...rest } = changes;
    const subscriptionSet = Object.fromEntries([
      ...Object.entries(subscription || {}).map(([key, value]) => [`subscription.${key}`, value]),
      ...Object.entries(offlinePayments || {}).map(([key, value]) => [`offlinePayments.${key}`, value]),
    ]);
    await PlatformSettings.findByIdAndUpdate('global', {
      $set: { ...rest, ...subscriptionSet, updatedBy: req.auth!.userId },
    }, { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true });
    const settings = await getSettings();
    invalidateMaintenanceCache();
    await AuditEvent.create({ action: 'platform.settings.updated', actorId: req.auth!.userId, targetType: 'platform_settings', targetId: 'global', severity: changes.maintenanceMode ? 'warning' : 'info', ipAddress: req.ip });
    res.json({ success: true, data: settingsDto(settings) });
  } catch (error) { next(error); }
});

platformStatusRoutes.get('/', async (_req, res, next) => {
  try { res.set('Cache-Control', 'no-store').json({ success: true, data: { maintenanceMode: await isMaintenanceEnabled() } }); }
  catch (error) { next(error); }
});

/** Public, aggregate-only figures for the home page (cached 60 s); no personal data is exposed. */
export const platformPublicRoutes = Router();
let publicStatsCache: { expires: number; value: Record<string, number> } | undefined;
platformPublicRoutes.get('/stats', async (_req, res, next) => {
  try {
    if (!publicStatsCache || publicStatsCache.expires < Date.now()) {
      const [{ Course }, { Certificate }, { User }, { Enrollment }] = await Promise.all([
        import('../courses/model.js'), import('../certificates/model.js'), import('../auth/model.js'), import('../enrollments/model.js'),
      ]);
      const [publishedCourses, certificates, verifiedTeachers, learners, completed] = await Promise.all([
        Course.countDocuments({ status: 'published', visibility: { $ne: 'restricted' } }), Certificate.countDocuments(),
        User.countDocuments({ role: 'teacher', verified: true, status: 'active' }), Enrollment.distinct('studentId').then(ids => ids.length),
        Enrollment.countDocuments({ completedAt: { $ne: null } }),
      ]);
      const enrollments = await Enrollment.estimatedDocumentCount();
      publicStatsCache = { expires: Date.now() + 60_000, value: { publishedCourses, certificates, verifiedTeachers, learners, completionRate: enrollments ? Math.round(completed / enrollments * 100) : 0 } };
    }
    res.set('Cache-Control', 'public, max-age=60').json({ success: true, data: publicStatsCache.value });
  } catch (error) { next(error); }
});
