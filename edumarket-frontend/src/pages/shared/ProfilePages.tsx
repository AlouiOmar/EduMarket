import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Lock, Globe, Bell, Shield, Smartphone, Trash2, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { Textarea } from '../../components/atoms/Textarea';
import { Avatar } from '../../components/atoms/Avatar';
import { FormField } from '../../components/molecules/FormField';
import { Switch } from '../../components/atoms/Switch';
import { ConfirmationDialog } from '../../components/molecules/ConfirmationDialog';
import { LanguageSwitcher } from '../../components/atoms/LanguageSwitcher';
import { usesApi } from '../../services/apiClient';
import { notificationPreferenceService } from '../../services/notificationPreferenceService';

export const ProfilePage: React.FC = () => {
  const { t } = useTranslation();
  const { user, updateUserProfile, changePassword } = useAuth();
  const [activeTab, setActiveTab] = useState<'profile' | 'security' | 'preferences'>('profile');

  // Profile form state
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [headline, setHeadline] = useState(user?.headline || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // Security form state
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // Preferences state
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [sessionReminders, setSessionReminders] = useState(true);
  const [forumActivity, setForumActivity] = useState(false);
  const [messageNotifications, setMessageNotifications] = useState(true);
  const [courseActivityNotifications, setCourseActivityNotifications] = useState(true);
  const [emailNotifications, setEmailNotifications] = useState(false);
  const [preferencesLoading, setPreferencesLoading] = useState(usesApi);
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const [preferencesError, setPreferencesError] = useState(false);
  const [preferencesSaved, setPreferencesSaved] = useState(false);

  useEffect(() => {
    if (!usesApi) return;
    let active = true;
    notificationPreferenceService.get().then(prefs => {
      if (active) { setSessionReminders(prefs.sessions); setMessageNotifications(prefs.messages); setCourseActivityNotifications(prefs.courseActivity); setEmailNotifications(prefs.email); }
    }).catch(() => { if (active) setPreferencesError(true); }).finally(() => { if (active) setPreferencesLoading(false); });
    return () => { active = false; };
  }, []);

  const savePreferences = async () => {
    setPreferencesError(false); setPreferencesSaved(false); setPreferencesSaving(true);
    try {
      const saved = await notificationPreferenceService.save({ sessions: sessionReminders, messages: messageNotifications, courseActivity: courseActivityNotifications, email: emailNotifications });
      setSessionReminders(saved.sessions); setMessageNotifications(saved.messages); setCourseActivityNotifications(saved.courseActivity); setEmailNotifications(saved.email); setPreferencesSaved(true);
    } catch { setPreferencesError(true); }
    finally { setPreferencesSaving(false); }
  };

  // Delete account modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(false);
    try {
      await updateUserProfile({ name, email, headline, bio, phone });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch { setSaveError(true); }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    if (newPassword !== confirmPassword) { setPasswordError('passwordMismatch'); return; }
    setSavingPassword(true);
    try {
      await changePassword(oldPassword, newPassword);
      setPasswordSaved(true); setOldPassword(''); setNewPassword(''); setConfirmPassword('');
      setTimeout(() => setPasswordSaved(false), 3000);
    } catch (cause) { setPasswordError((cause as { code?: string }).code || 'PASSWORD_CHANGE_FAILED'); }
    finally { setSavingPassword(false); }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('profileUi.title')}</h1>
        <p className="text-xs text-slate-500 mt-1">{t('profileUi.subtitle')}</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-4 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('profile')}
          className={`pb-3 border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'profile' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <User className="w-4 h-4" />
          <span>{t('profileUi.tabProfile')}</span>
        </button>
        <button
          onClick={() => setActiveTab('security')}
          className={`pb-3 border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'security' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Lock className="w-4 h-4" />
          <span>{t('profileUi.tabSecurity')}</span>
        </button>
        <button
          onClick={() => setActiveTab('preferences')}
          className={`pb-3 border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'preferences' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Bell className="w-4 h-4" />
          <span>{t('profileUi.tabPreferences')}</span>
        </button>
      </div>

      {/* Tab 1: Profile */}
      {activeTab === 'profile' && (
        <form onSubmit={handleSaveProfile} className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6">
          {savedSuccess && (
            <div className="p-3 bg-emerald-50 text-emerald-800 rounded-lg text-xs font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>{t('profileUi.saved')}</span>
            </div>
          )}
          {saveError && <div className="p-3 bg-rose-50 text-rose-700 rounded-lg text-xs" role="alert">{t('auth.apiUnavailable')}</div>}

          <div className="flex items-center gap-6 pb-6 border-b border-slate-100">
            <Avatar src={user?.avatar} alt={user?.name || t('profileUi.userFallback')} size="xl" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">{user?.name}</h3>
              <span className="text-xs text-slate-500 block mb-2">{user ? t(`common.roles.${user.role}`) : ''}</span>
              {!usesApi && <Button variant="outline" size="sm" type="button">
                {t('profileUi.changePhoto')}
              </Button>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label={t('profileUi.fullName')} required>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </FormField>
            <FormField label={t('profileUi.email')} required>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required readOnly={usesApi} />
            </FormField>
            <FormField label={t('profileUi.headline')}>
              <Input value={headline} onChange={(e) => setHeadline(e.target.value)} />
            </FormField>
            <FormField label={t('profileUi.phone')}>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </FormField>
          </div>

          <FormField label={t('profileUi.bio')}>
            <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} />
          </FormField>

          <div className="flex justify-end pt-4 border-t border-slate-100">
            <Button type="submit" variant="primary" size="md">
              {t('profileUi.saveChanges')}
            </Button>
          </div>
        </form>
      )}

      {/* Tab 2: Security */}
      {activeTab === 'security' && (
        <div className="space-y-6">
          <form onSubmit={handleSavePassword} className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-100">
              {t('profileUi.changePassword')}
            </h3>

            {passwordSaved && (
              <div className="p-3 bg-emerald-50 text-emerald-800 rounded-lg text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>{t('profileUi.passwordSaved')}</span>
              </div>
            )}
            {passwordError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{passwordError === 'passwordMismatch' ? t('auth.passwordMismatch') : passwordError === 'CURRENT_PASSWORD_INVALID' ? t('auth.currentPasswordInvalid') : t('auth.apiUnavailable')}</p>}

            <FormField label={t('profileUi.currentPassword')} required>
              <Input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} required minLength={10} maxLength={128} autoComplete="current-password" />
            </FormField>
            <FormField label={t('profileUi.newPassword')} required>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={10} maxLength={128} autoComplete="new-password" />
            </FormField>
            <FormField label={t('profileUi.confirmPassword')} required>
              <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={10} maxLength={128} autoComplete="new-password" />
            </FormField>

            <div className="flex justify-end pt-2">
              <Button type="submit" variant="primary" size="sm" isLoading={savingPassword}>
                {t('profileUi.updatePassword')}
              </Button>
            </div>
          </form>

          {/* Connected sessions */}
          {!usesApi && <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-100">
              {t('profileUi.activeSessions')}
            </h3>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <Smartphone className="w-5 h-5 text-indigo-600" />
                  <div>
                    <span className="font-bold text-slate-800 block">{t('profileUi.demoBrowser')}</span>
                    <span className="text-slate-400">{t('profileUi.demoLocation')}</span>
                  </div>
                </div>
                <span className="text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded">{t('profileUi.currentSession')}</span>
              </div>
            </div>
          </div>}

          {/* Delete account */}
          {!usesApi && <div className="p-6 border border-rose-200 bg-rose-50/40 rounded-xl flex items-center justify-between">
            <div>
              <h4 className="text-xs font-bold text-rose-900">{t('profileUi.dangerTitle')}</h4>
              <p className="text-[11px] text-rose-700 mt-0.5">{t('profileUi.dangerText')}</p>
            </div>
            <Button variant="danger" size="sm" onClick={() => setShowDeleteModal(true)} leftIcon={<Trash2 className="w-4 h-4" />}>
              {t('profileUi.deleteAccount')}
            </Button>
          </div>}
        </div>
      )}

      {/* Tab 3: Preferences */}
      {activeTab === 'preferences' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6">
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-100">
              {t('profileUi.regional')}
            </h3>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-slate-800 block">{t('profileUi.interfaceLanguage')}</span>
                <span className="text-[11px] text-slate-500">{t('profileUi.languageHint')}</span>
              </div>
              <LanguageSwitcher variant="select" />
            </div>
          </div>

          {usesApi && <div className="space-y-4 pt-4 border-t border-slate-100">
            <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-100">{t('auth.inAppNotificationPreferences')}</h3>
            {preferencesLoading && <p role="status" className="text-xs text-slate-500">{t('common.loading')}</p>}
            {preferencesError && <p role="alert" className="text-xs text-rose-700">{t('auth.apiUnavailable')}</p>}
            <div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-800">{t('auth.sessionNotifications')}</span><Switch checked={sessionReminders} onChange={setSessionReminders} disabled={preferencesLoading || preferencesSaving} /></div>
            <div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-800">{t('auth.messageNotifications')}</span><Switch checked={messageNotifications} onChange={setMessageNotifications} disabled={preferencesLoading || preferencesSaving} /></div>
            <div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-800">{t('auth.courseActivityNotifications')}</span><Switch checked={courseActivityNotifications} onChange={setCourseActivityNotifications} disabled={preferencesLoading || preferencesSaving} /></div>
            {usesApi && <div className="flex items-center justify-between gap-4"><span className="text-xs font-semibold text-slate-800">{t('platformCommon.emailNotifications')}<span className="block font-normal text-[11px] text-slate-500">{t('platformCommon.emailNotificationsHint')}</span></span><Switch checked={emailNotifications} onChange={setEmailNotifications} disabled={preferencesLoading || preferencesSaving} /></div>}
            {preferencesSaved && <p role="status" className="text-xs text-emerald-700">{t('common.success')}</p>}
            <div className="flex justify-end"><Button type="button" variant="primary" size="sm" onClick={savePreferences} isLoading={preferencesSaving} disabled={preferencesLoading}>{t('auth.savePreferences')}</Button></div>
          </div>}

          {!usesApi && <div className="space-y-4 pt-4 border-t border-slate-100">
            <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-100">
              {t('profileUi.notificationsTitle')}
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-slate-800 block">{t('profileUi.emailNotifs')}</span>
                  <span className="text-[11px] text-slate-500">{t('profileUi.emailNotifsHint')}</span>
                </div>
                <Switch checked={emailNotifs} onChange={setEmailNotifs} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-slate-800 block">{t('profileUi.sessionReminders')}</span>
                  <span className="text-[11px] text-slate-500">{t('profileUi.sessionRemindersHint')}</span>
                </div>
                <Switch checked={sessionReminders} onChange={setSessionReminders} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-slate-800 block">{t('profileUi.forumActivity')}</span>
                  <span className="text-[11px] text-slate-500">{t('profileUi.forumActivityHint')}</span>
                </div>
                <Switch checked={forumActivity} onChange={setForumActivity} />
              </div>
            </div>
          </div>}
        </div>
      )}

      {/* Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showDeleteModal}
        title={t('profileUi.deleteTitle')}
        description={t('profileUi.deleteDescription')}
        confirmLabel={t('profileUi.deleteConfirm')}
        isDangerous
        onConfirm={() => {
          setShowDeleteModal(false);
          alert('Compte supprimé (simulé en mode démo)');
        }}
        onCancel={() => setShowDeleteModal(false)}
      />
    </div>
  );
};
