import { 
  User, 
  Course, 
  Exam, 
  Certificate, 
  TutoringSession, 
  Conversation, 
  ForumPost, 
  Notification, 
  Transaction, 
  SubscriptionPlan, 
  Institution, 
  TeacherVerificationRequest, 
  AuditLog 
} from '../types';

export const mockUsers: Record<string, User> = {
  student: {
    id: 'user_student_1',
    name: 'Karim Benali',
    email: 'karim.benali@student.edu',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    role: 'student',
    status: 'active',
    bio: 'Étudiant passionné par le génie logiciel et les architectures cloud modernes.',
    headline: 'Développeur Full-Stack Junior en formation continue',
    joinedDate: '2025-09-12',
    phone: '+33 6 12 34 56 78',
    unreadNotificationsCount: 3,
    unreadMessagesCount: 2,
  },
  teacher: {
    id: 'user_teacher_1',
    name: 'Dr. Sarah Mansour',
    email: 'sarah.mansour@edumarket.org',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    role: 'teacher',
    status: 'active',
    bio: 'Docteure en Informatique, 12 ans d’expérience en enseignement universitaire et mentorat.',
    headline: 'Professeure Associée en Architectures Logicielles & DevOps',
    joinedDate: '2024-02-15',
    phone: '+33 6 98 76 54 32',
    website: 'https://sarahmansour.dev',
    socials: {
      linkedin: 'https://linkedin.com/in/sarah-mansour',
      github: 'https://github.com/smansour',
    },
    unreadNotificationsCount: 5,
    unreadMessagesCount: 4,
  },
  unverified_teacher: {
    id: 'user_teacher_unverified',
    name: 'Alexandre Dupont',
    email: 'alexandre.dupont@academy.fr',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    role: 'unverified_teacher',
    status: 'pending',
    bio: 'Expert Cybersécurité certifié CISSP, dossier de formateur soumis pour validation.',
    headline: 'Consultant Sécurité des Systèmes d’Information',
    joinedDate: '2026-03-01',
    unreadNotificationsCount: 1,
  },
  institution: {
    id: 'user_institution_1',
    name: 'Institut Polytechnique de l’Innovation',
    email: 'contact@polytechnique-innovation.org',
    avatar: 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=150&auto=format&fit=crop&q=80',
    role: 'institution',
    status: 'active',
    institutionId: 'inst_polytechnique',
    bio: 'Grande école spécialisée dans les nouvelles technologies, l’IA appliquée et l’ingénierie logicielle.',
    headline: 'Pôle d’Excellence Technologique Européen & Méditerranéen',
    joinedDate: '2023-11-10',
    phone: '+33 1 44 55 66 77',
    website: 'https://polytechnique-innovation.org',
    unreadNotificationsCount: 7,
  },
  admin: {
    id: 'user_admin_1',
    name: 'Yassine Belkacem',
    email: 'admin@edumarket.org',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    role: 'admin',
    status: 'active',
    bio: 'Super Administrateur de la plateforme EduMarket LMS.',
    headline: 'Chief Technology & Operations Officer',
    joinedDate: '2023-01-01',
    unreadNotificationsCount: 12,
  },
  moderator: {
    id: 'user_mod_1',
    name: 'Nadia Larbi',
    email: 'moderation@edumarket.org',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
    role: 'moderator',
    status: 'active',
    bio: 'Responsable de la conformité pédagogique, de la modération du forum et de la qualité des cours.',
    headline: 'Responsable Assurance Qualité & Modération',
    joinedDate: '2024-05-18',
    unreadNotificationsCount: 4,
  },
};

export const mockCategories = [
  { id: 'cat_dev', name: 'Développement Web & Cloud', icon: 'Code', coursesCount: 48 },
  { id: 'cat_ai', name: 'Intelligence Artificielle & Data', icon: 'Cpu', coursesCount: 36 },
  { id: 'cat_cyber', name: 'Cybersécurité & Réseaux', icon: 'Shield', coursesCount: 22 },
  { id: 'cat_business', name: 'Management & Entrepreneuriat', icon: 'Briefcase', coursesCount: 30 },
  { id: 'cat_design', name: 'Design UX/UI & Création', icon: 'Palette', coursesCount: 19 },
  { id: 'cat_languages', name: 'Langues & Communication', icon: 'Languages', coursesCount: 25 },
];

export const mockCourses: Course[] = [
  {
    id: 'course_react_node',
    slug: 'architectures-react-node-production',
    title: 'Architectures Modernes React 19 & Node.js pour la Production',
    subtitle: 'Concevez des plateformes SaaS scalables, résilientes et hautement disponibles.',
    description: 'Une formation complète guidée pas à pas, des fondamentaux aux micro-frontends, optimisations de performance, authentification JWT/OAuth2 et déploiement conteneurisé.',
    coverImage: 'https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=800&auto=format&fit=crop&q=80',
    category: 'Développement Web & Cloud',
    subCategory: 'Frontend & Backend',
    tags: ['React', 'TypeScript', 'Node.js', 'Clean Architecture', 'API REST'],
    level: 'intermediate',
    price: 89,
    isFree: false,
    discountPrice: 69,
    rating: 4.9,
    ratingCount: 342,
    studentsCount: 1840,
    totalDurationMinutes: 1420,
    language: 'Français',
    teacherId: 'user_teacher_1',
    teacherName: 'Dr. Sarah Mansour',
    teacherAvatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    teacherTitle: 'Docteure en Informatique & Formatrice Senior',
    institutionId: 'inst_polytechnique',
    institutionName: 'Institut Polytechnique de l’Innovation',
    status: 'published',
    hasCertification: true,
    certificationPathway: 'learning_and_quiz',
    prerequisites: ['Bases solides en JavaScript ES6+', 'Familiarité avec Git et la ligne de commande'],
    learningOutcomes: [
      'Maîtriser les composants React 19 et les Hooks avancés',
      'Structurer une application en Atomic Design strict',
      'Créer des API sécurisées avec Express, TypeScript et Zod',
      'Déployer avec pipeline CI/CD automatisé'
    ],
    updatedAt: '2026-02-28',
    chapters: [
      {
        id: 'chap_1',
        title: 'Chapitre 1 : Fondations Architecturales & Design System',
        order: 1,
        lessons: [
          {
            id: 'les_1_1',
            chapterId: 'chap_1',
            title: 'Introduction et principes SOLID en Frontend',
            durationMinutes: 18,
            type: 'video',
            videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
            completed: true,
            commentsCount: 14,
            resources: [
              { id: 'res_1', title: 'Guide d’Architecture Clean.pdf', type: 'pdf', size: '2.4 MB', url: '#' },
              { id: 'res_2', title: 'starter-boilerplate.zip', type: 'zip', size: '14 MB', url: '#' }
            ]
          },
          {
            id: 'les_1_2',
            chapterId: 'chap_1',
            title: 'Mise en place de l’Atomic Design et conventions de nommage',
            durationMinutes: 24,
            type: 'text',
            textContent: `L'Atomic Design décompose l'interface en cinq niveaux cohérents :
1. Atomes : boutons, champs de saisie, badges, icônes sans logique métier.
2. Molécules : combinaisons d'atomes, ex: SearchField avec bouton et icône.
3. Organismes : blocs complets autonomes, ex: Header, Card de cours, Tableau de données.
4. Gabarits (Templates) : squelettes de mise en page réutilisables.
5. Pages : instances réelles nourries par des données dynamiques.`,
            completed: true,
            commentsCount: 8,
            resources: []
          },
          {
            id: 'les_1_3',
            chapterId: 'chap_1',
            title: 'Évaluation formative du Chapitre 1',
            durationMinutes: 15,
            type: 'interactive',
            completed: false,
            commentsCount: 3,
            resources: [],
            quiz: {
              id: 'quiz_chap_1',
              title: 'Quiz : Architectures & Atomic Design',
              durationMinutes: 15,
              passPercentage: 80,
              questions: [
                {
                  id: 'q_1',
                  question: 'Quel niveau de l’Atomic Design assemble plusieurs atomes simples sans former un bloc métier complet ?',
                  options: ['Les molécules', 'Les gabarits', 'Les pages', 'Les organismes'],
                  correctOptionIndex: 0,
                  explanation: 'Une molécule est le premier niveau d’assemblage combinant des atomes (ex: label + input + message d’erreur).'
                },
                {
                  id: 'q_2',
                  question: 'Quelle est la règle d’or d’un atome en Atomic Design ?',
                  options: [
                    'Il doit appeler directement l’API backend',
                    'Il doit être pur et dépourvu de logique métier complexe',
                    'Il doit obligatoirement être un composant de page',
                    'Il ne peut jamais recevoir de props'
                  ],
                  correctOptionIndex: 1,
                  explanation: 'Les atomes sont des composants élémentaires et réutilisables sans dépendance métier.'
                }
              ]
            }
          }
        ]
      },
      {
        id: 'chap_2',
        title: 'Chapitre 2 : Gestion d’État, Cache & API MERN',
        order: 2,
        lessons: [
          {
            id: 'les_2_1',
            chapterId: 'chap_2',
            title: 'Couche de services et découplage des appels réseau',
            durationMinutes: 32,
            type: 'video',
            videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
            completed: false,
            commentsCount: 6,
            resources: [
              { id: 'res_3', title: 'apiClient-axios-setup.ts', type: 'code', size: '12 KB', url: '#' }
            ]
          },
          {
            id: 'les_2_2',
            chapterId: 'chap_2',
            title: 'Gestion des erreurs globales et intercepteurs de requêtes',
            durationMinutes: 20,
            type: 'text',
            textContent: `Pour garantir la robustesse d'une application professionnelle, tous les appels réseau transitent par une instance centralisée dotée d'intercepteurs.
En cas de code 401, le token est automatiquement renouvelé ou la session expirée gérée avec redirection propre.`,
            completed: false,
            commentsCount: 4,
            resources: []
          }
        ]
      }
    ]
  },
  {
    id: 'course_ai_llm',
    slug: 'ingenierie-ia-agents-autonomes',
    title: 'Ingénierie de l’Intelligence Artificielle & Systèmes d’Agents',
    subtitle: 'Concevez des pipelines RAG, agents autonomes avec Function Calling et LLM multimodaux.',
    description: 'Une plongée approfondie dans les modèles de fondation, vector databases, prompt engineering rigoureux et déploiement d’architectures d’agents cognitifs.',
    coverImage: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&auto=format&fit=crop&q=80',
    category: 'Intelligence Artificielle & Data',
    tags: ['GenAI', 'LLM', 'Python', 'Agents', 'RAG', 'VectorDB'],
    level: 'advanced',
    price: 120,
    isFree: false,
    rating: 4.95,
    ratingCount: 215,
    studentsCount: 1120,
    totalDurationMinutes: 1860,
    language: 'Français',
    teacherId: 'user_teacher_1',
    teacherName: 'Dr. Sarah Mansour',
    teacherAvatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    teacherTitle: 'Docteure en Informatique & Formatrice Senior',
    status: 'published',
    hasCertification: true,
    certificationPathway: 'online_exam',
    examId: 'exam_ai_pro',
    prerequisites: ['Python intermédiaire', 'Notions de base en machine learning'],
    learningOutcomes: [
      'Concevoir des architectures RAG avancées avec reranking',
      'Orchestrer des agents autonomes multi-étapes',
      'Optimiser la latence et les coûts d’inférence'
    ],
    updatedAt: '2026-03-04',
    chapters: [
      {
        id: 'chap_ai_1',
        title: 'Chapitre 1 : Fondamentaux des Transformers & Modèles Multimodaux',
        order: 1,
        lessons: [
          {
            id: 'les_ai_1_1',
            chapterId: 'chap_ai_1',
            title: 'Architecture Attention is All You Need décortiquée',
            durationMinutes: 45,
            type: 'video',
            videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
            completed: false,
            commentsCount: 19,
            resources: []
          }
        ]
      }
    ]
  },
  {
    id: 'course_cyber_defense',
    slug: 'fondamentaux-cybersecurite-soc',
    title: 'Défense Opérationnelle des Systèmes & Analyse SOC',
    subtitle: 'Apprenez à détecter, neutraliser et enquêter sur les menaces informatiques avancées.',
    description: 'Programme certifiant reconnu par les institutions partenaires, avec exercices pratiques de capture the flag et simulation d’attaques.',
    coverImage: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=800&auto=format&fit=crop&q=80',
    category: 'Cybersécurité & Réseaux',
    tags: ['Cybersecurity', 'SOC', 'SIEM', 'Threat Intelligence', 'Forensics'],
    level: 'beginner',
    price: 0,
    isFree: true,
    rating: 4.8,
    ratingCount: 154,
    studentsCount: 3400,
    totalDurationMinutes: 890,
    language: 'Français',
    teacherId: 'user_teacher_unverified',
    teacherName: 'Alexandre Dupont',
    teacherAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    teacherTitle: 'Consultant Sécurité CISSP',
    institutionId: 'inst_polytechnique',
    institutionName: 'Institut Polytechnique de l’Innovation',
    status: 'published',
    hasCertification: true,
    certificationPathway: 'in_person_exam',
    examId: 'exam_cyber_inperson',
    prerequisites: ['Connaissances de base des réseaux TCP/IP'],
    learningOutcomes: [
      'Identifier les vecteurs d’attaque web et systèmes',
      'Configurer des règles de détection SIEM',
      'Appliquer les normes de protection des données'
    ],
    updatedAt: '2026-01-15',
    chapters: [
      {
        id: 'chap_cyb_1',
        title: 'Chapitre 1 : Vecteurs de menaces contemporains',
        order: 1,
        lessons: [
          {
            id: 'les_cyb_1_1',
            chapterId: 'chap_cyb_1',
            title: 'Top 10 OWASP et contre-mesures opérationnelles',
            durationMinutes: 30,
            type: 'text',
            textContent: 'Présentation détaillée des vulnérabilités d’injection, de mauvaises configurations et de failles cryptographiques.',
            completed: false,
            commentsCount: 5,
            resources: []
          }
        ]
      }
    ]
  }
];

export const mockExams: Exam[] = [
  {
    id: 'exam_ai_pro',
    courseId: 'course_ai_llm',
    courseTitle: 'Ingénierie de l’Intelligence Artificielle & Systèmes d’Agents',
    title: 'Examen de Certification Officielle : Ingénieur IA & Agents',
    description: 'Épreuve surveillée de 60 minutes avec questions à choix multiple et analyse de code complexe.',
    type: 'online',
    fee: 45,
    durationMinutes: 60,
    passPercentage: 75,
    totalQuestions: 30,
    isEnrolled: true,
  },
  {
    id: 'exam_cyber_inperson',
    courseId: 'course_cyber_defense',
    courseTitle: 'Défense Opérationnelle des Systèmes & Analyse SOC',
    title: 'Examen Pratique Présentiel : Analyste SOC Niveau 1',
    description: 'Épreuve sur site surveillée par l’Institut Polytechnique dans un laboratoire informatique accrédité.',
    type: 'in_person',
    fee: 90,
    durationMinutes: 180,
    passPercentage: 70,
    totalQuestions: 10,
    date: '2026-05-20 à 09:30',
    location: {
      venue: 'Campus Polytechnique - Bâtiment Turing, Salle Lab 402',
      address: '15 Boulevard des Sciences Appliquées',
      city: 'Paris / Saclay',
      capacity: 35,
      enrolledCount: 22
    },
    isEnrolled: false
  }
];

export const mockCertificates: Certificate[] = [
  {
    id: 'cert_109283',
    code: 'EDUM-2026-FR-98214',
    userId: 'user_student_1',
    userName: 'Karim Benali',
    courseId: 'course_react_node',
    courseTitle: 'Architectures Modernes React 19 & Node.js pour la Production',
    issueDate: '2026-02-14',
    grade: 'Mention Très Bien (94%)',
    instructorName: 'Dr. Sarah Mansour',
    institutionName: 'Institut Polytechnique de l’Innovation',
    verificationUrl: 'https://edumarket.org/verify/EDUM-2026-FR-98214'
  }
];

export const mockTutoringSessions: TutoringSession[] = [
  {
    id: 'session_1',
    teacherId: 'user_teacher_1',
    teacherName: 'Dr. Sarah Mansour',
    teacherAvatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    studentId: 'user_student_1',
    studentName: 'Karim Benali',
    studentAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    subject: 'Revue de code & Optimisation performance React 19',
    notes: 'Discussion sur le Server-Side Rendering et la gestion de la mémoire dans les gros tableaux.',
    type: 'online',
    status: 'confirmed',
    date: '2026-10-18',
    startTime: '14:00',
    endTime: '15:00',
    durationMinutes: 60,
    price: 45,
    jitsiRoomId: 'edumarket-session-sarah-karim-771',
    googleCalendarSynced: true,
  },
  {
    id: 'session_2',
    teacherId: 'user_teacher_1',
    teacherName: 'Dr. Sarah Mansour',
    teacherAvatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    studentId: 'user_student_1',
    studentName: 'Karim Benali',
    studentAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    subject: 'Atelier de préparation à l’examen de certification',
    notes: 'Rencontre présentielle pour mise en pratique sur banc de test.',
    type: 'in_person',
    status: 'pending',
    date: '2026-10-24',
    startTime: '10:00',
    endTime: '12:00',
    durationMinutes: 120,
    price: 80,
    location: {
      venue: 'Médiathèque Centrale de l’Innovation, Espace Coworking',
      address: '24 Avenue des Pépinières',
      city: 'Lyon'
    },
    googleCalendarSynced: false
  }
];

export const mockConversations: Conversation[] = [
  {
    id: 'conv_1',
    participants: [mockUsers.student, mockUsers.teacher],
    unreadCount: 1,
    updatedAt: '2026-10-13T14:30:00Z',
    lastMessage: {
      id: 'msg_3',
      conversationId: 'conv_1',
      senderId: 'user_teacher_1',
      text: 'Bonjour Karim ! Le support de cours complémentaire a été mis à jour.',
      timestamp: '2026-10-13T14:30:00Z',
      read: false
    }
  }
];

export const mockForumPosts: ForumPost[] = [
  {
    id: 'post_1',
    title: 'Comment configurer correctement i18next avec l’inversion RTL sous Tailwind 4 ?',
    content: 'Bonjour à tous, lors du passage en langue arabe (ar), certaines icônes de flèche doivent être inversées alors que les nombres doivent rester LTR. Quelle est la meilleure approche d’Atomic Design ?',
    category: 'Développement Web & Cloud',
    authorId: 'user_student_1',
    authorName: 'Karim Benali',
    authorAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    authorRole: 'Étudiant',
    createdAt: '2026-10-10T09:15:00Z',
    upvotes: 24,
    repliesCount: 3,
    isSolved: true,
    viewsCount: 380,
    tags: ['i18n', 'RTL', 'React', 'Tailwind']
  },
  {
    id: 'post_2',
    title: 'Conseils pour réussir l’examen en présentiel d’analyste SOC',
    content: 'Quels sont les outils indispensables à réviser (Wireshark, Splunk, règles Sigma) pour l’épreuve pratique de 3 heures ?',
    category: 'Cybersécurité & Réseaux',
    authorId: 'user_student_1',
    authorName: 'Karim Benali',
    authorAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    authorRole: 'Étudiant',
    createdAt: '2026-10-11T16:40:00Z',
    upvotes: 18,
    repliesCount: 5,
    isSolved: false,
    viewsCount: 290,
    tags: ['SOC', 'Certification', 'Exam']
  }
];

export const mockNotifications: Notification[] = [
  {
    id: 'notif_1',
    userId: 'user_student_1',
    type: 'course',
    title: 'Nouveau chapitre disponible',
    message: 'Le Dr. Sarah Mansour a publié le Chapitre 2 de la formation React 19.',
    timestamp: '2026-10-13T11:00:00Z',
    read: false,
    link: '/courses/course_react_node'
  },
  {
    id: 'notif_2',
    userId: 'user_student_1',
    type: 'session',
    title: 'Séance de tutorat confirmée',
    message: 'Votre session en visioconférence pour le 18 octobre est validée.',
    timestamp: '2026-10-12T15:20:00Z',
    read: false,
    link: '/sessions'
  },
  {
    id: 'notif_3',
    userId: 'user_student_1',
    type: 'certificate',
    title: 'Félicitations pour votre certification',
    message: 'Votre certificat officiel #EDUM-2026-FR-98214 est disponible au téléchargement.',
    timestamp: '2026-10-10T18:45:00Z',
    read: true,
    link: '/student/certificates'
  }
];

export const mockTransactions: Transaction[] = [
  {
    id: 'tx_98124',
    date: '2026-10-02',
    amount: 69,
    currency: 'EUR',
    status: 'succeeded',
    type: 'course_purchase',
    itemName: 'Architectures Modernes React 19 & Node.js',
    sellerCommission: 55.20,
    platformFee: 13.80,
    paymentMethod: 'Carte bancaire (•••• 4242)',
    invoiceUrl: '#',
    userId: 'user_student_1',
    userName: 'Karim Benali'
  },
  {
    id: 'tx_98125',
    date: '2026-09-15',
    amount: 45,
    currency: 'EUR',
    status: 'succeeded',
    type: 'tutoring_session',
    itemName: 'Séance de mentorat (1h)',
    sellerCommission: 38.25,
    platformFee: 6.75,
    paymentMethod: 'PayPal',
    invoiceUrl: '#',
    userId: 'user_student_1',
    userName: 'Karim Benali'
  }
];

export const mockSubscriptionPlans: SubscriptionPlan[] = [
  {
    id: 'plan_starter',
    name: 'Étudiant Découverte',
    description: 'Idéal pour débuter et explorer les cours fondamentaux',
    priceMonthly: 0,
    priceYearly: 0,
    features: [
      'Accès à tous les cours gratuits',
      'Participation aux forums de discussion',
      'Quiz formatifs avec correction automatique',
      'Support communautaire'
    ]
  },
  {
    id: 'plan_pro',
    name: 'Apprenant Pro',
    description: 'Pour les professionnels visant une montée en compétences accélérée',
    priceMonthly: 29,
    priceYearly: 279,
    popular: true,
    currentPlan: true,
    features: [
      'Accès illimité à l’ensemble du catalogue',
      'Certificats officiels vérifiables sans surcoût',
      '1 séance de tutorat mensuelle offerte',
      'Support technique et pédagogique prioritaire',
      'Accès aux corrigés détaillés et codes sources'
    ]
  },
  {
    id: 'plan_institution',
    name: 'Établissement & Entreprise',
    description: 'Solution globale pour institutions et équipes techniques',
    priceMonthly: 199,
    priceYearly: 1990,
    features: [
      'Jusqu’à 50 comptes apprenants & enseignants',
      'Organisation d’examens présentiels et en ligne',
      'Dashboard analytique d’assiduité et de résultats',
      'Marque blanche pour les certificats délivrés',
      'Gestionnaire de compte dédié'
    ]
  }
];

export const mockInstitutions: Institution[] = [
  {
    id: 'inst_polytechnique',
    name: 'Institut Polytechnique de l’Innovation',
    slug: 'institut-polytechnique-innovation',
    logo: 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=150&auto=format&fit=crop&q=80',
    banner: 'https://images.unsplash.com/photo-1541339907198-e08756dedf3f?w=1200&auto=format&fit=crop&q=80',
    description: 'Établissement d’enseignement supérieur d’élite formant les futurs leaders technologiques et ingénieurs de renommée mondiale.',
    country: 'France',
    city: 'Paris',
    website: 'https://polytechnique-innovation.org',
    verified: true,
    teachersCount: 42,
    coursesCount: 38,
    studentsCount: 6200,
    rating: 4.9,
    joinedDate: '2023-11-10',
    contactEmail: 'admissions@polytechnique-innovation.org'
  }
];

export const mockVerificationRequests: TeacherVerificationRequest[] = [
  {
    id: 'req_1',
    teacherId: 'user_teacher_unverified',
    teacherName: 'Alexandre Dupont',
    email: 'alexandre.dupont@academy.fr',
    specialty: 'Cybersécurité & Audit de Systèmes',
    submittedAt: '2026-03-01T10:00:00Z',
    status: 'pending',
    documents: [
      { name: 'Diplôme_Master_Ingénieur.pdf', type: 'Diplôme', url: '#' },
      { name: 'Certificat_CISSP_2025.pdf', type: 'Certification', url: '#' },
      { name: 'Piece_Identite_Passeport.pdf', type: 'Identité', url: '#' }
    ],
    notes: 'Expérience de 8 ans comme analyste RSSI.'
  }
];

export const mockAuditLogs: AuditLog[] = [
  {
    id: 'log_1',
    action: 'USER_LOGIN_SUCCESS',
    performedBy: 'admin@edumarket.org',
    target: 'Session #8912',
    ipAddress: '192.168.1.104',
    timestamp: '2026-10-13T16:05:00Z',
    severity: 'info'
  },
  {
    id: 'log_2',
    action: 'COURSE_PUBLISHED',
    performedBy: 'sarah.mansour@edumarket.org',
    target: 'Course #course_react_node',
    ipAddress: '82.65.120.4',
    timestamp: '2026-10-12T11:22:00Z',
    severity: 'info'
  },
  {
    id: 'log_3',
    action: 'ROLE_MODIFIED',
    performedBy: 'admin@edumarket.org',
    target: 'User #user_teacher_1 (teacher)',
    ipAddress: '192.168.1.104',
    timestamp: '2026-10-09T08:14:00Z',
    severity: 'warning'
  }
];
