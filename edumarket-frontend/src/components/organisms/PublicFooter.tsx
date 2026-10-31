import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GraduationCap } from 'lucide-react';
import { LanguageSwitcher } from '../atoms/LanguageSwitcher';

export const PublicFooter: React.FC = () => {
  const { t } = useTranslation();

  return (
    <footer className="bg-slate-900 text-slate-400 border-t border-slate-800 text-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          
          <div className="md:col-span-1">
            <Link to="/" className="flex items-center gap-2.5 text-white font-extrabold text-xl tracking-tight mb-4">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
                <GraduationCap className="w-5 h-5" />
              </div>
              <span>EduMarket</span>
            </Link>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              {t('chromeUi.footerTagline')}
            </p>
            <LanguageSwitcher variant="minimal" />
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-white mb-4">
              {t('chromeUi.footerLearning')}
            </h4>
            <ul className="space-y-2.5 text-xs">
              <li>
                <Link to="/courses" className="hover:text-white transition-colors">
                  {t('nav.courses')}
                </Link>
              </li>
              <li>
                <Link to="/certifications" className="hover:text-white transition-colors">
                  {t('nav.certifications')}
                </Link>
              </li>
              <li>
                <Link to="/learning-paths" className="hover:text-white transition-colors">
                  {t('nav.learningPaths')}
                </Link>
              </li>
              <li>
                <Link to="/institutions" className="hover:text-white transition-colors">
                  {t('nav.institutions')}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-white mb-4">
              {t('chromeUi.footerCommunity')}
            </h4>
            <ul className="space-y-2.5 text-xs">
              <li>
                <Link to="/for-teachers" className="hover:text-white transition-colors">
                  {t('nav.forTeachers')}
                </Link>
              </li>
              <li>
                <Link to="/for-institutions" className="hover:text-white transition-colors">
                  {t('nav.forInstitutions')}
                </Link>
              </li>
              <li>
                <Link to="/sessions" className="hover:text-white transition-colors">
                  {t('nav.sessions')}
                </Link>
              </li>
              <li>
                <Link to="/forum" className="hover:text-white transition-colors">
                  {t('nav.forum')}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-white mb-4">
              {t('chromeUi.footerLegal')}
            </h4>
            <ul className="space-y-2.5 text-xs">
              <li>
                <Link to="/about" className="hover:text-white transition-colors">
                  {t('nav.about')}
                </Link>
              </li>
              <li>
                <Link to="/contact" className="hover:text-white transition-colors">
                  {t('nav.contact')}
                </Link>
              </li>
              <li>
                <Link to="/faq" className="hover:text-white transition-colors">
                  {t('nav.faq')}
                </Link>
              </li>
              <li>
                <Link to="/terms" className="hover:text-white transition-colors">
                  {t('chromeUi.terms')}
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="hover:text-white transition-colors">
                  {t('chromeUi.privacy')}
                </Link>
              </li>
            </ul>
          </div>

        </div>

        <div className="mt-12 pt-8 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-4">
          <span>&copy; {new Date().getFullYear()} EduMarket LMS. Tous droits réservés.</span>
          <span className="font-mono text-[11px] text-slate-400">
            {t('common.demoModeNotice')}
          </span>
        </div>
      </div>
    </footer>
  );
};
