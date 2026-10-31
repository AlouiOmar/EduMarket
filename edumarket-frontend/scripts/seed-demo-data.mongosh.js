/*
 * EduMarket LMS: realistic demo data for every collection (MongoDB Compass > mongosh, or `mongosh <uri> scripts/seed-demo-data.mongosh.js`).
 *
 * - Every document created here carries `_seed: "edumarket-demo"`; running the script again first deletes those documents
 *   (and only those), so it can be replayed safely. Existing data is never modified, except:
 *   categories (inserted only when the slug is missing), platformsettings (created only when absent) and the invoice counter
 *   (raised so new real invoices never collide with seeded invoice numbers).
 * - All demo accounts share the password below and use the @demo.edumarket.tn domain.
 * - Course videos/resource files, assignment files and message attachments are not created: they need real files in
 *   PRIVATE_UPLOAD_DIR. Lessons use text content and public sample video URLs instead.
 */

const DB_NAME = 'edumarket';          // database used by MONGODB_URI in backend/.env
const DEMO_PASSWORD = 'Demo-EduMarket-2026';
const PASSWORD_HASH = '$2a$10$ACSJdhOGc8EAUnbiG4owp.Z9rh2FxhEJOyiwPyNW3Frspwuumxxd6'; // bcrypt(DEMO_PASSWORD, 10)
const MARK = 'edumarket-demo';
const COMMISSION = 20;               // % applied to seeded orders (snapshot, like real checkouts)
const HOLD_DAYS = 7;

const database = db.getSiblingDB(DB_NAME);
const now = new Date();
const DAY = 86400000;
const daysAgo = (days, hours = 10) => new Date(now.getTime() - days * DAY + (hours - 10) * 3600000);
const daysAhead = (days, hours = 10) => daysAgo(-days, hours);

// Deterministic pseudo-random generator: the same data is produced on every run.
let rngState = 20261017;
const rand = () => { rngState |= 0; rngState = (rngState + 0x6D2B79F5) | 0; let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pick = list => list[Math.floor(rand() * list.length)];
const sample = (list, count) => { const copy = [...list]; const out = []; while (copy.length && out.length < count) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]); return out; };
const hex = length => Array.from({ length }, () => Math.floor(rand() * 16).toString(16)).join('');
const base64url = length => Array.from({ length }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[Math.floor(rand() * 64)]).join('');
const slugify = value => value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const cents = euros => Math.round(euros * 100);
// The original object keeps its _id so later references (reports, audit) point to the inserted document.
const seed = doc => { if (!doc._id) doc._id = new ObjectId(); return { ...doc, _seed: MARK }; };
const stamp = (date, extra = {}) => ({ createdAt: date, updatedAt: extra.updatedAt || date });

// Collections in which seeded documents are created (mongoose default names).
const COLLECTIONS = ['users', 'institutionprofiles', 'institutioninvitations', 'courses', 'coursereviews', 'enrollments', 'lessonactivities', 'quizattempts',
  'certificates', 'exams', 'examregistrations', 'examattempts', 'inpersonexamresults', 'tutoringsessions', 'sessionreviews', 'conversations', 'messages',
  'notifications', 'forumposts', 'forumreplies', 'forumvotes', 'forumreports', 'assignments', 'assignmentsubmissions', 'orders', 'paymentevents',
  'ledgerentries', 'payoutrequests', 'subscriptions', 'subscriptionperiods', 'supporttickets', 'contentreports', 'lessonquestions', 'learningpaths',
  'auditevents', 'classgroups', 'categories'];

print(`\n== EduMarket demo seed on "${DB_NAME}" ==`);
for (const name of COLLECTIONS) {
  const removed = database.getCollection(name).deleteMany({ _seed: MARK }).deletedCount;
  if (removed) print(`  cleaned ${name}: ${removed}`);
}
const existingDemo = database.users.countDocuments({ email: /@demo\.edumarket\.tn$/ });
if (existingDemo) throw new Error(`${existingDemo} @demo.edumarket.tn accounts exist without the seed marker: remove them before running the script.`);

const inserted = {};
const insert = (collection, docs) => {
  if (!docs.length) return;
  database.getCollection(collection).insertMany(docs.map(seed), { ordered: true });
  inserted[collection] = (inserted[collection] || 0) + docs.length;
};

// ---------------------------------------------------------------- platform settings & categories
if (!database.platformsettings.findOne({ _id: 'global' })) {
  database.platformsettings.insertOne({ _id: 'global', commissionRate: COMMISSION, maintenanceMode: false, subscription: { enabled: true, monthlyPrice: 29, yearlyPrice: 279 }, updatedBy: null, createdAt: now, updatedAt: now });
  print('  platformsettings created (commission 20 %, subscriptions enabled)');
}
const CATEGORIES = [
  ['developpement-web', 'Développement Web', 'Web Development', 'تطوير الويب'],
  ['data-ia', 'Data & Intelligence Artificielle', 'Data & Artificial Intelligence', 'البيانات والذكاء الاصطناعي'],
  ['cybersecurite', 'Cybersécurité', 'Cybersecurity', 'الأمن السيبراني'],
  ['design-ux', 'Design & UX', 'Design & UX', 'التصميم وتجربة المستخدم'],
  ['marketing-digital', 'Marketing Digital', 'Digital Marketing', 'التسويق الرقمي'],
  ['langues', 'Langues', 'Languages', 'اللغات'],
  ['gestion-projet', 'Gestion de projet', 'Project Management', 'إدارة المشاريع'],
  ['mathematiques', 'Mathématiques & Sciences', 'Mathematics & Science', 'الرياضيات والعلوم'],
];
CATEGORIES.forEach(([slug, fr, en, ar], order) => {
  const result = database.categories.updateOne({ slug }, { $setOnInsert: { slug, names: { fr, en, ar }, active: true, order, _seed: MARK, createdAt: now, updatedAt: now } }, { upsert: true });
  if (result.upsertedCount) inserted.categories = (inserted.categories || 0) + 1;
});

// ---------------------------------------------------------------- users
const preferences = (email = false) => ({ sessions: true, messages: true, courseActivity: true, email });
const user = (name, localPart, role, extra = {}) => ({
  _id: new ObjectId(), name, email: `${localPart}@demo.edumarket.tn`, passwordHash: PASSWORD_HASH, role, verified: false, emailVerified: true,
  status: 'active', headline: '', bio: '', phone: `+216 ${int(20, 99)} ${int(100, 999)} ${int(100, 999)}`, favoriteCourseIds: [], authVersion: 0,
  institutionRevenueShare: 0, institutionRole: 'teacher', notificationPreferences: preferences(), ...stamp(daysAgo(int(120, 400))), ...extra,
});

const admin = user('Hichem Ben Amor', 'admin', 'admin', { headline: 'Administrateur de la plateforme', ...stamp(daysAgo(420)) });
const moderators = [
  user('Rania Khelifi', 'rania.khelifi', 'moderator', { headline: 'Modératrice contenus et forum' }),
  user('Sami Dridi', 'sami.dridi', 'moderator', { headline: 'Modérateur catalogue' }),
];

const TEACHERS = [
  ['Sarah Mansour', 'Docteure en génie logiciel, architecte front-end', 'Développement web moderne (React, Node.js)', 'developpement-web'],
  ['Karim Haddad', 'Ingénieur data senior, ex-Vermeg', 'Data engineering et Python', 'data-ia'],
  ['Leila Ben Salah', 'Consultante cybersécurité certifiée OSCP', 'Sécurité offensive et réseaux', 'cybersecurite'],
  ['Youssef Trabelsi', 'Chercheur en apprentissage automatique', 'Machine learning et deep learning', 'data-ia'],
  ['Amira Jaziri', 'Designer UX/UI, 10 ans en agence', 'Design produit et accessibilité', 'design-ux'],
  ['Mehdi Gharbi', 'Growth marketer et formateur Google Ads', 'Marketing digital et acquisition', 'marketing-digital'],
  ['Nadia Bouaziz', 'Professeure agrégée d\'anglais', 'Anglais professionnel et certification', 'langues'],
  ['Omar Chebbi', 'Chef de projet PMP, coach agile', 'Gestion de projet agile', 'gestion-projet'],
  ['Ines Mejri', 'Enseignante de mathématiques', 'Mathématiques pour l\'ingénieur', 'mathematiques'],
  ['Walid Sassi', 'Développeur mobile freelance', 'Développement mobile Flutter', 'developpement-web'],
];
const teachers = TEACHERS.map(([name, headline, specialty], index) => {
  const status = index === 8 ? 'pending' : index === 9 ? 'rejected' : 'approved';
  const submittedAt = daysAgo(index === 8 ? 3 : int(150, 380));
  return user(name, slugify(name).replace('-', '.'), status === 'approved' ? 'teacher' : 'unverified_teacher', {
    verified: status === 'approved', headline,
    bio: `${headline}. J'accompagne les apprenants avec des projets concrets et un suivi personnalisé en ${specialty.toLowerCase()}.`,
    notificationPreferences: preferences(index % 3 === 0),
    teacherVerification: {
      specialty, registrationNumber: `TN-ENS-${int(10000, 99999)}`, status, submittedAt,
      credentialsSummary: `${headline}. Diplômes et références professionnelles fournis, ${int(5, 15)} ans d'expérience pédagogique.`,
      reviewNote: status === 'rejected' ? 'Justificatifs illisibles : merci de déposer un diplôme scanné en PDF.' : '',
      ...(status === 'pending' ? {} : { reviewedAt: new Date(submittedAt.getTime() + 2 * DAY), reviewedBy: admin._id }), documents: [],
    },
  });
});
const approvedTeachers = teachers.slice(0, 8);

const INSTITUTIONS = [
  ['Institut Supérieur du Numérique de Tunis', 'isn.tunis', 'Tunisie', 'Tunis', 'https://isn-tunis.example.tn', 'approved'],
  ['Académie Carthage Data & IA', 'carthage.data', 'Tunisie', 'Ariana', 'https://carthage-data.example.tn', 'approved'],
  ['École Atlas de Design', 'atlas.design', 'Maroc', 'Casablanca', 'https://atlas-design.example.ma', 'pending'],
];
const institutionUsers = INSTITUTIONS.map(([name, local, , , , status]) => user(name, local, status === 'approved' ? 'institution' : 'student', { verified: status === 'approved', headline: name }));
const [instA, instB] = institutionUsers;

const FIRST = ['Ahmed', 'Mariem', 'Aziz', 'Yasmine', 'Fares', 'Sirine', 'Bilel', 'Eya', 'Hamza', 'Nour', 'Skander', 'Molka', 'Rayen', 'Chaima', 'Anis', 'Asma', 'Malek', 'Rim', 'Achraf', 'Salma', 'Khalil', 'Dorra', 'Iyed', 'Ons', 'Wassim', 'Hela', 'Adam', 'Lina', 'Firas', 'Emna', 'Lucas', 'Camille', 'Thomas', 'Léa', 'Mohamed', 'Fatma', 'Ali', 'Zeineb', 'Oussama', 'Meriem'];
const LAST = ['Ben Ali', 'Trabelsi', 'Gharbi', 'Hammami', 'Ayari', 'Jebali', 'Mrad', 'Zouari', 'Kammoun', 'Abidi', 'Bouzid', 'Masmoudi', 'Ferchichi', 'Chaouch', 'Rezgui', 'Martin', 'Bernard', 'Dubois', 'Sellami', 'Karoui'];
const students = FIRST.map((first, index) => {
  const last = LAST[index % LAST.length];
  return user(`${first} ${last}`, `${slugify(first)}.${slugify(last).replace(/-/g, '')}${index}`, 'student', {
    headline: pick(['Étudiant en informatique', 'Développeur junior', 'En reconversion professionnelle', 'Étudiante en master data', 'Chef de produit', 'Ingénieure réseau', 'Freelance', '']),
    notificationPreferences: preferences(index % 5 === 0),
    ...(index === 37 ? { status: 'suspended' } : {}),
  });
});
// Affiliations: teachers 0 and 1 with institution A (15 %, Karim coordinator), teacher 3 with institution B (20 %, examiner).
Object.assign(teachers[0], { institutionId: instA._id, institutionRevenueShare: 15, institutionRole: 'teacher' });
Object.assign(teachers[1], { institutionId: instA._id, institutionRevenueShare: 15, institutionRole: 'coordinator' });
Object.assign(teachers[3], { institutionId: instB._id, institutionRevenueShare: 20, institutionRole: 'examiner' });
insert('users', [admin, ...moderators, ...teachers, ...institutionUsers, ...students]);

insert('institutionprofiles', INSTITUTIONS.map(([name, local, country, city, website, status], index) => ({
  ownerId: institutionUsers[index]._id, name, slug: slugify(name), country, city, website, contactEmail: `contact@${local.replace('.', '-')}.demo.edumarket.tn`,
  description: `${name} forme chaque année des centaines d'apprenants aux métiers du numérique, avec des programmes certifiants conçus avec des entreprises partenaires.`,
  logo: '', banner: '', status, reviewNote: '', ...(status === 'approved' ? { reviewedBy: admin._id, reviewedAt: daysAgo(200 - index * 20) } : {}),
  ...stamp(daysAgo(210 - index * 20)),
})));
insert('institutioninvitations', [
  { institutionId: instA._id, teacherId: teachers[0]._id, status: 'accepted', revenueSharePercent: 15, respondedAt: daysAgo(170), ...stamp(daysAgo(172)) },
  { institutionId: instA._id, teacherId: teachers[1]._id, status: 'accepted', revenueSharePercent: 15, respondedAt: daysAgo(160), ...stamp(daysAgo(161)) },
  { institutionId: instB._id, teacherId: teachers[3]._id, status: 'accepted', revenueSharePercent: 20, respondedAt: daysAgo(140), ...stamp(daysAgo(142)) },
  { institutionId: instA._id, teacherId: teachers[5]._id, status: 'pending', revenueSharePercent: 10, ...stamp(daysAgo(2)) },
  { institutionId: instB._id, teacherId: teachers[2]._id, status: 'rejected', revenueSharePercent: 25, respondedAt: daysAgo(60), ...stamp(daysAgo(61)) },
  { institutionId: instB._id, teacherId: teachers[4]._id, status: 'ended', revenueSharePercent: 10, respondedAt: daysAgo(120), endedAt: daysAgo(30), ...stamp(daysAgo(121)) },
]);

// ---------------------------------------------------------------- courses
const SAMPLE_VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
const COURSES = [
  // title, category, level, price €, teacher index, status, tags, lesson titles (6), quiz [question, options, correct]
  ['React 19 et Node.js : applications web en production', 'developpement-web', 'intermediate', 49, 0, 'published', ['react', 'nodejs', 'typescript'], ['Architecture d\'une application full-stack', 'Composants et hooks React 19', 'Gestion d\'état et formulaires', 'API REST avec Express', 'Authentification par cookie sécurisé', 'Déploiement et monitoring'], ['Quel hook gère un état local dans un composant ?', ['useState', 'useRoute', 'useFetch'], 0]],
  ['HTML, CSS et JavaScript pour débutants', 'developpement-web', 'beginner', 0, 0, 'published', ['html', 'css', 'javascript'], ['Structure d\'une page HTML', 'Mise en forme avec CSS', 'Flexbox et Grid', 'Variables et fonctions JavaScript', 'Manipuler le DOM', 'Projet : page portfolio'], ['Quelle balise contient le contenu visible d\'une page ?', ['<body>', '<head>', '<meta>'], 0]],
  ['TypeScript avancé pour les équipes', 'developpement-web', 'advanced', 59, 0, 'published', ['typescript', 'architecture'], ['Types génériques', 'Types conditionnels et mapped types', 'Modélisation du domaine', 'Validation à l\'exécution avec Zod', 'Organisation d\'un monorepo', 'Revue de code typée'], ['Quel mot-clé restreint un type générique ?', ['extends', 'implements', 'typeof'], 0]],
  ['Python pour l\'analyse de données', 'data-ia', 'beginner', 39, 1, 'published', ['python', 'pandas', 'data'], ['Environnement Python et notebooks', 'Listes, dictionnaires et fonctions', 'Pandas : DataFrame et séries', 'Nettoyage des données', 'Visualisation avec Matplotlib', 'Projet : ventes d\'une enseigne'], ['Quelle bibliothèque manipule des DataFrame ?', ['pandas', 'flask', 'pytest'], 0]],
  ['Data engineering avec SQL et Airflow', 'data-ia', 'intermediate', 69, 1, 'published', ['sql', 'airflow', 'etl'], ['Modélisation en étoile', 'SQL analytique et fenêtres', 'Pipelines ETL', 'Orchestration avec Airflow', 'Qualité des données', 'Projet : entrepôt de données'], ['Que signifie ETL ?', ['Extract, Transform, Load', 'Edit, Test, Launch', 'Encode, Transfer, Log'], 0]],
  ['Introduction à la cybersécurité', 'cybersecurite', 'beginner', 0, 2, 'published', ['securite', 'reseaux'], ['Panorama des menaces', 'Mots de passe et authentification', 'Réseaux et pare-feu', 'Phishing et ingénierie sociale', 'Sauvegardes et chiffrement', 'Plan de réponse à incident'], ['Quel facteur renforce le plus une connexion ?', ['L\'authentification multifacteur', 'Un mot de passe court', 'Le Wi-Fi public'], 0]],
  ['Pentest web : OWASP Top 10 en pratique', 'cybersecurite', 'advanced', 79, 2, 'published', ['owasp', 'pentest', 'web'], ['Méthodologie de test d\'intrusion', 'Injections SQL', 'XSS et CSP', 'Contrôle d\'accès défaillant', 'SSRF et désérialisation', 'Rédiger un rapport d\'audit'], ['Quelle protection limite les XSS ?', ['Content-Security-Policy', 'CORS *', 'HTTP/1.0'], 0]],
  ['Machine learning de A à Z', 'data-ia', 'intermediate', 89, 3, 'published', ['machine-learning', 'scikit-learn'], ['Problèmes supervisés et non supervisés', 'Régression linéaire et logistique', 'Arbres et forêts aléatoires', 'Validation croisée', 'Feature engineering', 'Projet : prédiction du churn'], ['Que mesure la validation croisée ?', ['La capacité de généralisation', 'La vitesse du CPU', 'La taille du dataset'], 0]],
  ['Deep learning et vision par ordinateur', 'data-ia', 'advanced', 99, 3, 'published', ['deep-learning', 'pytorch', 'vision'], ['Réseaux de neurones', 'Rétropropagation', 'CNN pour la vision', 'Transfer learning', 'Augmentation de données', 'Déployer un modèle'], ['Quel type de réseau est adapté aux images ?', ['CNN', 'RNN uniquement', 'Arbre de décision'], 0]],
  ['Design UX : de la recherche au prototype', 'design-ux', 'beginner', 45, 4, 'published', ['ux', 'figma', 'prototypage'], ['Comprendre les utilisateurs', 'Personas et parcours', 'Architecture de l\'information', 'Wireframes', 'Prototypes interactifs dans Figma', 'Tests utilisateurs'], ['Quel livrable décrit un utilisateur type ?', ['Un persona', 'Un backlog', 'Un sprint'], 0]],
  ['Accessibilité numérique (RGAA / WCAG)', 'design-ux', 'intermediate', 35, 4, 'published', ['accessibilite', 'wcag'], ['Principes POUR', 'Contrastes et typographie', 'Navigation au clavier', 'ARIA à bon escient', 'Formulaires accessibles', 'Audit d\'une page'], ['Quel ratio de contraste minimal pour un texte normal (AA) ?', ['4.5:1', '2:1', '10:1'], 0]],
  ['Marketing digital et acquisition', 'marketing-digital', 'beginner', 29, 5, 'published', ['seo', 'ads', 'acquisition'], ['Stratégie digitale', 'SEO : bases du référencement', 'Google Ads', 'Réseaux sociaux', 'Emailing', 'Mesurer avec GA4'], ['Que signifie SEO ?', ['Search Engine Optimization', 'Social Engagement Online', 'Sales Email Operation'], 0]],
  ['Anglais professionnel : réussir le TOEIC', 'langues', 'intermediate', 25, 6, 'published', ['anglais', 'toeic'], ['Structure du TOEIC', 'Compréhension orale', 'Grammaire essentielle', 'Vocabulaire business', 'Lecture rapide', 'Examen blanc commenté'], ['"Deadline" signifie :', ['Date limite', 'Ligne morte', 'Réunion'], 0]],
  ['Gestion de projet agile avec Scrum', 'gestion-projet', 'beginner', 0, 7, 'published', ['scrum', 'agile'], ['Pourquoi l\'agilité ?', 'Rôles Scrum', 'Événements Scrum', 'Backlog et user stories', 'Estimation et vélocité', 'Rétrospectives efficaces'], ['Qui priorise le backlog produit ?', ['Le Product Owner', 'Le Scrum Master', 'Le client final uniquement'], 0]],
  ['Préparer la certification PMP', 'gestion-projet', 'advanced', 119, 7, 'published', ['pmp', 'management'], ['Cadre PMBOK', 'Gestion des parties prenantes', 'Planification et chemin critique', 'Gestion des risques', 'Approches hybrides', 'Stratégie d\'examen'], ['Le chemin critique correspond à :', ['La séquence la plus longue', 'La tâche la moins chère', 'Le premier livrable'], 0]],
  ['Next.js et le rendu serveur', 'developpement-web', 'intermediate', 55, 0, 'pending_review', ['nextjs', 'react'], ['Routage App Router', 'Server Components', 'Data fetching', 'Cache et revalidation', 'Authentification', 'Déploiement'], ['Où s\'exécute un Server Component ?', ['Sur le serveur', 'Dans le navigateur', 'Dans le CDN uniquement'], 0]],
  ['Power BI pour les managers', 'data-ia', 'beginner', 39, 1, 'draft', ['powerbi', 'dashboard'], ['Importer des données', 'Modèle de données', 'Mesures DAX', 'Visualisations', 'Tableaux de bord', 'Partage'], ['DAX sert à :', ['Écrire des mesures', 'Créer des comptes', 'Héberger des fichiers'], 0]],
  ['Growth hacking pour startups', 'marketing-digital', 'intermediate', 49, 5, 'rejected', ['growth', 'startup'], ['Funnel AARRR', 'Expérimentations', 'Viralité', 'Rétention', 'Automatisation', 'Études de cas'], ['AARRR commence par :', ['Acquisition', 'Analyse', 'Achat'], 0]],
  ['Crypto-trading rapide et garanti', 'marketing-digital', 'beginner', 15, 5, 'suspended', ['crypto'], ['Introduction', 'Plateformes', 'Stratégies', 'Risques', 'Fiscalité', 'Conclusion'], ['Un investissement sans risque existe-t-il ?', ['Non', 'Oui', 'Seulement le week-end'], 0]],
  ['Algèbre linéaire pour la data science', 'mathematiques', 'intermediate', 0, 3, 'published', ['maths', 'algebre'], ['Vecteurs et espaces', 'Matrices et opérations', 'Déterminants', 'Valeurs propres', 'Décomposition SVD', 'Applications en ML'], ['Une matrice inversible a un déterminant :', ['Non nul', 'Nul', 'Négatif'], 0]],
];
const REVIEW_NOTES = { rejected: 'Le module 3 reprend des contenus protégés sans autorisation. Merci de les remplacer avant une nouvelle soumission.', suspended: 'Promesses de gains garanties : contenu contraire aux règles de la plateforme.' };
const courses = COURSES.map(([title, category, level, price, teacherIndex, status, tags, lessonTitles, quiz], courseIndex) => {
  const _id = new ObjectId();
  const created = daysAgo(int(90, 360));
  const chapters = [0, 1].map(chapterIndex => {
    const chapterId = `chap_${courseIndex}_${chapterIndex}`;
    return {
      id: chapterId, title: chapterIndex === 0 ? 'Fondamentaux' : 'Mise en pratique', order: chapterIndex,
      lessons: lessonTitles.slice(chapterIndex * 3, chapterIndex * 3 + 3).map((lessonTitle, position) => {
        const lessonId = `les_${courseIndex}_${chapterIndex}_${position}`;
        const isVideo = position === 0;
        const lesson = {
          id: lessonId, title: lessonTitle, chapterId, durationMinutes: int(8, 35), type: isVideo ? 'video' : 'text', resources: [], commentsCount: 0,
          ...(isVideo ? { videoUrl: SAMPLE_VIDEO } : { textContent: `${lessonTitle}\n\nDans cette leçon, nous étudions « ${lessonTitle.toLowerCase()} » à travers un exemple concret, puis vous réalisez un exercice guidé. Points clés :\n- les notions essentielles et le vocabulaire ;\n- les erreurs fréquentes et comment les éviter ;\n- un mini-projet pour ancrer les acquis.` }),
        };
        if (position === 2) lesson.quiz = {
          id: `quiz_${courseIndex}_${chapterIndex}`, title: `Quiz : ${chapterIndex === 0 ? 'fondamentaux' : 'pratique'}`, durationMinutes: 10, passPercentage: 70,
          questions: [
            { id: 'q1', question: quiz[0], options: quiz[1], correctOptionIndex: quiz[2], explanation: `La bonne réponse est « ${quiz[1][quiz[2]]} ».` },
            { id: 'q2', question: `Cette leçon portait principalement sur :`, options: [lessonTitle, 'La comptabilité générale', 'La photographie argentique'], correctOptionIndex: 0, explanation: 'Revoir le titre de la leçon.' },
          ],
        };
        return lesson;
      }),
    };
  });
  return {
    _id, title, slug: slugify(title), subtitle: `${lessonTitles[0]}, ${lessonTitles[2].toLowerCase()} et ${lessonTitles[5].toLowerCase()}`,
    description: `Une formation complète et progressive : ${lessonTitles.map(item => item.toLowerCase()).join(', ')}. Chaque chapitre se termine par un quiz noté et un exercice pratique corrigé.`,
    category, level, price, rating: 0, ratingCount: 0, studentsCount: 0, tags, chapters,
    hasCertification: price > 0 || courseIndex % 2 === 0, certificationPathway: courseIndex === 7 ? 'both' : 'learning_and_quiz',
    prerequisites: level === 'beginner' ? ['Aucun prérequis'] : ['Bases de ' + tags[0], 'Un ordinateur avec accès à Internet'],
    learningOutcomes: lessonTitles.slice(1, 5).map(item => `Maîtriser : ${item.toLowerCase()}`),
    teacherId: teachers[teacherIndex]._id, coOwnerIds: courseIndex === 0 ? [teachers[1]._id] : [], status,
    review: status === 'draft' ? { note: '' } : {
      submittedAt: new Date(created.getTime() + 2 * DAY), note: REVIEW_NOTES[status] || '',
      ...(status === 'pending_review' ? {} : { reviewedAt: new Date(created.getTime() + 4 * DAY), reviewedBy: moderators[courseIndex % 2]._id }),
    },
    ...stamp(created, { updatedAt: daysAgo(int(1, 40)) }),
  };
});
const published = courses.filter(course => course.status === 'published');
const lessonsOf = course => course.chapters.flatMap(chapter => chapter.lessons);
const teacherById = id => teachers.find(teacher => String(teacher._id) === String(id));

// ---------------------------------------------------------------- orders / ledger helpers
let invoiceSeq = (database.counters.findOne({ _id: `invoice-${now.getFullYear()}` }) || { seq: 0 }).seq;
const orders = [], ledger = [], paymentEvents = [];
const lineFor = (itemType, itemId, title, sellerId, euros) => {
  const unitAmount = cents(euros), platformFee = Math.round(unitAmount * COMMISSION / 100), sellerAmount = unitAmount - platformFee;
  const seller = teacherById(sellerId);
  const share = seller && seller.institutionId ? seller.institutionRevenueShare : 0;
  return { itemType, itemId, title, sellerId, institutionId: share ? seller.institutionId : null, institutionSharePercent: share, institutionAmount: Math.round(sellerAmount * share / 100), unitAmount, commissionRate: COMMISSION, platformFee, sellerAmount };
};
const createOrder = (student, items, paidAt, status = 'paid') => {
  const _id = new ObjectId();
  const created = new Date(paidAt.getTime() - 4 * 60000);
  const order = {
    _id, studentId: student._id, items, currency: 'eur', totalAmount: items.reduce((sum, item) => sum + item.unitAmount, 0), status, provider: 'sandbox',
    providerSessionId: `sbx_${hex(24)}`, providerPaymentId: status === 'failed' ? undefined : `sbx_pay_${hex(20)}`, checkoutUrl: `/checkout/sandbox/sbx_${hex(8)}`,
    idempotencyKey: `seed-${hex(16)}`, expiresAt: new Date(created.getTime() + 30 * 60000), failureReason: status === 'failed' ? 'PAYMENT_FAILED' : '', ...stamp(created, { updatedAt: paidAt }),
  };
  if (status === 'paid' || status === 'refunded') {
    order.paidAt = paidAt;
    order.invoiceNumber = `INV-${now.getFullYear()}-${String(++invoiceSeq).padStart(6, '0')}`;
    const availableAt = new Date(paidAt.getTime() + HOLD_DAYS * DAY);
    for (const item of items.filter(line => line.itemType !== 'subscription')) {
      ledger.push({ sellerId: item.sellerId, orderId: _id, itemType: item.itemType, itemId: item.itemId, title: item.title, type: 'sale', grossAmount: item.unitAmount, platformFee: item.platformFee, amount: item.sellerAmount - item.institutionAmount, currency: 'eur', availableAt, ...stamp(paidAt) });
      if (item.institutionAmount > 0) ledger.push({ sellerId: item.institutionId, orderId: _id, itemType: item.itemType, itemId: item.itemId, title: item.title, type: 'affiliation_share', grossAmount: item.unitAmount, platformFee: 0, amount: item.institutionAmount, currency: 'eur', availableAt, ...stamp(paidAt) });
    }
    paymentEvents.push({ provider: 'sandbox', eventId: `evt_${hex(24)}`, kind: 'checkout.completed', orderId: _id, ...stamp(paidAt) });
  }
  if (status === 'failed') paymentEvents.push({ provider: 'sandbox', eventId: `evt_${hex(24)}`, kind: 'checkout.failed', orderId: _id, ...stamp(paidAt) });
  orders.push(order);
  return order;
};

// ---------------------------------------------------------------- subscriptions (catalogue included)
const subscribers = students.slice(30, 35);
const subscriptions = [], periods = [];
subscribers.forEach((student, index) => {
  const yearly = index === 0;
  const start = daysAgo(yearly ? 120 : index === 4 ? 40 : 12);
  const end = new Date(start.getTime() + (yearly ? 365 : 30) * DAY);
  const euros = yearly ? 279 : 29;
  const order = createOrder(student, [{ itemType: 'subscription', itemId: new ObjectId(), subscriptionPlan: yearly ? 'yearly' : 'monthly', title: yearly ? 'EduMarket subscription · 12 months' : 'EduMarket subscription · 1 month', institutionId: null, institutionSharePercent: 0, institutionAmount: 0, unitAmount: cents(euros), commissionRate: COMMISSION, platformFee: Math.round(cents(euros) * COMMISSION / 100), sellerAmount: cents(euros) - Math.round(cents(euros) * COMMISSION / 100) }], start);
  const expired = end < now;
  periods.push({ studentId: student._id, orderId: order._id, plan: yearly ? 'yearly' : 'monthly', startsAt: start, endsAt: end, amount: cents(euros), currency: 'eur', commissionRate: COMMISSION, status: 'active', settledAt: expired ? new Date(end.getTime() + 3600000) : null, distributedAmount: 0, ...stamp(start) });
  subscriptions.push({ studentId: student._id, plan: yearly ? 'yearly' : 'monthly', currentPeriodEnd: end, cancelledAt: index === 3 ? daysAgo(2) : null, reminderSentForPeriodEnd: end.getTime() - now.getTime() < 3 * DAY && !expired ? end : null, ...stamp(start) });
});

// ---------------------------------------------------------------- enrollments, progress, quizzes, certificates, reviews
const enrollments = [], activities = [], quizAttempts = [], certificates = [], reviews = [];
const REVIEW_TEXTS = [
  [5, 'Formation très claire, les exercices pratiques font vraiment progresser. Je recommande !'],
  [5, 'Excellent formateur, explications limpides et projets concrets. Le meilleur cours que j\'ai suivi ici.'],
  [4, 'Très bon contenu, quelques vidéos mériteraient d\'être mises à jour mais l\'ensemble est solide.'],
  [4, 'Bonne progression pédagogique, les quiz aident à valider les acquis.'],
  [3, 'Contenu correct mais le rythme est un peu rapide pour un débutant.'],
  [5, 'Parfait pour préparer un entretien technique, merci pour les ressources !'],
  [4, 'Clair et bien structuré. J\'aurais aimé plus d\'exemples sur la dernière partie.'],
];
const REPLIES = ['Merci beaucoup pour ce retour, ravie que le cours vous ait aidé !', 'Merci ! Une mise à jour des vidéos est prévue ce trimestre.', 'Merci pour la remarque, j\'ajoute des exemples supplémentaires dans le chapitre 2.'];
// Subscribers open paid courses through their period (an expired period leaves an expired access, as in production).
const activeSubscription = student => periods.find(period => String(period.studentId) === String(student._id));
students.forEach((student, studentIndex) => {
  if (student.status === 'suspended') return;
  const chosen = sample(published, int(2, 5));
  chosen.forEach(course => {
    const period = course.price > 0 ? activeSubscription(student) : null;
    const accessType = course.price === 0 ? 'free' : period ? 'subscription' : 'purchase';
    const enrolledAt = period ? new Date(period.startsAt.getTime() + int(0, 5) * DAY) : daysAgo(int(5, 150));
    if (accessType === 'purchase') createOrder(student, [lineFor('course', course._id, course.title, course.teacherId, course.price)], enrolledAt);
    const lessons = lessonsOf(course);
    const done = rand() < 0.3 ? lessons.length : int(0, lessons.length - 1);
    const completedLessons = lessons.slice(0, done);
    const completedAt = done === lessons.length ? new Date(enrolledAt.getTime() + int(10, 40) * DAY) : null;
    const finished = completedAt && completedAt > now ? daysAgo(1) : completedAt;
    completedLessons.forEach((lesson, position) => {
      const at = new Date(enrolledAt.getTime() + (position + 1) * int(1, 4) * DAY);
      const when = at > now ? daysAgo(1, 9 + position) : at;
      activities.push({ studentId: student._id, courseId: course._id, lessonId: lesson.id, completedAt: when, ...stamp(when) });
      if (lesson.quiz) {
        const correct = rand() < 0.8 ? 2 : 1;
        quizAttempts.push({ studentId: student._id, courseId: course._id, lessonId: lesson.id, quizId: lesson.quiz.id, answers: [{ questionId: 'q1', selectedOptionIndex: 0 }, { questionId: 'q2', selectedOptionIndex: correct === 2 ? 0 : 1 }], score: correct * 50, passed: correct === 2, correctCount: correct, totalQuestions: 2, ...stamp(when) });
      }
    });
    enrollments.push({ studentId: student._id, courseId: course._id, completedLessonIds: completedLessons.map(lesson => lesson.id), enrolledAt, lastAccessedAt: done ? daysAgo(int(0, 20)) : enrolledAt, completedAt: finished, accessType, accessExpiresAt: accessType === 'subscription' ? period.endsAt : null, ...stamp(enrolledAt, { updatedAt: daysAgo(int(0, 20)) }) });
    course.studentsCount += 1;
    if (finished && course.hasCertification && course.certificationPathway === 'learning_and_quiz') {
      certificates.push({ code: hex(24).toUpperCase(), studentId: student._id, courseId: course._id, issuedAt: finished, revokedAt: null, revokedReason: '', revokedBy: null, ...stamp(finished) });
    }
    if (done >= 2 && rand() < 0.55) {
      const [rating, comment] = pick(REVIEW_TEXTS);
      const reviewedAt = new Date(enrolledAt.getTime() + 6 * DAY) > now ? daysAgo(1) : new Date(enrolledAt.getTime() + 6 * DAY);
      reviews.push({ courseId: course._id, studentId: student._id, rating, comment, status: studentIndex === 11 ? 'hidden' : 'published',
        ...(rand() < 0.35 ? { reply: { body: pick(REPLIES), authorId: course.teacherId, repliedAt: new Date(reviewedAt.getTime() + DAY) } } : {}), ...stamp(reviewedAt) });
    }
  });
});
if (certificates[0]) Object.assign(certificates[0], { revokedAt: daysAgo(4), revokedReason: 'Fraude constatée lors du quiz final (comptes partagés).', revokedBy: admin._id });
for (const course of courses) {
  const own = reviews.filter(review => String(review.courseId) === String(course._id) && review.status === 'published');
  course.ratingCount = own.length;
  course.rating = own.length ? Math.round(own.reduce((sum, review) => sum + review.rating, 0) / own.length * 100) / 100 : 0;
}
// Favourites (courses not yet bought).
students.slice(0, 20).forEach(student => { student.favoriteCourseIds = sample(published, 2).map(course => course._id); });

// Settled subscription period: revenue split by lessons completed during the period.
for (const period of periods.filter(item => item.settledAt)) {
  const pool = period.amount - Math.round(period.amount * period.commissionRate / 100);
  const subscribed = enrollments.filter(row => String(row.studentId) === String(period.studentId) && row.accessType === 'subscription');
  const weights = subscribed.map(row => Math.max(1, row.completedLessonIds.length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  subscribed.forEach((row, index) => {
    const course = courses.find(item => String(item._id) === String(row.courseId));
    const share = Math.floor(pool * weights[index] / total);
    ledger.push({ sellerId: course.teacherId, orderId: period.orderId, itemType: 'subscription', itemId: course._id, title: course.title, type: 'subscription_share', grossAmount: share, platformFee: 0, amount: share, currency: 'eur', availableAt: period.settledAt, ...stamp(period.settledAt) });
    period.distributedAmount += share;
  });
}

// Failed, pending and refunded orders (no access granted).
createOrder(students[5], [lineFor('course', published[6]._id, published[6].title, published[6].teacherId, published[6].price)], daysAgo(9), 'failed');
createOrder(students[8], [lineFor('course', published[7]._id, published[7].title, published[7].teacherId, published[7].price)], daysAgo(0, 9), 'pending');
const refunded = createOrder(students[12], [lineFor('course', published[8]._id, published[8].title, published[8].teacherId, published[8].price)], daysAgo(25));
refunded.status = 'refunded';
refunded.refund = { refundId: `sbx_re_${hex(16)}`, reason: 'Le cours ne correspondait pas au niveau annoncé (demande dans les 14 jours).', refundedAt: daysAgo(22), refundedBy: admin._id };
ledger.filter(entry => String(entry.orderId) === String(refunded._id)).forEach(entry => ledger.push({ ...entry, type: entry.type === 'sale' ? 'refund' : `${entry.type}_refund`, grossAmount: -entry.grossAmount, platformFee: -entry.platformFee, amount: -entry.amount, availableAt: daysAgo(22), ...stamp(daysAgo(22)) }));

// ---------------------------------------------------------------- exams
const exams = [], registrations = [], examAttempts = [], examResults = [];
const examQuestions = topic => [
  { id: 'e1', question: `Quel est l'objectif principal du module « ${topic} » ?`, options: ['Appliquer les notions en situation réelle', 'Mémoriser des dates', 'Aucun'], correctOptionIndex: 0, explanation: '' },
  { id: 'e2', question: 'Une bonne pratique consiste à :', options: ['Tester et documenter', 'Ignorer les erreurs', 'Tout faire en production'], correctOptionIndex: 0, explanation: '' },
  { id: 'e3', question: 'Le travail est validé lorsque :', options: ['Les critères d\'acceptation sont remplis', 'Le code compile une fois', 'Le chef est absent'], correctOptionIndex: 0, explanation: '' },
  { id: 'e4', question: 'En cas de doute, il faut :', options: ['Consulter la documentation officielle', 'Copier un forum au hasard', 'Abandonner'], correctOptionIndex: 0, explanation: '' },
];
const examSpecs = [
  [published[0], 'online', 0, 'Examen final — React & Node.js'],
  [published[3], 'online', 25, 'Certification Python Data Analyst'],
  [published[7], 'in_person', 40, 'Examen surveillé — Machine learning'],
  [published[13], 'in_person', 0, 'Validation Scrum Fundamentals'],
];
examSpecs.forEach(([course, type, fee, title], examIndex) => {
  const _id = new ObjectId();
  const date = type === 'in_person' ? (examIndex === 2 ? daysAgo(10, 9) : daysAhead(18, 9)) : undefined;
  const exam = {
    _id, courseId: course._id, creatorId: course.teacherId, title, description: `Évaluation finale du cours « ${course.title} ». Durée limitée, seuil de réussite affiché ci-dessous.`,
    type, fee, durationMinutes: type === 'online' ? 45 : 120, passPercentage: 70, registeredCount: 0, questions: type === 'online' ? examQuestions(course.title) : [], status: 'published',
    ...(date ? { date } : {}), ...(type === 'in_person' ? { location: { venue: examIndex === 2 ? 'Centre d\'examen Carthage Data' : 'Institut Supérieur du Numérique — Salle B12', address: examIndex === 2 ? '12 rue du Lac Léman, Les Berges du Lac' : '45 avenue Habib Bourguiba', city: examIndex === 2 ? 'Tunis' : 'Ariana', capacity: 30 } } : {}),
    ...stamp(daysAgo(60)),
  };
  const candidates = enrollments.filter(row => String(row.courseId) === String(course._id) && row.completedLessonIds.length >= 3).slice(0, 6);
  candidates.forEach((row, index) => {
    const student = students.find(item => String(item._id) === String(row.studentId));
    const registeredAt = daysAgo(int(12, 30));
    if (fee > 0) createOrder(student, [lineFor('exam', _id, title, course.teacherId, fee)], registeredAt);
    registrations.push({ examId: _id, studentId: student._id, registeredAt });
    exam.registeredCount += 1;
    const score = int(52, 98);
    if (type === 'online' && index < 4) examAttempts.push({ examId: _id, studentId: student._id, startedAt: daysAgo(5, 14), submittedAt: daysAgo(5, 14.6), answers: exam.questions.map(question => ({ questionId: question.id, selectedOptionIndex: rand() < 0.8 ? 0 : 1 })), score, passed: score >= 70, ...stamp(daysAgo(5, 14)) });
    if (type === 'in_person' && examIndex === 2) {
      examResults.push({ examId: _id, studentId: student._id, score, passed: score >= 70, feedback: score >= 70 ? 'Très bonne maîtrise de la démarche expérimentale.' : 'Revoir la validation croisée et le choix des métriques.', gradedBy: teachers[3]._id, gradedAt: daysAgo(6), ...stamp(daysAgo(6)) });
      if (score >= 70 && row.completedAt && !certificates.some(item => String(item.studentId) === String(student._id) && String(item.courseId) === String(course._id))) certificates.push({ code: hex(24).toUpperCase(), studentId: student._id, courseId: course._id, issuedAt: daysAgo(6), revokedAt: null, revokedReason: '', revokedBy: null, ...stamp(daysAgo(6)) });
    }
  });
  exams.push(exam);
});

// ---------------------------------------------------------------- tutoring sessions
const sessions = [], sessionReviews = [];
const SUBJECTS = ['Revue de code de mon projet', 'Préparation d\'entretien technique', 'Aide sur le chapitre 2', 'Correction d\'exercices', 'Orientation de carrière', 'Préparation à l\'examen final'];
approvedTeachers.forEach((teacher, teacherIndex) => {
  const learners = enrollments.filter(row => published.some(course => String(course._id) === String(row.courseId) && String(course.teacherId) === String(teacher._id))).map(row => row.studentId);
  const plan = [['completed', -20], ['completed', -9], ['cancelled', -4], ['confirmed', 3], ['pending', 5], ['available', 6], ['available', 8], ['available', 11], ['available', 15]];
  plan.forEach(([status, offset], index) => {
    const startAt = daysAgo(-offset, 9 + (index % 4) * 2 + teacherIndex % 2);
    const type = index % 3 === 2 ? 'in_person' : 'online';
    const studentId = status === 'available' || !learners.length ? null : learners[index % learners.length];
    const finalStatus = !studentId && status !== 'available' ? 'available' : status;
    const _id = new ObjectId();
    sessions.push({
      _id, teacherId: teacher._id, studentId, startAt, endAt: new Date(startAt.getTime() + 3600000), type, price: index % 2 ? 0 : 25, subject: studentId ? pick(SUBJECTS) : '',
      notes: studentId ? 'Je partagerai mon écran pour montrer le code.' : '', venue: type === 'in_person' ? 'Espace coworking Lac 2, Tunis' : '', status: finalStatus,
      jitsiRoomId: finalStatus === 'confirmed' || finalStatus === 'completed' ? (type === 'online' ? base64url(32) : '') : '',
      paymentStatus: studentId && index % 2 === 0 ? (finalStatus === 'cancelled' ? 'refunded' : 'paid') : 'not_required', orderId: null, reservationExpiresAt: null,
      ...stamp(new Date(startAt.getTime() - 10 * DAY)),
    });
    const session = sessions[sessions.length - 1];
    if (session.paymentStatus === 'paid' || session.paymentStatus === 'refunded') {
      const student = students.find(item => String(item._id) === String(studentId));
      const order = createOrder(student, [lineFor('session', _id, `Session de tutorat · ${teacher.name}`, teacher._id, 25)], new Date(startAt.getTime() - 6 * DAY));
      session.orderId = order._id;
      if (session.paymentStatus === 'refunded') {
        order.status = 'refunded';
        order.refund = { refundId: `sbx_re_${hex(16)}`, reason: 'SESSION_CANCELLED', refundedAt: new Date(startAt.getTime() - 5 * DAY), refundedBy: null };
        ledger.filter(entry => String(entry.orderId) === String(order._id)).forEach(entry => ledger.push({ ...entry, type: entry.type === 'sale' ? 'refund' : `${entry.type}_refund`, grossAmount: -entry.grossAmount, platformFee: -entry.platformFee, amount: -entry.amount, availableAt: order.refund.refundedAt, ...stamp(order.refund.refundedAt) }));
      }
    }
    if (finalStatus === 'completed' && rand() < 0.8) sessionReviews.push({ sessionId: _id, studentId, rating: int(4, 5), comment: pick(['Session très utile, conseils précis et bienveillants.', 'Explications claires, j\'ai enfin compris le sujet.', 'Excellent accompagnement, je reprendrai un créneau.']), ...stamp(new Date(startAt.getTime() + 2 * 3600000)) });
  });
});

// ---------------------------------------------------------------- payouts
const balanceOf = sellerId => ledger.filter(entry => String(entry.sellerId) === String(sellerId) && entry.availableAt <= now).reduce((sum, entry) => sum + entry.amount, 0);
const payouts = [];
const payoutFor = (seller, status, ratio, days) => {
  const amount = Math.floor(balanceOf(seller._id) * ratio);
  if (amount < 2000) return;
  payouts.push({ sellerId: seller._id, amount, currency: 'eur', status, reference: status === 'paid' ? `VIR-${int(100000, 999999)}` : '', note: status === 'rejected' ? 'RIB invalide : merci de mettre à jour vos coordonnées bancaires.' : '', ...(status === 'requested' ? {} : { processedBy: admin._id, processedAt: daysAgo(days - 2) }), ...stamp(daysAgo(days)) });
};
payoutFor(teachers[0], 'paid', 0.5, 30);
payoutFor(teachers[2], 'rejected', 0.3, 15);
payoutFor(teachers[3], 'requested', 0.4, 2);
payoutFor(instA, 'requested', 0.5, 1);

// ---------------------------------------------------------------- messaging
const conversations = [], messages = [];
const DIALOGUES = [
  ['Bonjour, je bloque sur l\'exercice du chapitre 2 : mon composant se re-rend en boucle.', 'Bonjour ! Vérifiez les dépendances de votre useEffect : un objet recréé à chaque rendu déclenche la boucle.', 'C\'était exactement ça, merci beaucoup !'],
  ['Est-ce que le certificat est reconnu par les entreprises ?', 'Il est vérifiable publiquement via son code, et plusieurs partenaires l\'acceptent dans leurs recrutements.', 'Parfait, je m\'inscris à l\'examen.'],
  ['Pouvez-vous me conseiller un projet pour mon portfolio ?', 'Je vous propose un tableau de bord avec authentification et graphiques. Réservons un créneau pour en parler.', 'Très bonne idée, je réserve jeudi.'],
];
enrollments.filter(row => row.completedLessonIds.length > 1).slice(0, 14).forEach((row, index) => {
  const course = courses.find(item => String(item._id) === String(row.courseId));
  const ids = [String(row.studentId), String(course.teacherId)].sort();
  if (conversations.some(item => item.participantKey === ids.join(':'))) return;
  const _id = new ObjectId();
  const dialogue = DIALOGUES[index % DIALOGUES.length];
  let at = daysAgo(int(2, 40), 9);
  dialogue.forEach((text, position) => {
    at = new Date(at.getTime() + int(20, 300) * 60000);
    const senderId = position % 2 === 0 ? row.studentId : course.teacherId;
    messages.push({ conversationId: _id, senderId, text, readBy: position === dialogue.length - 1 && index % 3 === 0 ? [senderId] : [row.studentId, course.teacherId], hiddenAt: null, ...stamp(at) });
  });
  conversations.push({ _id, participants: ids.map(id => new ObjectId(id)), participantKey: ids.join(':'), lastMessageText: dialogue[dialogue.length - 1], lastMessageAt: at, lastSenderId: row.studentId, ...stamp(daysAgo(41), { updatedAt: at }) });
});
const hiddenMessage = { _id: new ObjectId(), conversationId: conversations[0]._id, senderId: conversations[0].participants[1], text: 'Message retiré suite à un signalement.', readBy: [], hiddenAt: daysAgo(3), ...stamp(daysAgo(5)) };
messages.push(hiddenMessage);

// ---------------------------------------------------------------- forum
const FORUM = [
  ['Développement Web & Cloud', 'Quelle stack choisir pour un premier projet SaaS ?', 'Je souhaite lancer un petit SaaS de prise de rendez-vous. React + Node.js ou Next.js directement ? Vos retours d\'expérience m\'intéressent.', ['react', 'nextjs']],
  ['Développement Web & Cloud', 'Erreur CORS avec les cookies HttpOnly', 'Mon API Express renvoie les cookies mais le navigateur ne les envoie pas. J\'ai bien credentials: include côté fetch. Une idée ?', ['cors', 'express']],
  ['Intelligence Artificielle & Data', 'Comment éviter le surapprentissage sur un petit dataset ?', 'J\'ai 800 lignes et mon modèle atteint 99 % en entraînement mais 70 % en test. Quelles techniques privilégier ?', ['machine-learning']],
  ['Intelligence Artificielle & Data', 'Pandas : merge ou join ?', 'Quelle est la différence pratique entre merge et join, et lequel est le plus performant ?', ['pandas', 'python']],
  ['Cybersécurité & Réseaux', 'Préparer l\'OSCP en partant de zéro', 'Par où commencer quand on vient du développement ? Quelles machines conseillez-vous ?', ['oscp', 'pentest']],
  ['Cybersécurité & Réseaux', 'Stocker les mots de passe : bcrypt ou argon2 ?', 'Pour une nouvelle application, faut-il préférer argon2id à bcrypt ? Quels paramètres ?', ['securite']],
  ['Développement Web & Cloud', 'Déployer une app MERN sans Docker', 'Je veux héberger une application MERN sur un VPS sans conteneurs. PM2 + Nginx suffisent-ils ?', ['deploiement', 'nodejs']],
  ['Intelligence Artificielle & Data', 'Ressources pour apprendre l\'algèbre linéaire appliquée', 'Je cherche des exercices pratiques orientés data science, en complément du cours.', ['maths']],
];
const forumPosts = [], forumReplies = [], forumVotes = [], forumReports = [];
const REPLY_TEXTS = ['Excellente question ! De mon côté, j\'ai commencé simple puis migré quand le besoin est apparu.', 'Regardez la documentation officielle, la section dédiée répond exactement à ce cas.', 'J\'ai eu le même problème : la solution était de configurer SameSite et l\'origine exacte côté serveur.', 'Je recommande de commencer par un petit projet concret, on apprend beaucoup plus vite.', 'Merci pour le partage, très utile !'];
FORUM.forEach(([category, title, content, tags], index) => {
  const _id = new ObjectId();
  const author = index % 3 === 0 ? approvedTeachers[index % 8] : students[index * 3];
  const created = daysAgo(int(3, 60));
  const replies = Array.from({ length: int(1, 4) }, (_, position) => ({ _id: new ObjectId(), postId: _id, authorId: position === 0 ? approvedTeachers[(index + 2) % 8]._id : students[(index * 5 + position) % 30]._id, content: REPLY_TEXTS[(index + position) % REPLY_TEXTS.length], status: 'published', upvotes: int(0, 12), ...stamp(new Date(created.getTime() + (position + 1) * 5 * 3600000)) }));
  forumReplies.push(...replies);
  const voters = sample(students.slice(0, 30), int(2, 9));
  voters.forEach(voter => forumVotes.push({ userId: voter._id, targetType: 'post', targetId: _id, ...stamp(created) }));
  forumPosts.push({ _id, title, content, category, authorId: author._id, status: 'published', tags, upvotes: voters.length, repliesCount: replies.length, viewsCount: int(30, 600), solvedReplyId: index % 2 === 0 ? replies[0]._id : null, ...stamp(created, { updatedAt: daysAgo(1) }) });
});
const spamPost = { _id: new ObjectId(), title: 'Gagnez 500 € par jour sans effort', content: 'Contactez-moi sur WhatsApp pour une méthode secrète et garantie de revenus passifs !!!', category: 'Développement Web & Cloud', authorId: students[36]._id, status: 'hidden', tags: [], upvotes: 0, repliesCount: 0, viewsCount: 14, solvedReplyId: null, ...stamp(daysAgo(6)) };
forumPosts.push(spamPost);
forumReports.push(
  { targetType: 'post', targetId: spamPost._id, reporterId: students[2]._id, reason: 'Spam publicitaire et arnaque potentielle.', status: 'actioned', reviewedBy: moderators[0]._id, reviewedAt: daysAgo(5), reviewNote: 'Publication masquée.', ...stamp(daysAgo(6)) },
  { targetType: 'reply', targetId: forumReplies[3]._id, reporterId: students[9]._id, reason: 'Réponse hors sujet, ne répond pas à la question.', status: 'open', reviewNote: '', ...stamp(daysAgo(1)) },
);

// ---------------------------------------------------------------- assignments
const assignments = [], submissions = [];
published.slice(0, 6).forEach((course, index) => {
  const _id = new ObjectId();
  assignments.push({ _id, courseId: course._id, teacherId: course.teacherId, title: `Projet pratique — ${course.title.split(':')[0]}`, instructions: `Réalisez le mini-projet décrit dans le chapitre « Mise en pratique » et rendez un rapport (objectifs, choix techniques, difficultés rencontrées). Critères : exactitude, clarté, qualité de la démarche.`, dueAt: index % 2 ? daysAhead(10) : daysAgo(5), points: 100, status: 'published', ...stamp(daysAgo(30)) });
  enrollments.filter(row => String(row.courseId) === String(course._id) && row.completedLessonIds.length >= 3).slice(0, 4).forEach((row, position) => {
    const graded = position % 2 === 0;
    submissions.push({ assignmentId: _id, studentId: row.studentId, answerText: 'Voici mon rendu : j\'ai découpé le projet en trois étapes, testé chaque fonctionnalité et documenté les choix dans le README du dépôt.', files: [], status: graded ? 'graded' : 'submitted', submittedAt: daysAgo(int(2, 12)), ...(graded ? { score: int(62, 96), feedback: 'Bon travail, démarche claire. Pensez à mieux justifier vos choix techniques.', gradedAt: daysAgo(1), graderId: course.teacherId } : { feedback: '' }), ...stamp(daysAgo(int(2, 12))) });
  });
});

// ---------------------------------------------------------------- lesson Q&A
const lessonQuestions = [];
const QUESTIONS = ['Pourquoi utilise-t-on cette approche plutôt que l\'alternative présentée au début ?', 'Est-ce que l\'exemple fonctionne aussi avec la dernière version de la bibliothèque ?', 'Pouvez-vous détailler la troisième étape ? Je n\'obtiens pas le même résultat.', 'Existe-t-il une ressource complémentaire pour approfondir ce point ?'];
enrollments.filter(row => row.completedLessonIds.length >= 2).slice(0, 12).forEach((row, index) => {
  const course = courses.find(item => String(item._id) === String(row.courseId));
  const created = daysAgo(int(2, 30));
  lessonQuestions.push({ courseId: course._id, lessonId: row.completedLessonIds[1], authorId: row.studentId, body: QUESTIONS[index % QUESTIONS.length], status: 'published',
    answers: index % 3 === 2 ? [] : [{ _id: new ObjectId(), authorId: course.teacherId, staff: true, body: 'Bonne question ! La différence tient à la maintenabilité : je détaille un exemple dans la leçon suivante.', createdAt: new Date(created.getTime() + 5 * 3600000) }],
    ...stamp(created) });
});

// ---------------------------------------------------------------- learning paths
const byCategory = category => published.filter(course => course.category === category).map(course => course._id);
const learningPaths = [
  { slug: 'developpeur-full-stack', title: { fr: 'Développeur full-stack JavaScript', en: 'Full-stack JavaScript developer', ar: 'مطوّر ويب متكامل بجافاسكربت' }, description: { fr: 'Des bases du web jusqu\'aux applications React et Node.js en production.', en: 'From web fundamentals to production React and Node.js applications.', ar: 'من أساسيات الويب إلى تطبيقات React وNode.js في بيئة الإنتاج.' }, skills: ['HTML/CSS', 'React', 'Node.js', 'TypeScript'], courseIds: byCategory('developpement-web'), active: true, order: 0 },
  { slug: 'data-scientist', title: { fr: 'Data scientist', en: 'Data scientist', ar: 'عالم بيانات' }, description: { fr: 'Python, mathématiques, machine learning et deep learning pour devenir data scientist.', en: 'Python, maths, machine learning and deep learning to become a data scientist.', ar: 'بايثون والرياضيات وتعلّم الآلة والتعلّم العميق لتصبح عالم بيانات.' }, skills: ['Python', 'Pandas', 'Machine learning', 'Deep learning'], courseIds: [...byCategory('data-ia'), ...byCategory('mathematiques')], active: true, order: 1 },
  { slug: 'analyste-cybersecurite', title: { fr: 'Analyste cybersécurité', en: 'Cybersecurity analyst', ar: 'محلّل أمن سيبراني' }, description: { fr: 'Comprendre les menaces puis auditer des applications web selon l\'OWASP.', en: 'Understand threats, then audit web applications with OWASP.', ar: 'فهم التهديدات ثم تدقيق تطبيقات الويب وفق OWASP.' }, skills: ['Sécurité réseau', 'OWASP', 'Pentest'], courseIds: byCategory('cybersecurite'), active: true, order: 2 },
].map(path => ({ ...path, ...stamp(daysAgo(50)) }));

// ---------------------------------------------------------------- support tickets
const ticket = (requester, subject, category, status, thread, extra = {}) => {
  const created = daysAgo(int(2, 25));
  const messagesList = thread.map(([role, body], position) => ({ _id: new ObjectId(), authorId: role === 'staff' ? admin._id : requester ? requester._id : null, authorRole: role, body, createdAt: new Date(created.getTime() + position * 6 * 3600000) }));
  return { requesterId: requester ? requester._id : null, subject, category, priority: extra.priority || 'normal', status, assigneeId: status === 'open' ? null : admin._id, relatedOrderId: extra.relatedOrderId || null, messages: messagesList, lastActivityAt: messagesList[messagesList.length - 1].createdAt, ...(extra.guest ? { guest: extra.guest } : {}), ...stamp(created) };
};
const supportTickets = [
  ticket(students[12], 'Remboursement du cours Deep learning', 'billing', 'resolved', [['requester', 'Bonjour, le niveau du cours est trop avancé pour moi. Puis-je être remboursé ?'], ['staff', 'Votre commande est éligible (moins de 14 jours) : le remboursement a été effectué.']], { relatedOrderId: refunded._id }),
  ticket(students[3], 'Vidéo qui ne se charge pas', 'technical', 'pending_user', [['requester', 'La vidéo de la première leçon reste bloquée au chargement sur Firefox.'], ['staff', 'Pouvez-vous vider le cache et nous indiquer votre version de Firefox ?']]),
  ticket(students[7], 'Changer l\'adresse e-mail de mon compte', 'account', 'open', [['requester', 'Je souhaite utiliser mon adresse professionnelle. Comment faire ?']], { priority: 'low' }),
  ticket(teachers[5], 'Mon cours a été refusé, que dois-je modifier ?', 'course', 'resolved', [['requester', 'Je ne comprends pas le motif de refus de mon cours Growth hacking.'], ['staff', 'Le motif est indiqué dans l\'éditeur : remplacez les contenus du module 3 puis soumettez à nouveau.']]),
  ticket(instA, 'Facture pour notre service comptable', 'billing', 'open', [['requester', 'Pouvez-vous nous envoyer un récapitulatif des reversements du trimestre ?']], { priority: 'high' }),
  ticket(null, 'Partenariat pour notre école', 'other', 'open', [['requester', 'Bonjour, nous sommes une école privée à Sousse et souhaitons publier nos formations. Quelles sont les conditions ?']], { guest: { name: 'Mouna Ltaief', email: 'mouna.ltaief@ecole-sousse.example.tn' } }),
];

// ---------------------------------------------------------------- content reports
const reportedCourse = courses.find(course => course.status === 'suspended');
const reportedReview = reviews.find(review => review.status === 'hidden') || reviews[0];
const contentReports = [
  { targetType: 'course', targetId: reportedCourse._id, reporterId: students[4]._id, reason: 'misinformation', details: 'Le cours promet des gains garantis.', snapshot: { title: reportedCourse.title, excerpt: reportedCourse.description.slice(0, 300), ownerId: reportedCourse.teacherId }, status: 'actioned', decisionNote: 'Cours suspendu.', reviewedBy: moderators[1]._id, reviewedAt: daysAgo(7), ...stamp(daysAgo(8)) },
  { targetType: 'course_review', targetId: reportedReview._id, reporterId: teachers[0]._id, reason: 'harassment', details: 'Avis insultant envers le formateur.', snapshot: { title: '', excerpt: reportedReview.comment, ownerId: reportedReview.studentId }, status: 'actioned', decisionNote: 'Avis masqué.', reviewedBy: moderators[0]._id, reviewedAt: daysAgo(3), ...stamp(daysAgo(4)) },
  { targetType: 'message', targetId: new ObjectId(), reporterId: conversations[0].participants[0], reason: 'spam', details: 'Lien suspect envoyé en message privé.', snapshot: { title: '', excerpt: hiddenMessage.text, ownerId: hiddenMessage.senderId }, status: 'actioned', decisionNote: 'Message masqué.', reviewedBy: moderators[0]._id, reviewedAt: daysAgo(3), ...stamp(daysAgo(4)) },
  { targetType: 'user', targetId: students[36]._id, reporterId: students[2]._id, reason: 'spam', details: 'Publie des arnaques sur le forum.', snapshot: { title: students[36].name, excerpt: '', ownerId: students[36]._id }, status: 'escalated', decisionNote: 'Escaladé aux administrateurs.', reviewedBy: moderators[0]._id, reviewedAt: daysAgo(2), ...stamp(daysAgo(3)) },
  { targetType: 'course', targetId: published[11]._id, reporterId: students[15]._id, reason: 'copyright', details: 'Certaines diapositives semblent copiées d\'un autre site.', snapshot: { title: published[11].title, excerpt: published[11].description.slice(0, 300), ownerId: published[11].teacherId }, status: 'open', decisionNote: '', ...stamp(daysAgo(1)) },
];
contentReports[2].targetId = hiddenMessage._id;

// ---------------------------------------------------------------- notifications (translated through template keys)
const notifications = [];
const notify = (userId, type, key, title, message, link, params = {}, days = int(0, 20), read = rand() < 0.5) => notifications.push({ userId, type, title, message, link, template: { key, params }, readAt: read ? daysAgo(days - 0.5) : null, ...stamp(daysAgo(days)) });
for (const order of orders.filter(item => item.status === 'paid').slice(0, 40)) notify(order.studentId, 'purchase', 'paymentConfirmed', 'Payment confirmed', `Your payment for ${order.items.length} item(s) was confirmed.`, '/student/orders', { count: order.items.length });
for (const certificate of certificates) notify(certificate.studentId, 'certificate', 'certificateIssued', 'Certificate issued', 'You completed an eligible course and earned a certificate.', '/student/certificates');
for (const course of courses.filter(item => item.status === 'published').slice(0, 8)) notify(course.teacherId, 'course', 'coursePublished', 'Course published', `"${course.title}" is now published in the catalogue.`, `/teacher/courses/${course._id}/edit`, { course: course.title }, 60, true);
notify(courses.find(item => item.status === 'rejected').teacherId, 'course', 'courseChangesRequested', 'Course changes requested', 'Course was not approved.', '/teacher/courses', { course: 'Growth hacking pour startups', note: REVIEW_NOTES.rejected }, 10, false);
notify(teachers[5]._id, 'account', 'institutionInvitation', 'Institution invitation', 'A verified institution invited you to affiliate your teacher account.', '/teacher/affiliations', {}, 2, false);
for (const session of sessions.filter(item => item.status === 'pending')) notify(session.teacherId, 'session', 'tutoringRequest', 'New tutoring request', 'A student requested one of your tutoring slots.', '/teacher/tutoring', {}, 1, false);
for (const session of sessions.filter(item => item.status === 'confirmed' && item.studentId)) notify(session.studentId, 'session', 'session_confirmed', 'Tutoring session confirmed', 'A tutoring session you participate in has changed status.', '/student/sessions', {}, 2);
for (const subscription of subscriptions) notify(subscription.studentId, 'subscription', 'subscriptionActive', 'Subscription active', 'Your subscription gives access to the paid catalogue.', '/student/subscription', { date: subscription.currentPeriodEnd.toISOString() }, 10, true);
for (const review of reviews.filter(item => item.reply)) notify(review.studentId, 'course', 'reviewReplied', 'Reply to your review', 'The teacher replied to your review.', `/courses/${review.courseId}`, { course: courses.find(course => String(course._id) === String(review.courseId)).title }, 3);
notify(admin._id, 'system', 'userReportEscalated', 'User report escalated', 'A moderator escalated a user report for account review.', '/admin/users', {}, 2, false);

// ---------------------------------------------------------------- audit trail
const audit = (action, actorId, targetType, targetId, severity, days) => ({ action, actorId, targetType, targetId: String(targetId), severity, ipAddress: `196.203.${int(1, 254)}.${int(1, 254)}`, ...stamp(daysAgo(days)) });
const auditEvents = [
  ...teachers.filter(item => item.teacherVerification.status !== 'pending').map((item, index) => audit(`teacher.verification.${item.teacherVerification.status}`, admin._id, 'user', item._id, item.teacherVerification.status === 'rejected' ? 'warning' : 'info', 150 + index)),
  audit('institution.application.approved', admin._id, 'institution-profile', instA._id, 'info', 200),
  audit('institution.application.approved', admin._id, 'institution-profile', instB._id, 'info', 180),
  ...courses.filter(item => item.review.reviewedBy).map((item, index) => audit(item.status === 'rejected' ? 'moderation.course.rejected' : item.status === 'suspended' ? 'moderation.course.suspended' : 'moderation.course.approved', item.review.reviewedBy, 'course', item._id, item.status === 'suspended' ? 'critical' : 'info', 30 + index)),
  audit('payment.order.refunded', admin._id, 'order', refunded._id, 'warning', 22),
  audit('user.status.updated', admin._id, 'user', students[37]._id, 'critical', 12),
  audit('admin.settings.updated', admin._id, 'platform-settings', 'global', 'warning', 90),
  audit('certificate.revoked', admin._id, 'certificate', 'seed', 'critical', 4),
  audit('institution.teacher.member.updated', instA._id, 'teacher', teachers[1]._id, 'info', 20),
  audit('course.co_owners.updated', teachers[0]._id, 'course', courses[0]._id, 'info', 18),
];

// ---------------------------------------------------------------- classes (restricted course) and offline payments
// A 3rd-year class of the Institut Supérieur du Numérique: one course reserved to the class, one public course included.
const restrictedCourse = {
  _id: new ObjectId(), title: 'Systèmes embarqués — supports de 3e année', slug: 'systemes-embarques-3e-annee', subtitle: 'Cours réservé aux étudiants de 3e année ingénieur',
  description: 'Supports du module Systèmes embarqués : architecture des microcontrôleurs, temps réel, bus de communication et projet de fin de module. Réservé à la classe de 3e année.',
  category: 'developpement-web', level: 'advanced', price: 0, rating: 0, ratingCount: 0, studentsCount: 0, tags: ['embarque', 'temps-reel'],
  chapters: [{ id: 'chap_r_0', title: 'Architecture', order: 0, lessons: [
    { id: 'les_r_0', title: 'Microcontrôleurs et périphériques', chapterId: 'chap_r_0', durationMinutes: 30, type: 'text', resources: [], commentsCount: 0, textContent: 'Registres, interruptions, timers et GPIO.' },
    { id: 'les_r_1', title: 'Ordonnancement temps réel', chapterId: 'chap_r_0', durationMinutes: 35, type: 'text', resources: [], commentsCount: 0, textContent: 'Rate Monotonic, EDF et analyse de faisabilité.' },
  ] }],
  hasCertification: false, certificationPathway: 'learning_and_quiz', prerequisites: ['Langage C'], learningOutcomes: ['Programmer un microcontrôleur', 'Concevoir un système temps réel'],
  teacherId: instA._id, coOwnerIds: [teachers[0]._id], status: 'published', visibility: 'restricted', review: { submittedAt: daysAgo(80), reviewedAt: daysAgo(78), reviewedBy: moderators[0]._id, note: '' },
  ...stamp(daysAgo(80)),
};
courses.push(restrictedCourse);
const classMembers = students.slice(20, 28).filter(student => student.status === 'active');
const classCourses = [restrictedCourse, courses[0]];
const classGroups = [
  { ownerId: instA._id, ownerRole: 'institution', name: 'Ingénieur informatique — 3e année', level: '3e année', academicYear: '2026-2027', description: 'Promotion 2027, groupe A.', studentIds: classMembers.map(student => student._id), courseIds: classCourses.map(course => course._id), joinCode: 'ISN3A2027', joinEnabled: true, archivedAt: null, ...stamp(daysAgo(60)) },
  { ownerId: instA._id, ownerRole: 'institution', name: 'Ingénieur informatique — 2e année', level: '2e année', academicYear: '2026-2027', description: 'Promotion 2028.', studentIds: [], courseIds: [], joinCode: 'ISN2A2028', joinEnabled: true, archivedAt: null, ...stamp(daysAgo(60)) },
  { ownerId: teachers[2]._id, ownerRole: 'teacher', name: 'Atelier sécurité du jeudi', level: 'Avancé', academicYear: '2026', description: 'Groupe de préparation OSCP.', studentIds: students.slice(28, 31).map(student => student._id), courseIds: [courses[6]._id], joinCode: 'SECJEU26', joinEnabled: false, archivedAt: null, ...stamp(daysAgo(30)) },
];
for (const group of classGroups) {
  for (const studentId of group.studentIds) for (const courseId of group.courseIds) {
    if (enrollments.some(row => String(row.studentId) === String(studentId) && String(row.courseId) === String(courseId))) continue;
    const enrolledAt = new Date(group.createdAt.getTime() + DAY);
    enrollments.push({ studentId, courseId, completedLessonIds: [], enrolledAt, lastAccessedAt: enrolledAt, completedAt: null, accessType: 'class', accessExpiresAt: null, ...stamp(enrolledAt) });
    const course = courses.find(item => String(item._id) === String(courseId));
    course.studentsCount += 1;
  }
  for (const studentId of group.studentIds) notifications.push({ userId: studentId, type: 'course', title: 'Added to a class', message: `You were added to "${group.name}".`, link: '/student/classes', template: { key: 'classJoined', params: { name: group.name } }, readAt: null, ...stamp(new Date(group.createdAt.getTime() + DAY)) });
}

// Offline payments: a pending cheque request, a desk cash payment and a bank transfer recorded by the finance team.
const offlineOrder = (student, course, method, status, details = {}) => {
  const order = createOrder(student, [lineFor('course', course._id, course.title, course.teacherId, course.price)], details.paidAt || daysAgo(1), status === 'pending' ? 'pending' : 'paid');
  // No provider webhook for offline payments: drop the event recorded by createOrder.
  const eventIndex = paymentEvents.findIndex(event => String(event.orderId) === String(order._id));
  if (eventIndex >= 0) paymentEvents.splice(eventIndex, 1);
  Object.assign(order, { provider: 'offline', paymentMethod: method, providerSessionId: undefined, checkoutUrl: '', idempotencyKey: undefined, expiresAt: new Date(order.createdAt.getTime() + 14 * DAY) });
  if (status === 'pending') order.providerPaymentId = undefined;
  else {
    order.providerPaymentId = `offline-${order._id}`;
    order.offlinePayment = { reference: details.reference || '', bankName: details.bankName || '', payerName: student.name, receivedAt: details.paidAt, note: details.note || '', recordedBy: admin._id, recordedAt: details.paidAt };
    enrollments.push({ studentId: student._id, courseId: course._id, completedLessonIds: [], enrolledAt: details.paidAt, lastAccessedAt: details.paidAt, completedAt: null, accessType: 'purchase', accessExpiresAt: null, ...stamp(details.paidAt) });
    course.studentsCount += 1;
  }
  return order;
};
const notOwned = (student, course) => !enrollments.some(row => String(row.studentId) === String(student._id) && String(row.courseId) === String(course._id));
const offlineCandidates = published.filter(course => course.price > 0);
const pickCourse = student => offlineCandidates.find(course => notOwned(student, course));
offlineOrder(students[13], pickCourse(students[13]), 'cheque', 'pending');
offlineOrder(students[14], pickCourse(students[14]), 'cash', 'paid', { paidAt: daysAgo(6), reference: 'REC-2026-0412', note: 'Payé au guichet de l\'institut.' });
offlineOrder(students[15], pickCourse(students[15]), 'bank_transfer', 'paid', { paidAt: daysAgo(3), reference: 'VIR-88231457', bankName: 'BIAT' });

// ---------------------------------------------------------------- write everything
insert('courses', courses);
students.forEach(student => { if (student.favoriteCourseIds.length) database.users.updateOne({ _id: student._id }, { $set: { favoriteCourseIds: student.favoriteCourseIds } }); });
insert('subscriptions', subscriptions);
insert('subscriptionperiods', periods);
insert('enrollments', enrollments);
insert('lessonactivities', activities);
insert('quizattempts', quizAttempts);
insert('coursereviews', reviews);
insert('exams', exams);
insert('examregistrations', registrations);
insert('examattempts', examAttempts);
insert('inpersonexamresults', examResults);
insert('certificates', certificates);
auditEvents.find(event => event.action === 'certificate.revoked').targetId = certificates[0] ? String(certificates[0]._id) : 'none';
insert('tutoringsessions', sessions);
insert('sessionreviews', sessionReviews);
insert('orders', orders);
insert('paymentevents', paymentEvents);
insert('ledgerentries', ledger);
insert('payoutrequests', payouts);
insert('conversations', conversations);
insert('messages', messages);
insert('forumposts', forumPosts);
insert('forumreplies', forumReplies);
insert('forumvotes', forumVotes);
insert('forumreports', forumReports);
insert('assignments', assignments);
insert('assignmentsubmissions', submissions);
insert('lessonquestions', lessonQuestions);
insert('learningpaths', learningPaths);
insert('supporttickets', supportTickets);
insert('contentreports', contentReports);
insert('notifications', notifications);
insert('auditevents', auditEvents);
insert('classgroups', classGroups);
database.counters.updateOne({ _id: `invoice-${now.getFullYear()}` }, { $max: { seq: invoiceSeq } }, { upsert: true });

print('\nInserted documents:');
Object.entries(inserted).forEach(([name, count]) => print(`  ${name.padEnd(24)} ${count}`));
print(`\nDemo accounts (password: ${DEMO_PASSWORD})`);
print(`  admin        ${admin.email}`);
print(`  moderator    ${moderators[0].email}`);
print(`  teacher      ${teachers[0].email}   (affiliated, co-owned course)`);
print(`  coordinator  ${teachers[1].email}`);
print(`  pending      ${teachers[8].email}   (verification pending)`);
print(`  institution  ${instA.email}`);
print(`  student      ${students[0].email}`);
print(`  subscriber   ${subscribers[1].email}`);
print(`  class join code: ISN3A2027 (3e année, cours réservé « ${restrictedCourse.title} »)`);
print(`  revoked certificate code: ${certificates[0] ? certificates[0].code : '-'}   valid code: ${certificates[1] ? certificates[1].code : '-'}`);
print('\nRe-run the script at any time: previous demo documents are removed first.');
