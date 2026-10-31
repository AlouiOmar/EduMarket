import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { 
  ShieldAlert, 
  Search, 
  ServerCrash, 
  WifiOff, 
  Clock, 
  Wrench, 
  RotateCcw,
  CheckCircle2
} from 'lucide-react';
import { Button } from '../../components/atoms/Button';

export const NotFoundPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center space-y-4">
      <div className="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
        <Search className="w-8 h-8" />
      </div>
      <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">{t('errors.pageNotFound')}</h1>
      <p className="text-xs sm:text-sm text-slate-600 max-w-md">{t('errors.pageNotFoundDesc')}</p>
      <Link to="/">
        <Button variant="primary" size="md">
          {t('errors.backToHome')}
        </Button>
      </Link>
    </div>
  );
};

export const ForbiddenPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center space-y-4">
      <div className="w-16 h-16 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center">
        <ShieldAlert className="w-8 h-8" />
      </div>
      <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">{t('errors.accessDenied')}</h1>
      <p className="text-xs sm:text-sm text-slate-600 max-w-md">{t('errors.accessDeniedDesc')}</p>
      <Link to="/">
        <Button variant="primary" size="md">
          {t('errors.backToHome')}
        </Button>
      </Link>
    </div>
  );
};

export const ServerErrorPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center space-y-4">
      <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
        <ServerCrash className="w-8 h-8" />
      </div>
      <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">{t('errors.serverError')}</h1>
      <p className="text-xs sm:text-sm text-slate-600 max-w-md">{t('errors.serverErrorDesc')}</p>
      <Link to="/">
        <Button variant="primary" size="md">
          {t('errors.backToHome')}
        </Button>
      </Link>
    </div>
  );
};

export const MaintenancePage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center space-y-4 bg-slate-900 text-white">
      <div className="w-16 h-16 rounded-2xl bg-indigo-900 text-indigo-400 flex items-center justify-center">
        <Wrench className="w-8 h-8" />
      </div>
      <h1 className="text-2xl sm:text-3xl font-extrabold">{t('errors.maintenanceTitle')}</h1>
      <p className="text-xs sm:text-sm text-slate-400 max-w-md">
        {t('errors.maintenanceDescription')}
      </p>
      <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
        {t('errors.refresh')}
      </Button>
    </div>
  );
};

export const NetworkOfflinePage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center space-y-4">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center">
        <WifiOff className="w-8 h-8" />
      </div>
      <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('sharedUi.offlineTitle')}</h1>
      <p className="text-xs text-slate-600 max-w-md">{t('sharedUi.offlineText')}</p>
      <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
        {t('sharedUi.reload')}
      </Button>
    </div>
  );
};
