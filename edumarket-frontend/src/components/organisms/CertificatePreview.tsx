import React from 'react';
import { useTranslation } from 'react-i18next';
import { Award, Download, Printer, Share2, CheckCircle2, ShieldCheck, QrCode } from 'lucide-react';
import { Certificate } from '../../types';
import { Button } from '../atoms/Button';

export const CertificatePreview: React.FC<{
  certificate: Certificate;
}> = ({ certificate }) => {
  const { t } = useTranslation();

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-white border border-slate-200 rounded-xl">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
          <span className="text-xs font-semibold text-slate-700">
            {t('certificates.verifiedAuthentic')}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint} leftIcon={<Printer className="w-4 h-4" />}>
            {t('common.print')}
          </Button>
          <Button variant="primary" size="sm" onClick={handlePrint} leftIcon={<Download className="w-4 h-4" />}>
            {t('certificates.downloadPdf')}
          </Button>
        </div>
      </div>

      {/* High-Fidelity Printable Certificate Canvas */}
      <div className="bg-white border-8 border-double border-slate-800 p-8 sm:p-14 rounded-2xl shadow-xl max-w-4xl mx-auto text-center relative overflow-hidden print:border-none print:shadow-none">
        
        {/* Subtle Guilloche Watermark Icon */}
        <div className="absolute inset-0 flex items-center justify-center opacity-4 pointer-events-none">
          <Award className="w-96 h-96 text-slate-900" />
        </div>

        {/* Institution / Platform Header */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-9 h-9 rounded-lg bg-indigo-900 text-white flex items-center justify-center">
            <Award className="w-5 h-5" />
          </div>
          <span className="text-sm font-extrabold tracking-widest uppercase text-indigo-950 font-serif">
            {certificate.institutionName || 'EduMarket Academic Consortium'}
          </span>
        </div>

        <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 font-serif mb-2 tracking-tight">
          {t('certificates.certificateTitle')}
        </h2>

        <p className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-8">
          {t('certificates.awardedTo')}
        </p>

        {/* Student Name */}
        <div className="text-3xl sm:text-5xl font-bold text-indigo-950 font-serif italic mb-6 border-b-2 border-indigo-200 inline-block px-8 pb-2">
          {certificate.userName}
        </div>

        <p className="text-sm text-slate-600 max-w-xl mx-auto leading-relaxed mb-4">
          {t('certificates.forCompleting')}
        </p>

        {/* Course Title */}
        <h3 className="text-lg sm:text-2xl font-bold text-slate-900 mb-6 font-serif">
          « {certificate.courseTitle} »
        </h3>

        <div className="inline-block bg-slate-50 border border-slate-200 px-4 py-1.5 rounded-full text-xs font-semibold text-slate-700 mb-10">
          Résultat académique : {certificate.grade}
        </div>

        {/* Signatures & Verification Seal */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 items-end pt-8 border-t border-slate-200">
          <div className="text-start">
            <div className="font-serif italic text-lg text-slate-800 font-bold mb-1">
              {certificate.instructorName}
            </div>
            <span className="text-[11px] text-slate-500 uppercase tracking-wider block">
              {t('chromeUi.instructorRole')}
            </span>
          </div>

          {/* Central Seal */}
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-full border-4 border-amber-500 bg-amber-50 flex items-center justify-center text-amber-700 shadow-xs mb-2">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-800">
              {t('chromeUi.officialSeal')}
            </span>
          </div>

          <div className="text-end">
            <div className="font-mono text-xs font-bold text-slate-800 mb-1 tabular-nums">
              {certificate.code}
            </div>
            <span className="text-[11px] text-slate-500 uppercase tracking-wider block">
              Délivré le {certificate.issueDate}
            </span>
          </div>
        </div>

      </div>
    </div>
  );
};
