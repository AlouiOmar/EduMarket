import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { 
  Award, 
  FileCheck, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  Upload, 
  FileText,
  Printer,
  Download,
  Share2
} from 'lucide-react';
import { mockExams, mockCertificates } from '../../mocks/mockData';
import { courseService } from '../../services/courseService';
import { usesApi } from '../../services/apiClient';
import { ExamLayout } from '../../components/templates/SpecializedLayouts';
import { CertificatePreview } from '../../components/organisms/CertificatePreview';
import { Button } from '../../components/atoms/Button';
import { ConfirmationDialog } from '../../components/molecules/ConfirmationDialog';
import { Badge } from '../../components/atoms/Badge';
import { OnlineExamAttemptPage } from './OnlineExamAttemptPage';
import { ApiAssignmentsPage } from './ApiAssignmentsPage';

export const OnlineExamPage = OnlineExamAttemptPage;

export const CertificatesPage: React.FC = () => {
  const { t } = useTranslation();
  const [certificates, setCertificates] = useState(usesApi ? [] : mockCertificates);
  const [selectedCert, setSelectedCert] = useState<any>(usesApi ? null : mockCertificates[0] || null);

  useEffect(() => { if (usesApi) courseService.getCertificates().then(result => { setCertificates(result.data); setSelectedCert(result.data[0] || null); }).catch(() => { setCertificates([]); setSelectedCert(null); }); }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('certificates.myCertificates')}</h1>
        <p className="text-xs text-slate-500 mt-1">{t('examUi.certificatesSubtitle')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {certificates.map((c) => (
          <div key={c.id} className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[11px] font-mono font-bold text-indigo-600">{c.code}</span>
              {c.status === 'revoked' && <span className="ms-2 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">{t('certificateStatusUi.revokedBadge')}</span>}
              <h3 className="text-sm font-bold text-slate-900">{c.courseTitle}</h3>
              <span className="text-xs text-slate-500 block">{t('examUi.issuedOn', { date: c.issueDate, grade: c.grade })}</span>
            </div>

            <Button variant="outline" size="sm" onClick={() => setSelectedCert(c)}>
              {t('examUi.showCertificate')}
            </Button>
          </div>
        ))}
        {certificates.length === 0 && <p className="text-sm text-slate-500">{t('examUi.noCertificates')}</p>}
      </div>

      {selectedCert && (
        <div className="pt-6 border-t border-slate-200">
          <CertificatePreview certificate={selectedCert} />
        </div>
      )}
    </div>
  );
};

const MockAssignmentsPage: React.FC = () => {
  const { t } = useTranslation();
  const [submitted, setSubmitted] = useState(false);

  const assignments = [
    {
      id: 'asg_1',
      title: 'Projet d’Architecture : Création d’un Design System Atomic',
      course: 'Architectures Modernes React 19',
      dueDate: '20 Octobre 2026',
      status: 'pending',
      instructions: 'Construisez un composant DataTable avec tri et pagination en respectant la hiérarchie atomes/molécules/organismes.'
    }
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t('examUi.mockAssignmentsTitle')}</h1>
        <p className="text-xs text-slate-500 mt-1">{t('examUi.mockAssignmentsSubtitle')}</p>
      </div>

      {assignments.map(asg => (
        <div key={asg.id} className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <span className="text-xs text-indigo-600 font-semibold">{asg.course}</span>
              <h3 className="text-base font-bold text-slate-900">{asg.title}</h3>
            </div>
            <Badge variant="warning" size="sm">{t('examUi.dueBefore', { date: asg.dueDate })}</Badge>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            {asg.instructions}
          </p>

          <div className="p-4 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-center space-y-2">
            <Upload className="w-6 h-6 text-slate-400 mx-auto" />
            <span className="text-xs font-semibold text-slate-700 block">{t('examUi.dropzone')}</span>
            <Button variant="outline" size="sm" onClick={() => setSubmitted(true)}>
              {t('examUi.selectFile')}
            </Button>
          </div>

          {submitted && (
            <div className="p-3 bg-emerald-50 text-emerald-800 rounded-lg text-xs font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>{t('examUi.submitted')}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export const AssignmentsPage: React.FC = () => usesApi ? <ApiAssignmentsPage /> : <MockAssignmentsPage />;
