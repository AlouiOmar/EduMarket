import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { 
  Lock, 
  Mail, 
  User, 
  Phone, 
  Building2, 
  CheckCircle2, 
  AlertTriangle, 
  ArrowRight,
  ShieldAlert,
  KeyRound,
  RotateCw
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { PasswordInput } from '../../components/atoms/PasswordInput';
import { Textarea } from '../../components/atoms/Textarea';
import { FormField } from '../../components/molecules/FormField';
import { Select } from '../../components/atoms/Select';
import { Switch } from '../../components/atoms/Switch';
import { UserRole } from '../../types';
import { usesApi } from '../../services/apiClient';
import { accountRecoveryService } from '../../services/accountRecoveryService';

const roleHome = (role: UserRole) => ({
  student: '/student/dashboard', teacher: '/teacher/dashboard', unverified_teacher: '/teacher/application',
  institution: '/institution/dashboard', admin: '/admin/dashboard', moderator: '/moderator/dashboard', visitor: '/',
}[role]);

const authErrorKey = (error: unknown) => {
  const code = (error as { code?: string })?.code;
  if (code === 'INVALID_CREDENTIALS') return 'auth.invalidCredentials';
  if (code === 'EMAIL_IN_USE') return 'auth.emailInUse';
  if (code === 'EMAIL_NOT_VERIFIED') return 'auth.emailNotVerified';
  if (code === 'EMAIL_VERIFICATION_TOKEN_INVALID' || code === 'PASSWORD_RESET_TOKEN_INVALID') return 'auth.invalidActionLink';
  if (code === 'VALIDATION_ERROR') return 'auth.invalidInput';
  return 'auth.apiUnavailable';
};

export const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const { login, signIn } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState(usesApi ? '' : 'karim.benali@student.edu');
  const [password, setPassword] = useState(usesApi ? '' : 'demo123456');
  const [role, setRole] = useState<UserRole>('student');
  const [error, setError] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError(t('authUi.requiredFields'));
      return;
    }
    setSubmitting(true);
    setError('');
    setNeedsVerification(false);
    try {
      if (usesApi) {
        const user = await signIn(email, password);
        const returnTo = (location.state as { from?: unknown } | null)?.from;
        const safeReturnTo = typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : roleHome(user.role);
        navigate(safeReturnTo, { replace: true });
      } else {
        login(role);
        navigate(roleHome(role), { replace: true });
      }
    } catch (err) {
      setNeedsVerification((err as { code?: string })?.code === 'EMAIL_NOT_VERIFIED');
      setError(t(authErrorKey(err)));
    }
    finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-1">
        <h1 className="text-xl font-bold text-slate-900">{t('auth.loginTitle')}</h1>
        <p className="text-xs text-slate-500">{t('auth.loginSubtitle')}</p>
      </div>

      {location.search.includes('registered=1') && <div className="p-3 bg-emerald-50 text-emerald-800 text-xs rounded-lg" role="status">{t('auth.registrationComplete')}</div>}

      {error && (
        <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-lg font-medium">
          {error} {needsVerification && <Link className="underline" to={`/auth/verify-email?email=${encodeURIComponent(email)}`}>{t('auth.verifyEmailTitle')}</Link>}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label={t('auth.email')} required>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            leftIcon={<Mail className="w-4 h-4" />}
            required
          />
        </FormField>

        <FormField label={t('auth.password')} required>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </FormField>

        {/* Demo Fast Role Switch */}
        {!usesApi && (
        <FormField label={t('authUi.demoProfile')}>
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            options={[
              { value: 'student', label: t('authUi.demoRoles.student') },
              { value: 'teacher', label: t('authUi.demoRoles.teacher') },
              { value: 'unverified_teacher', label: t('authUi.demoRoles.unverified_teacher') },
              { value: 'institution', label: t('authUi.demoRoles.institution') },
              { value: 'admin', label: t('authUi.demoRoles.admin') },
              { value: 'moderator', label: t('authUi.demoRoles.moderator') },
            ]}
          />
        </FormField>
        )}

        <div className="flex items-center justify-between text-xs">
          {!usesApi && <label className="flex items-center gap-2 cursor-pointer text-slate-600">
            <input type="checkbox" className="rounded border-slate-300 text-indigo-600" defaultChecked />
            <span>{t('auth.rememberMe')}</span>
          </label>}
          <Link to="/auth/forgot-password" className="text-indigo-600 hover:underline">{t('auth.forgotPassword')}</Link>
        </div>

        <Button type="submit" variant="primary" size="md" className="w-full" disabled={submitting}>
          {t('nav.login')}
        </Button>
      </form>

      <div className="text-center text-xs text-slate-500 pt-2 border-t border-slate-100">
        <span>{t('auth.dontHaveAccount')} </span>
        <Link to="/auth/register" className="font-semibold text-indigo-600 hover:underline">
          {t('nav.register')}
        </Link>
      </div>
    </div>
  );
};

export const RegisterPage: React.FC = () => {
  const { t } = useTranslation();
  const { login, signUp } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [accountType, setAccountType] = useState<UserRole>(location.pathname.endsWith('institution-request') ? 'institution' : 'student');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) { setError(t('auth.passwordMismatch')); return; }
    if (usesApi && accountType !== 'student') { setError(t('auth.registrationRoleUnavailable')); return; }
    setSubmitting(true);
    try {
      if (usesApi) {
        const result = await signUp(name, email, password);
        navigate(`/auth/verify-email?email=${encodeURIComponent(email)}`, { replace: true, state: { email, previewUrl: result.previewUrl } });
      } else {
        login(accountType);
        navigate(`/auth/onboarding?role=${accountType}`);
      }
    } catch (err) { setError(t(authErrorKey(err))); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-1">
        <h1 className="text-xl font-bold text-slate-900">{t('auth.registerTitle')}</h1>
        <p className="text-xs text-slate-500">{t('auth.registerSubtitle')}</p>
      </div>

      {error && <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-lg font-medium" role="alert">{error}</div>}

      {/* Role Picker segmented */}
      {!usesApi && <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl text-xs font-semibold">
        <button
          type="button"
          onClick={() => setAccountType('student')}
          className={`py-2 rounded-lg transition-colors ${accountType === 'student' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600'}`}
        >
          {t('authUi.accountStudent')}
        </button>
        <button
          type="button"
          onClick={() => setAccountType('teacher')}
          className={`py-2 rounded-lg transition-colors ${accountType === 'teacher' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600'}`}
        >
          {t('authUi.accountTeacher')}
        </button>
        <button
          type="button"
          onClick={() => setAccountType('institution')}
          className={`py-2 rounded-lg transition-colors ${accountType === 'institution' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600'}`}
        >
          {t('authUi.accountInstitution')}
        </button>
      </div>}

      <form onSubmit={handleRegister} className="space-y-4">
        <FormField label={t('auth.name')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder={t('authUi.namePlaceholder')} />
        </FormField>
        <FormField label={t('auth.email')} required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder={t('authUi.emailPlaceholder')} />
        </FormField>
        <FormField label={t('auth.password')} required>
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} required minLength={usesApi ? 10 : undefined} />
        </FormField>
        <FormField label={t('auth.confirmPassword')} required>
          <PasswordInput value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
        </FormField>

        <p className="text-[11px] text-slate-500 leading-normal">
          {t('auth.termsAgreement')}
        </p>

        <Button type="submit" variant="primary" size="md" className="w-full" disabled={submitting}>
          Créer mon compte ({t(`common.roles.${accountType}`)})
        </Button>
      </form>

      {usesApi && <p className="rounded-lg bg-indigo-50 p-3 text-center text-xs text-indigo-900">{t('teacherApplication.registerTeaser')} <Link to="/auth/register/teacher" className="font-semibold underline">{t('teacherApplication.registerTeaserLink')}</Link></p>}

      <div className="text-center text-xs text-slate-500 pt-2 border-t border-slate-100">
        <span>{t('auth.alreadyHaveAccount')} </span>
        <Link to="/auth/login" className="font-semibold text-indigo-600 hover:underline">
          {t('nav.login')}
        </Link>
      </div>
    </div>
  );
};

export const ForgotPasswordPage: React.FC = () => {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setSubmitting(true);
    try {
      const result = await accountRecoveryService.requestPasswordReset(email);
      setPreviewUrl(result.previewUrl || ''); setSent(true);
    } catch (cause) { setError(t(authErrorKey(cause))); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-1">
        <h1 className="text-xl font-bold text-slate-900">{t('auth.forgotPasswordTitle')}</h1>
        <p className="text-xs text-slate-500">{t('auth.forgotPasswordDesc')}</p>
      </div>

      {sent ? (
        <div className="p-4 bg-emerald-50 text-emerald-800 text-xs rounded-xl space-y-3">
          <p className="font-semibold">{usesApi ? t('auth.resetRequested') : t('auth.recoveryDemoNotice')}</p>
          {previewUrl && <a className="underline break-all" href={previewUrl}>{t('auth.openDevelopmentLink')}</a>}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
          <FormField label={t('auth.email')} required>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder={t('authUi.emailPlaceholder')} />
          </FormField>
          <Button type="submit" variant="primary" size="md" className="w-full" isLoading={submitting}>
            {t('auth.sendResetLink')}
          </Button>
        </form>
      )}

      <div className="text-center text-xs text-slate-500">
        <Link to="/auth/login" className="text-indigo-600 hover:underline">
          &larr; Retour à la connexion
        </Link>
      </div>
    </div>
  );
};

export const ResetPasswordPage: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const tokenFromUrl = new URLSearchParams(location.hash.slice(1)).get('token') || new URLSearchParams(location.search).get('token') || '';
  const [token, setToken] = useState(tokenFromUrl);
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { if (tokenFromUrl) navigate('/auth/reset-password', { replace: true }); }, [tokenFromUrl, navigate]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    if (pass !== confirm) { setError(t('auth.passwordMismatch')); return; }
    setSubmitting(true);
    try {
      if (usesApi) await accountRecoveryService.resetPassword(token, pass);
      setDone(true);
    } catch (cause) { setError(t(authErrorKey(cause))); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-1">
        <h1 className="text-xl font-bold text-slate-900">{t('auth.resetPasswordTitle')}</h1>
        <p className="text-xs text-slate-500">{t('auth.resetPasswordDesc')}</p>
      </div>

      {done ? (
        <div className="p-4 bg-emerald-50 text-emerald-800 text-xs rounded-xl space-y-3 text-center">
          <p className="font-bold">{t('auth.resetSuccess')}</p>
          <Link to="/auth/login">
            <Button variant="primary" size="sm">{t('authUi.loginNow')}</Button>
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
          {usesApi && !token && <FormField label={t('auth.resetToken')} required><Input value={token} onChange={event => setToken(event.target.value)} required autoComplete="one-time-code" /></FormField>}
          <FormField label={t('auth.newPassword')} required>
            <PasswordInput value={pass} onChange={(e) => setPass(e.target.value)} required minLength={usesApi ? 10 : undefined} />
          </FormField>
          <FormField label={t('auth.confirmPassword')} required>
            <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={usesApi ? 10 : undefined} />
          </FormField>
          <Button type="submit" variant="primary" size="md" className="w-full" isLoading={submitting}>
            {t('auth.submitReset')}
          </Button>
        </form>
      )}
    </div>
  );
};

export const VerifyEmailPage: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = location.state as { email?: string; previewUrl?: string } | null;
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || new URLSearchParams(location.search).get('token') || '';
  const [email, setEmail] = useState(() => routeState?.email || new URLSearchParams(location.search).get('email') || '');
  const [previewUrl, setPreviewUrl] = useState(routeState?.previewUrl || '');
  const [status, setStatus] = useState(token ? 'pending' : '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!usesApi || !token) return;
    accountRecoveryService.verifyEmail(token).then(() => {
      setStatus('verified');
      navigate('/auth/verify-email?verified=1', { replace: true });
    })
      .catch(cause => { setStatus(''); setError(t(authErrorKey(cause))); });
  }, [token, navigate]);

  const resend = async () => {
    setError(''); setSubmitting(true);
    try {
      if (usesApi) {
        const result = await accountRecoveryService.resendVerification(email);
        setPreviewUrl(result.previewUrl || ''); setStatus('sent');
      } else setStatus('sent');
    } catch (cause) { setError(t(authErrorKey(cause))); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="text-center space-y-6">
      <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
        <Mail className="w-6 h-6" />
      </div>
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t('auth.verifyEmailTitle')}</h1>
        <p className="text-xs text-slate-500 mt-2 max-w-sm mx-auto">{t('auth.verifyEmailDesc')}</p>
      </div>

      {status === 'pending' && <p role="status" className="text-xs text-slate-500">{t('auth.verificationPending')}</p>}
      {status === 'verified' && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">{t('auth.verificationSuccess')}</p>}
      {status === 'sent' && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">{t('auth.verificationSent')}</p>}
      {status === 'verified' && <Link to="/auth/login"><Button variant="primary" size="sm">{t('nav.login')}</Button></Link>}
      {previewUrl && <a className="block break-all text-xs text-indigo-700 underline" href={previewUrl}>{t('auth.openDevelopmentLink')}</a>}
      {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}

      <div className="flex flex-col gap-3">
        {usesApi && !token && <FormField label={t('auth.email')} required><Input type="email" value={email} onChange={event => setEmail(event.target.value)} required /></FormField>}
        {!token && <Button variant="primary" size="md" onClick={resend} isLoading={submitting} disabled={usesApi && !email} leftIcon={<RotateCw className="w-4 h-4" />}>
          {t('auth.resendVerification')}
        </Button>}
        {!usesApi && <Link to="/auth/otp">
          <Button variant="outline" size="sm" className="w-full">
            {t('authUi.otpLink')}
          </Button>
        </Link>}
      </div>
    </div>
  );
};

export const OtpVerificationPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    navigate('/student/dashboard');
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-1">
        <h1 className="text-xl font-bold text-slate-900">{t('auth.otpVerificationTitle')}</h1>
        <p className="text-xs text-slate-500">{t('auth.otpVerificationDesc')}</p>
      </div>

      <form onSubmit={handleVerify} className="space-y-4">
        <FormField label={t('authUi.otpLabel')} required>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            className="text-center font-mono text-lg tracking-widest"
            maxLength={6}
            required
          />
        </FormField>
        <Button type="submit" variant="primary" size="md" className="w-full">
          {t('auth.verifyCode')}
        </Button>
      </form>
    </div>
  );
};

export const OnboardingPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { role, user, updateUserProfile } = useAuth();
  const { i18n } = useTranslation();
  const [goals, setGoals] = useState(usesApi ? user?.bio || '' : t('authUi.defaultGoals'));
  const [saving, setSaving] = useState(false);

  const handleFinish = async (e: React.FormEvent) => {
    e.preventDefault();
    // In API mode the stated goals become the profile biography.
    if (usesApi && goals.trim() && goals.trim() !== (user?.bio || '')) {
      setSaving(true);
      try { await updateUserProfile({ bio: goals.trim() }); } catch { /* the profile page can be edited later */ }
      finally { setSaving(false); }
    }
    if (role === 'teacher') navigate('/teacher/dashboard');
    else if (role === 'institution') navigate('/institution/dashboard');
    else navigate('/student/dashboard');
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-1">
        <h1 className="text-xl font-bold text-slate-900">{t('auth.onboardingTitle')}</h1>
        <p className="text-xs text-slate-500">{t('authUi.onboardingSubtitle')}</p>
      </div>

      <form onSubmit={handleFinish} className="space-y-4">
        <FormField label={role === 'teacher' ? t('auth.onboardingTeacherBio') : t('auth.onboardingStudentBio')}>
          <Textarea value={goals} onChange={(e) => setGoals(e.target.value)} rows={3} maxLength={2000} />
        </FormField>

        <FormField label={t('authUi.preferredLanguage')}>
          <Select
            value={i18n.language.slice(0, 2)}
            onChange={(e) => void i18n.changeLanguage(e.target.value)}
            options={[
              { value: 'fr', label: 'Français' },
              { value: 'en', label: 'English' },
              { value: 'ar', label: 'العربية' },
            ]}
          />
        </FormField>

        <Button type="submit" variant="primary" size="md" className="w-full" isLoading={saving}>
          {t('authUi.goToDashboard')}
        </Button>
      </form>
    </div>
  );
};

export const AccountStatusPage: React.FC<{ type: 'suspended' | 'pending' }> = ({ type }) => {
  const { t } = useTranslation();

  return (
    <div className="text-center space-y-6">
      <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto ${type === 'suspended' ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'}`}>
        {type === 'suspended' ? <ShieldAlert className="w-7 h-7" /> : <AlertTriangle className="w-7 h-7" />}
      </div>
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          {type === 'suspended' ? t('auth.accountSuspendedTitle') : t('auth.accountPendingTitle')}
        </h1>
        <p className="text-xs text-slate-600 mt-2 max-w-sm mx-auto leading-relaxed">
          {type === 'suspended' ? t('auth.accountSuspendedDesc') : t('auth.accountPendingDesc')}
        </p>
      </div>
      {type === 'pending' && usesApi && <Link to="/teacher/application" className="block text-sm font-semibold text-indigo-700 underline">{t('teacherApplication.followApplication')}</Link>}
      <Link to="/contact">
        <Button variant="outline" size="sm">
          {t('authUi.contactSupport')}
        </Button>
      </Link>
    </div>
  );
};
