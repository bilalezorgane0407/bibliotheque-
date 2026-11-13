import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { hashPassword } from '../auth/password.ts';

export function createDatabase(dbPath?: string): Database.Database {
  const targetPath = dbPath || process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'biblioest.db');
  if (targetPath !== ':memory:') {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }

  const db = new Database(targetPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  initSchema(db);
  return db;
}

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      fullName TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('membre', 'bibliothecaire')),
      institution TEXT NOT NULL,
      studentStatus TEXT NOT NULL CHECK (studentStatus IN ('verifie', 'en_attente', 'non_est', 'suspendu')),
      accountStatus TEXT NOT NULL CHECK (accountStatus IN ('actif', 'suspendu')),
      cne TEXT,
      filiere TEXT,
      authSource TEXT NOT NULL DEFAULT 'local' CHECK (authSource IN ('local', 'usmba_sso')),
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_registrations (
      email TEXT PRIMARY KEY,
      fullName TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      cne TEXT,
      filiere TEXT,
      codeHash TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      lastSentAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      authors TEXT NOT NULL,
      isbn TEXT,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      publisher TEXT NOT NULL,
      publicationYear INTEGER NOT NULL,
      edition TEXT NOT NULL,
      language TEXT NOT NULL,
      coverImage TEXT NOT NULL,
      shelfLocation TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      featured INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS copies (
      id TEXT PRIMARY KEY,
      bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      barcode TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('Disponible', 'Emprunté', 'Réservé', 'En réparation', 'Retiré définitivement')),
      physicalCondition TEXT NOT NULL CHECK (physicalCondition IN ('Neuf', 'Bon état', 'Usure légère', 'Endommagé', 'Hors service')),
      location TEXT NOT NULL,
      needsInspection INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY,
      memberId TEXT NOT NULL REFERENCES users(id),
      copyId TEXT NOT NULL REFERENCES copies(id),
      bookId TEXT NOT NULL REFERENCES books(id),
      borrowedAt TEXT NOT NULL,
      dueAt TEXT NOT NULL,
      returnedAt TEXT,
      returnCondition TEXT,
      returnNotes TEXT,
      status TEXT NOT NULL CHECK (status IN ('En cours', 'Retourné', 'En retard'))
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      memberId TEXT NOT NULL REFERENCES users(id),
      bookId TEXT NOT NULL REFERENCES books(id),
      requestedAt TEXT NOT NULL,
      queuePosition INTEGER,
      status TEXT NOT NULL CHECK (status IN ('En attente', 'Disponible pour retrait', 'Retirée', 'Annulée', 'Expirée')),
      assignedCopyId TEXT REFERENCES copies(id),
      availableAt TEXT,
      pickupDeadline TEXT,
      completedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      readAt TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_copies_book_status ON copies(bookId, status);
    CREATE INDEX IF NOT EXISTS idx_loans_member_status ON loans(memberId, status);
    CREATE INDEX IF NOT EXISTS idx_loans_copy_status ON loans(copyId, status);
    CREATE INDEX IF NOT EXISTS idx_reservations_book_status_req ON reservations(bookId, status, requestedAt);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(userId, createdAt DESC);
  `);

  const demoAddressMigrations = [
    ['usr-salma', 'salma.bennani@usmba.ac.ma', 'salma.demo@usmba.example'],
    ['usr-bilale', 'bilale.zorgane@usmba.ac.ma', 'bilale.demo@usmba.example'],
    ['usr-youssef', 'youssef.alaoui@usmba.ac.ma', 'youssef.demo@usmba.example'],
    ['usr-karim', 'karim.tazi@usmba.ac.ma', 'karim.demo@usmba.example'],
    ['usr-lib', 'bibliothecaire@est-usmba.ac.ma', 'bibliothecaire.demo@est-usmba.example'],
  ];
  const migrateDemoAddress = db.prepare('UPDATE users SET email = ? WHERE id = ? AND LOWER(email) = ?');
  for (const [id, oldEmail, demoEmail] of demoAddressMigrations) {
    migrateDemoAddress.run(demoEmail, id, oldEmail);
  }
}

export function seedDatabaseIfEmpty(db: Database.Database, nowDate: Date = new Date()): void {
  const existingUsers = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (existingUsers.count > 0) return;

  const isoOffset = (daysOffset: number): string => {
    return new Date(nowDate.getTime() + daysOffset * 24 * 60 * 60 * 1000).toISOString();
  };

  const seed = db.transaction(() => {
    const insertUser = db.prepare(`
      INSERT INTO users (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, cne, filiere, authSource, createdAt)
      VALUES (@id, @fullName, @email, @passwordHash, @role, @institution, @studentStatus, @accountStatus, @cne, @filiere, @authSource, @createdAt)
    `);

    const studentHash = hashPassword('EtudiantEST2026!');
    const librarianHash = hashPassword('BiblioAdmin2026!');

    const users = [
      {
        id: 'usr-salma',
        fullName: 'Salma Bennani',
        email: 'salma.demo@usmba.example',
        passwordHash: studentHash,
        role: 'membre',
        institution: 'EST Fès',
        studentStatus: 'verifie',
        accountStatus: 'actif',
        cne: 'N134089211',
        filiere: 'Génie Informatique',
        authSource: 'local',
        createdAt: isoOffset(-60),
      },
      {
        id: 'usr-bilale',
        fullName: 'Bilale Zorgane',
        email: 'bilale.demo@usmba.example',
        passwordHash: studentHash,
        role: 'membre',
        institution: 'EST Fès',
        studentStatus: 'verifie',
        accountStatus: 'actif',
        cne: 'N139845120',
        filiere: 'Génie Informatique',
        authSource: 'local',
        createdAt: isoOffset(-45),
      },
      {
        id: 'usr-youssef',
        fullName: 'Youssef El Alaoui',
        email: 'youssef.demo@usmba.example',
        passwordHash: studentHash,
        role: 'membre',
        institution: 'EST Fès',
        studentStatus: 'verifie',
        accountStatus: 'actif',
        cne: 'N132004518',
        filiere: 'Génie Électrique',
        authSource: 'local',
        createdAt: isoOffset(-50),
      },
      {
        id: 'usr-karim',
        fullName: 'Karim Tazi',
        email: 'karim.demo@usmba.example',
        passwordHash: studentHash,
        role: 'membre',
        institution: 'EST Fès',
        studentStatus: 'en_attente',
        accountStatus: 'actif',
        cne: 'N141223980',
        filiere: 'Techniques de Management',
        authSource: 'local',
        createdAt: isoOffset(-10),
      },
      {
        id: 'usr-lib',
        fullName: 'Nadia Benjelloun',
        email: 'bibliothecaire.demo@est-usmba.example',
        passwordHash: librarianHash,
        role: 'bibliothecaire',
        institution: 'EST Fès',
        studentStatus: 'verifie',
        accountStatus: 'actif',
        cne: null,
        filiere: 'Direction de la Bibliothèque EST Fès',
        authSource: 'local',
        createdAt: isoOffset(-120),
      },
    ];

    for (const u of users) insertUser.run(u);

    const insertBook = db.prepare(`
      INSERT INTO books (id, title, authors, isbn, category, description, publisher, publicationYear, edition, language, coverImage, shelfLocation, archived, featured, createdAt)
      VALUES (@id, @title, @authors, @isbn, @category, @description, @publisher, @publicationYear, @edition, @language, @coverImage, @shelfLocation, @archived, @featured, @createdAt)
    `);

    const books = [
      {
        id: 'bk-algo',
        title: 'Algorithmique et Structures de Données Avancées',
        authors: 'Thomas H. Cormen, Charles E. Leiserson',
        isbn: '978-2-10-082451-9',
        category: 'Génie Informatique',
        description:
          'Ouvrage de référence pour le cycle DUT et Licence Professionnelle à l’EST Fès. Couvre l’analyse de complexité, les arbres équilibrés, les graphes orientés, la programmation dynamique et les algorithmes gloutons avec preuves formelles.',
        publisher: 'Dunod',
        publicationYear: 2023,
        edition: '4e édition',
        language: 'Français',
        coverImage: '/src/assets/images/cover_informatique_1794527753411.jpg',
        shelfLocation: 'INF-01-A',
        archived: 0,
        featured: 1,
        createdAt: isoOffset(-40),
      },
      {
        id: 'bk-sys-dist',
        title: 'Architecture des Systèmes Distribués et Réseaux',
        authors: 'Andrew S. Tanenbaum, Maarten van Steen',
        isbn: '978-2-7440-7652-7',
        category: 'Génie Informatique',
        description:
          'Étude approfondie des protocoles TCP/IP, du routage, de la réplication cohérente, des microservices et de la tolérance aux pannes dans les architectures universitaires et industrielles.',
        publisher: 'Pearson France',
        publicationYear: 2024,
        edition: '5e édition',
        language: 'Français',
        coverImage: '/src/assets/images/cover_informatique_1794527753411.jpg',
        shelfLocation: 'INF-03-C',
        archived: 0,
        featured: 1,
        createdAt: isoOffset(-15),
      },
      {
        id: 'bk-auto',
        title: 'Automatique Industrielle et Régulation PID',
        authors: 'Patrick Prouvost',
        isbn: '978-2-10-081203-5',
        category: 'Génie Électrique',
        description:
          'Modélisation des systèmes asservis continus et échantillonnés, critères de stabilité de Nyquist et Routh-Hurwitz, synthèse des correcteurs PID et travaux pratiques sur automates programmables.',
        publisher: 'Dunod — Sciences Sup',
        publicationYear: 2022,
        edition: '3e édition',
        language: 'Français',
        coverImage: '/src/assets/images/cover_genie_electrique_1794527754591.jpg',
        shelfLocation: 'GEL-02-B',
        archived: 0,
        featured: 1,
        createdAt: isoOffset(-30),
      },
      {
        id: 'bk-elec-puiss',
        title: 'Électronique de Puissance et Convertisseurs Statiques',
        authors: 'Guy Séguier, Francis Labrique',
        isbn: '978-2-10-079812-4',
        category: 'Génie Électrique',
        description:
          'Analyse complète des redresseurs commandés, hacheurs, onduleurs triphasés et variateurs de vitesse destinés aux filières Électrotechnique et Systèmes Embarqués.',
        publisher: 'Lavoisier Tec & Doc',
        publicationYear: 2021,
        edition: '10e édition',
        language: 'Français',
        coverImage: '/src/assets/images/cover_genie_electrique_1794527754591.jpg',
        shelfLocation: 'GEL-05-A',
        archived: 0,
        featured: 0,
        createdAt: isoOffset(-25),
      },
      {
        id: 'bk-comptabilite',
        title: 'Comptabilité Analytique et Contrôle de Gestion',
        authors: 'Béatrice Grandguillot, Francis Grandguillot',
        isbn: '978-2-297-17654-3',
        category: 'Techniques de Management',
        description:
          'Méthodes des coûts complets, coûts partiels, seuils de rentabilité, gestion budgétaire et tableaux de bord appliqués au contexte des entreprises marocaines.',
        publisher: 'Gualino',
        publicationYear: 2024,
        edition: '24e édition',
        language: 'Français',
        coverImage: '/src/assets/images/cover_gestion_economie_1794527755509.jpg',
        shelfLocation: 'TMG-01-D',
        archived: 0,
        featured: 1,
        createdAt: isoOffset(-12),
      },
      {
        id: 'bk-meca',
        title: 'Résistance des Matériaux et Conception Mécanique',
        authors: 'Jean-Louis Fanchon',
        isbn: '978-2-09-167420-9',
        category: 'Génie Mécanique',
        description:
          'Traction, compression, torsion, flexion simple et composée, flambement et dimensionnement des assemblages industriels selon les normes en vigueur.',
        publisher: 'Nathan Technique',
        publicationYear: 2022,
        edition: 'Édition révisée',
        language: 'Français',
        coverImage: '/src/assets/images/cover_genie_mecanique_1794527754806.jpg',
        shelfLocation: 'GME-04-A',
        archived: 0,
        featured: 0,
        createdAt: isoOffset(-20),
      },
      {
        id: 'bk-maths',
        title: 'Analyse Numérique et Probabilités pour l’Ingénieur',
        authors: 'Jean-Pierre Demailly, Grégoire Allaire',
        isbn: '978-2-7598-2814-2',
        category: 'Mathématiques & Génie des Procédés',
        description:
          'Méthodes d’interpolation, résolution numérique d’équations différentielles, calcul matriciel et lois de probabilité appliquées à la modélisation technique.',
        publisher: 'EDP Sciences',
        publicationYear: 2025,
        edition: '2e édition',
        language: 'Français',
        coverImage: '/src/assets/images/cover_mathematiques_1794527754705.jpg',
        shelfLocation: 'MAT-02-A',
        archived: 0,
        featured: 0,
        createdAt: isoOffset(-5),
      },
    ];

    for (const b of books) insertBook.run(b);

    const insertCopy = db.prepare(`
      INSERT INTO copies (id, bookId, barcode, status, physicalCondition, location, needsInspection, createdAt)
      VALUES (@id, @bookId, @barcode, @status, @physicalCondition, @location, @needsInspection, @createdAt)
    `);

    const copies = [
      // bk-algo: 2 available, 1 borrowed
      {
        id: 'cp-algo-1',
        bookId: 'bk-algo',
        barcode: 'EST-INF-0001',
        status: 'Disponible',
        physicalCondition: 'Neuf',
        location: 'Salle Lecture A · INF-01-A',
        needsInspection: 0,
        createdAt: isoOffset(-40),
      },
      {
        id: 'cp-algo-2',
        bookId: 'bk-algo',
        barcode: 'EST-INF-0002',
        status: 'Disponible',
        physicalCondition: 'Bon état',
        location: 'Salle Lecture A · INF-01-A',
        needsInspection: 0,
        createdAt: isoOffset(-40),
      },
      {
        id: 'cp-algo-3',
        bookId: 'bk-algo',
        barcode: 'EST-INF-0003',
        status: 'Emprunté',
        physicalCondition: 'Bon état',
        location: 'Salle Lecture A · INF-01-A',
        needsInspection: 0,
        createdAt: isoOffset(-40),
      },

      // bk-sys-dist: 0 available! 2 borrowed (great for testing reservation!)
      {
        id: 'cp-sys-1',
        bookId: 'bk-sys-dist',
        barcode: 'EST-INF-0101',
        status: 'Emprunté',
        physicalCondition: 'Bon état',
        location: 'Salle Lecture A · INF-03-C',
        needsInspection: 0,
        createdAt: isoOffset(-15),
      },
      {
        id: 'cp-sys-2',
        bookId: 'bk-sys-dist',
        barcode: 'EST-INF-0102',
        status: 'Emprunté',
        physicalCondition: 'Usure légère',
        location: 'Salle Lecture A · INF-03-C',
        needsInspection: 0,
        createdAt: isoOffset(-15),
      },

      // bk-auto: 1 available, 1 in repair
      {
        id: 'cp-auto-1',
        bookId: 'bk-auto',
        barcode: 'EST-GEL-0201',
        status: 'Disponible',
        physicalCondition: 'Bon état',
        location: 'Rayon Sciences · GEL-02-B',
        needsInspection: 0,
        createdAt: isoOffset(-30),
      },
      {
        id: 'cp-auto-2',
        bookId: 'bk-auto',
        barcode: 'EST-GEL-0202',
        status: 'En réparation',
        physicalCondition: 'Endommagé',
        location: 'Atelier Reliure',
        needsInspection: 1,
        createdAt: isoOffset(-30),
      },

      // bk-elec-puiss: 1 available, 1 permanently withdrawn
      {
        id: 'cp-elec-1',
        bookId: 'bk-elec-puiss',
        barcode: 'EST-GEL-0301',
        status: 'Disponible',
        physicalCondition: 'Usure légère',
        location: 'Rayon Sciences · GEL-05-A',
        needsInspection: 0,
        createdAt: isoOffset(-25),
      },
      {
        id: 'cp-elec-2',
        bookId: 'bk-elec-puiss',
        barcode: 'EST-GEL-0302',
        status: 'Retiré définitivement',
        physicalCondition: 'Hors service',
        location: 'Archives Réforme',
        needsInspection: 0,
        createdAt: isoOffset(-25),
      },

      // bk-comptabilite: 2 available
      {
        id: 'cp-compta-1',
        bookId: 'bk-comptabilite',
        barcode: 'EST-TMG-0401',
        status: 'Disponible',
        physicalCondition: 'Neuf',
        location: 'Salle Économie · TMG-01-D',
        needsInspection: 0,
        createdAt: isoOffset(-12),
      },
      {
        id: 'cp-compta-2',
        bookId: 'bk-comptabilite',
        barcode: 'EST-TMG-0402',
        status: 'Disponible',
        physicalCondition: 'Bon état',
        location: 'Salle Économie · TMG-01-D',
        needsInspection: 0,
        createdAt: isoOffset(-12),
      },

      // bk-meca: 1 available, 1 permanently withdrawn
      {
        id: 'cp-meca-1',
        bookId: 'bk-meca',
        barcode: 'EST-GME-0501',
        status: 'Disponible',
        physicalCondition: 'Bon état',
        location: 'Rayon Industriel · GME-04-A',
        needsInspection: 0,
        createdAt: isoOffset(-20),
      },

      // bk-maths: 1 available, 1 reserved (awaiting pickup for Salma!)
      {
        id: 'cp-maths-1',
        bookId: 'bk-maths',
        barcode: 'EST-MAT-0601',
        status: 'Disponible',
        physicalCondition: 'Neuf',
        location: 'Rayon Sciences · MAT-02-A',
        needsInspection: 0,
        createdAt: isoOffset(-5),
      },
      {
        id: 'cp-maths-2',
        bookId: 'bk-maths',
        barcode: 'EST-MAT-0602',
        status: 'Réservé',
        physicalCondition: 'Bon état',
        location: 'Banque d’accueil · Retrait réservations',
        needsInspection: 0,
        createdAt: isoOffset(-5),
      },
    ];

    for (const c of copies) insertCopy.run(c);

    const insertLoan = db.prepare(`
      INSERT INTO loans (id, memberId, copyId, bookId, borrowedAt, dueAt, returnedAt, returnCondition, returnNotes, status)
      VALUES (@id, @memberId, @copyId, @bookId, @borrowedAt, @dueAt, @returnedAt, @returnCondition, @returnNotes, @status)
    `);

    const loans = [
      // Salma active loan on cp-algo-3 (due in 5 days)
      {
        id: 'ln-salma-1',
        memberId: 'usr-salma',
        copyId: 'cp-algo-3',
        bookId: 'bk-algo',
        borrowedAt: isoOffset(-2),
        dueAt: isoOffset(5),
        returnedAt: null,
        returnCondition: null,
        returnNotes: null,
        status: 'En cours',
      },
      // Bilale active loan on cp-sys-1 (due in 4 days)
      {
        id: 'ln-bilale-1',
        memberId: 'usr-bilale',
        copyId: 'cp-sys-1',
        bookId: 'bk-sys-dist',
        borrowedAt: isoOffset(-3),
        dueAt: isoOffset(4),
        returnedAt: null,
        returnCondition: null,
        returnNotes: null,
        status: 'En cours',
      },
      // Youssef overdue loan on cp-sys-2 (due 3 days ago -> blocks borrowing/reserving!)
      {
        id: 'ln-youssef-overdue',
        memberId: 'usr-youssef',
        copyId: 'cp-sys-2',
        bookId: 'bk-sys-dist',
        borrowedAt: isoOffset(-10),
        dueAt: isoOffset(-3),
        returnedAt: null,
        returnCondition: null,
        returnNotes: null,
        status: 'En retard',
      },
      // Completed historical loan for Salma
      {
        id: 'ln-salma-past',
        memberId: 'usr-salma',
        copyId: 'cp-compta-1',
        bookId: 'bk-comptabilite',
        borrowedAt: isoOffset(-20),
        dueAt: isoOffset(-13),
        returnedAt: isoOffset(-14),
        returnCondition: 'Bon état',
        returnNotes: 'Restitué dans les délais.',
        status: 'Retourné',
      },
    ];

    for (const l of loans) insertLoan.run(l);

    const insertReservation = db.prepare(`
      INSERT INTO reservations (id, memberId, bookId, requestedAt, queuePosition, status, assignedCopyId, availableAt, pickupDeadline, completedAt)
      VALUES (@id, @memberId, @bookId, @requestedAt, @queuePosition, @status, @assignedCopyId, @availableAt, @pickupDeadline, @completedAt)
    `);

    const reservations = [
      {
        id: 'res-salma-maths',
        memberId: 'usr-salma',
        bookId: 'bk-maths',
        requestedAt: isoOffset(-2),
        queuePosition: null,
        status: 'Disponible pour retrait',
        assignedCopyId: 'cp-maths-2',
        availableAt: isoOffset(-1),
        pickupDeadline: isoOffset(2),
        completedAt: null,
      },
      {
        id: 'res-salma-sys',
        memberId: 'usr-salma',
        bookId: 'bk-sys-dist',
        requestedAt: isoOffset(-1),
        queuePosition: 1,
        status: 'En attente',
        assignedCopyId: null,
        availableAt: null,
        pickupDeadline: null,
        completedAt: null,
      },
    ];

    for (const r of reservations) insertReservation.run(r);

    const insertNotif = db.prepare(`
      INSERT INTO notifications (id, userId, title, message, type, createdAt, readAt)
      VALUES (@id, @userId, @title, @message, @type, @createdAt, @readAt)
    `);

    const notifications = [
      {
        id: 'ntf-1',
        userId: 'usr-salma',
        title: 'Exemplaire disponible pour retrait',
        message:
          'Votre exemplaire réservé de « Analyse Numérique et Probabilités pour l’Ingénieur » (code EST-MAT-0602) est prêt à la banque d’accueil. Vous disposez de 3 jours pour le retirer.',
        type: 'retrait',
        createdAt: isoOffset(-1),
        readAt: null,
      },
      {
        id: 'ntf-2',
        userId: 'usr-salma',
        title: 'Réservation enregistrée',
        message:
          'Votre réservation pour « Architecture des Systèmes Distribués et Réseaux » a été enregistrée (rang n° 1). Vous serez informé dès qu’un exemplaire sera disponible. Aucune date de disponibilité n’est garantie.',
        type: 'reservation',
        createdAt: isoOffset(-1),
        readAt: isoOffset(-0.5),
      },
      {
        id: 'ntf-3',
        userId: 'usr-youssef',
        title: 'Retard de restitution signalé',
        message:
          'L’emprunt de « Architecture des Systèmes Distribués et Réseaux » (EST-INF-0102) est en retard. Tout nouvel emprunt ou réservation est suspendu jusqu’à restitution.',
        type: 'rappel',
        createdAt: isoOffset(-2),
        readAt: null,
      },
    ];

    for (const n of notifications) insertNotif.run(n);
  });

  seed();
}
