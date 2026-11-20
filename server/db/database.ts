import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { hashPassword } from '../auth/password.ts';

export function createDatabase(dbPath?: string): Database.Database {
  const targetPath =
    dbPath || process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'biblioest.db');
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
      emailVerified INTEGER NOT NULL DEFAULT 1,
      isAdmin INTEGER NOT NULL DEFAULT 0,
      cne TEXT,
      filiere TEXT,
      authSource TEXT NOT NULL DEFAULT 'local' CHECK (authSource IN ('local', 'usmba_sso', 'google_oidc')),
      isDemo INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
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
      isDemo INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS copies (
      id TEXT PRIMARY KEY,
      bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      barcode TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('Disponible', 'Retenu 24h', 'Emprunté', 'Réservé', 'En réparation', 'Retiré définitivement')),
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
      requestType TEXT NOT NULL DEFAULT 'reservation_fifo' CHECK (requestType IN ('retenue_24h', 'reservation_fifo')),
      requestedAt TEXT NOT NULL,
      queuePosition INTEGER,
      status TEXT NOT NULL CHECK (status IN ('En attente', 'Retenu 24h', 'Exemplaire attribué', 'Disponible pour retrait', 'Retirée', 'Annulée', 'Expirée')),
      assignedCopyId TEXT REFERENCES copies(id),
      availableAt TEXT,
      pickupDeadline TEXT,
      completedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS copy_state_logs (
      id TEXT PRIMARY KEY,
      copyId TEXT NOT NULL REFERENCES copies(id) ON DELETE CASCADE,
      copyBarcode TEXT NOT NULL,
      bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      bookTitle TEXT NOT NULL,
      oldStatus TEXT,
      newStatus TEXT NOT NULL,
      memberId TEXT,
      memberName TEXT,
      agentId TEXT,
      agentName TEXT,
      requestOrLoanId TEXT,
      summary TEXT NOT NULL,
      createdAt TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS cart_items (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
      addedAt TEXT NOT NULL,
      UNIQUE (userId, bookId)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actorId TEXT,
      actorName TEXT,
      actorRole TEXT,
      action TEXT NOT NULL,
      entityType TEXT NOT NULL,
      entityId TEXT NOT NULL,
      summary TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS email_verification_codes (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      consumedAt TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library_settings (
      id TEXT PRIMARY KEY,
      borrowingDurationDays INTEGER NOT NULL DEFAULT 7,
      pickupWindowDays INTEGER NOT NULL DEFAULT 3,
      maxQuantityPerTitle INTEGER NOT NULL DEFAULT 1,
      realEmailsEnabled INTEGER NOT NULL DEFAULT 1,
      testEmailRecipient TEXT NOT NULL DEFAULT 'bilale.zorgane@usmba.ac.ma'
    );

    CREATE TABLE IF NOT EXISTS simulated_outbox (
      id TEXT PRIMARY KEY,
      recipientEmail TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('verification', 'rappel_retard', 'retrait', 'test')),
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS demo_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_copies_book_status ON copies(bookId, status);
    CREATE INDEX IF NOT EXISTS idx_loans_member_status ON loans(memberId, status);
    CREATE INDEX IF NOT EXISTS idx_loans_copy_status ON loans(copyId, status);
    CREATE INDEX IF NOT EXISTS idx_reservations_book_status_req ON reservations(bookId, status, requestedAt);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(userId, createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_cart_items_user ON cart_items(userId, addedAt ASC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_copy_state_logs_created ON copy_state_logs(createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_email_codes_user ON email_verification_codes(userId, createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_sim_outbox_created ON simulated_outbox(createdAt DESC);
  `);

  migrateExistingSchemaIfNeeded(db);
  ensureDefaultSettings(db, false);
}

export function ensureDefaultSettings(db: Database.Database, isDemoDb = false): void {
  const existing = db
    .prepare(`SELECT id FROM library_settings WHERE id = 'default'`)
    .get() as { id: string } | undefined;
  if (!existing) {
    db.prepare(
      `INSERT INTO library_settings (id, borrowingDurationDays, pickupWindowDays, maxQuantityPerTitle, realEmailsEnabled, testEmailRecipient)
       VALUES ('default', 7, 3, 1, ?, ?)`
    ).run(isDemoDb ? 0 : 1, isDemoDb ? 'test.demo@usmba.example' : 'bilale.zorgane@usmba.ac.ma');
  }
}

function migrateExistingSchemaIfNeeded(db: Database.Database): void {
  const usersSqlRow = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'`)
    .get() as { sql?: string } | undefined;
  const usersCols = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
  const hasUserIsDemo = usersCols.some((c) => c.name === 'isDemo');
  const hasEmailVerified = usersCols.some((c) => c.name === 'emailVerified');
  const hasIsAdmin = usersCols.some((c) => c.name === 'isAdmin');
  const hasGoogleOidcCheck = Boolean(usersSqlRow?.sql?.includes('google_oidc'));

  if (!hasUserIsDemo || !hasGoogleOidcCheck) {
    db.pragma('foreign_keys = OFF');
    const migrateUsers = db.transaction(() => {
      db.exec(`
        CREATE TABLE users_migrated (
          id TEXT PRIMARY KEY,
          fullName TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          passwordHash TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('membre', 'bibliothecaire')),
          institution TEXT NOT NULL,
          studentStatus TEXT NOT NULL CHECK (studentStatus IN ('verifie', 'en_attente', 'non_est', 'suspendu')),
          accountStatus TEXT NOT NULL CHECK (accountStatus IN ('actif', 'suspendu')),
          emailVerified INTEGER NOT NULL DEFAULT 1,
          isAdmin INTEGER NOT NULL DEFAULT 0,
          cne TEXT,
          filiere TEXT,
          authSource TEXT NOT NULL DEFAULT 'local' CHECK (authSource IN ('local', 'usmba_sso', 'google_oidc')),
          isDemo INTEGER NOT NULL DEFAULT 0,
          createdAt TEXT NOT NULL
        );
      `);
      const selectDemoExpr = hasUserIsDemo
        ? 'isDemo'
        : `CASE WHEN authSource = 'local' THEN 1 ELSE 0 END`;
      const selectEmailVerifiedExpr = hasEmailVerified ? 'emailVerified' : '1';
      const selectIsAdminExpr = hasIsAdmin ? 'isAdmin' : '0';
      db.exec(`
        INSERT INTO users_migrated (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, emailVerified, isAdmin, cne, filiere, authSource, isDemo, createdAt)
        SELECT id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, ${selectEmailVerifiedExpr}, ${selectIsAdminExpr}, cne, filiere, authSource, ${selectDemoExpr}, createdAt
        FROM users;
        DROP TABLE users;
        ALTER TABLE users_migrated RENAME TO users;
      `);
    });
    migrateUsers();
    db.pragma('foreign_keys = ON');
  } else {
    if (!hasEmailVerified) {
      db.exec(`ALTER TABLE users ADD COLUMN emailVerified INTEGER NOT NULL DEFAULT 1`);
    }
    if (!hasIsAdmin) {
      db.exec(`ALTER TABLE users ADD COLUMN isAdmin INTEGER NOT NULL DEFAULT 0`);
    }
  }

  // Remplacer toute donnée personnelle ou adresse seed héritée par les profils fictifs explicites
  const demoUpdates: Array<[string, string, string]> = [
    ['usr-salma', 'Salma Idrissi (Démo)', 'salma.demo@usmba.example'],
    ['usr-bilale', 'Amine El Fassi (Démo)', 'amine.demo@usmba.example'],
    ['usr-youssef', 'Youssef Mansouri (Démo)', 'youssef.demo@usmba.example'],
    ['usr-karim', 'Karim Berrada (Démo)', 'karim.demo@usmba.example'],
    ['usr-lib', 'Nadia Benali (Démo)', 'bibliothecaire.demo@est-usmba.example'],
    ['usr-admin', 'Hassan Tazi (Admin Démo)', 'admin.demo@est-usmba.example'],
  ];
  const updateDemoStmt = db.prepare(
    `UPDATE users SET fullName = ?, email = ?, isDemo = 1 WHERE id = ? AND authSource = 'local'`
  );
  for (const [id, fullName, email] of demoUpdates) {
    updateDemoStmt.run(fullName, email, id);
  }

  const booksCols = db.prepare(`PRAGMA table_info(books)`).all() as Array<{ name: string }>;
  if (!booksCols.some((c) => c.name === 'isDemo')) {
    db.exec(`ALTER TABLE books ADD COLUMN isDemo INTEGER NOT NULL DEFAULT 0`);
    db.prepare(
      `UPDATE books SET isDemo = 1 WHERE id IN ('bk-algo', 'bk-sys-dist', 'bk-auto', 'bk-elec-puiss', 'bk-comptabilite', 'bk-meca', 'bk-maths')`
    ).run();
  }

  const copiesSqlRow = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'copies'`)
    .get() as { sql?: string } | undefined;
  if (copiesSqlRow?.sql && !copiesSqlRow.sql.includes('Retenu 24h')) {
    db.pragma('foreign_keys = OFF');
    const migrateCopies = db.transaction(() => {
      db.exec(`
        CREATE TABLE copies_migrated (
          id TEXT PRIMARY KEY,
          bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          barcode TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL CHECK (status IN ('Disponible', 'Retenu 24h', 'Emprunté', 'Réservé', 'En réparation', 'Retiré définitivement')),
          physicalCondition TEXT NOT NULL CHECK (physicalCondition IN ('Neuf', 'Bon état', 'Usure légère', 'Endommagé', 'Hors service')),
          location TEXT NOT NULL,
          needsInspection INTEGER NOT NULL DEFAULT 0,
          createdAt TEXT NOT NULL
        );
        INSERT INTO copies_migrated (id, bookId, barcode, status, physicalCondition, location, needsInspection, createdAt)
        SELECT id, bookId, barcode, status, physicalCondition, location, needsInspection, createdAt
        FROM copies;
        DROP TABLE copies;
        ALTER TABLE copies_migrated RENAME TO copies;
        CREATE INDEX IF NOT EXISTS idx_copies_book_status ON copies(bookId, status);
      `);
    });
    migrateCopies();
    db.pragma('foreign_keys = ON');
  }

  const resSqlRow = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reservations'`)
    .get() as { sql?: string } | undefined;
  const resCols = db.prepare(`PRAGMA table_info(reservations)`).all() as Array<{ name: string }>;
  const hasRequestType = resCols.some((c) => c.name === 'requestType');
  if (
    resSqlRow?.sql &&
    (!resSqlRow.sql.includes('Exemplaire attribué') ||
      !resSqlRow.sql.includes('Retenu 24h') ||
      !hasRequestType)
  ) {
    db.pragma('foreign_keys = OFF');
    const migrateRes = db.transaction(() => {
      const requestTypeExpr = hasRequestType ? `COALESCE(requestType, 'reservation_fifo')` : `'reservation_fifo'`;
      db.exec(`
        CREATE TABLE reservations_migrated (
          id TEXT PRIMARY KEY,
          memberId TEXT NOT NULL REFERENCES users(id),
          bookId TEXT NOT NULL REFERENCES books(id),
          requestType TEXT NOT NULL DEFAULT 'reservation_fifo' CHECK (requestType IN ('retenue_24h', 'reservation_fifo')),
          requestedAt TEXT NOT NULL,
          queuePosition INTEGER,
          status TEXT NOT NULL CHECK (status IN ('En attente', 'Retenu 24h', 'Exemplaire attribué', 'Disponible pour retrait', 'Retirée', 'Annulée', 'Expirée')),
          assignedCopyId TEXT REFERENCES copies(id),
          availableAt TEXT,
          pickupDeadline TEXT,
          completedAt TEXT
        );
        INSERT INTO reservations_migrated (id, memberId, bookId, requestType, requestedAt, queuePosition, status, assignedCopyId, availableAt, pickupDeadline, completedAt)
        SELECT id, memberId, bookId, ${requestTypeExpr}, requestedAt, queuePosition, status, assignedCopyId, availableAt, pickupDeadline, completedAt
        FROM reservations;
        DROP TABLE reservations;
        ALTER TABLE reservations_migrated RENAME TO reservations;
        CREATE INDEX IF NOT EXISTS idx_reservations_book_status_req ON reservations(bookId, status, requestedAt);
      `);
    });
    migrateRes();
    db.pragma('foreign_keys = ON');
  }
}

export function seedDatabaseIfEmpty(
  db: Database.Database,
  nowDate: Date = new Date(),
  options?: { isDemoSandbox?: boolean }
): void {
  const existingUsers = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (existingUsers.count > 0) {
    ensureDefaultSettings(db, Boolean(options?.isDemoSandbox));
    return;
  }

  const isoOffset = (daysOffset: number): string => {
    return new Date(nowDate.getTime() + daysOffset * 24 * 60 * 60 * 1000).toISOString();
  };

  const seed = db.transaction(() => {
    const insertUser = db.prepare(`
      INSERT INTO users (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, emailVerified, isAdmin, cne, filiere, authSource, isDemo, createdAt)
      VALUES (@id, @fullName, @email, @passwordHash, @role, @institution, @studentStatus, @accountStatus, @emailVerified, @isAdmin, @cne, @filiere, @authSource, @isDemo, @createdAt)
    `);

    const demoLocalHash = hashPassword('DemoBiblioEST2026!');

    const users = [
      {
        id: 'usr-salma',
        fullName: 'Salma Idrissi (Démo)',
        email: 'salma.demo@usmba.example',
        passwordHash: demoLocalHash,
        role: 'membre',
        institution: 'EST Fès',
        studentStatus: 'verifie',
        accountStatus: 'actif',
        emailVerified: 1,
        isAdmin: 0,
        cne: 'DEMO-N001',
        filiere: 'Génie Informatique',
        authSource: 'local',
        isDemo: 1,
        createdAt: isoOffset(-60),
      },
      {
        id: 'usr-bilale',
        fullName: 'Amine El Fassi (Démo)',
        email: 'amine.demo@usmba.example',
        passwordHash: demoLocalHash,
        role: 'membre',
        institution: 'EST Fès',
        studentStatus: 'verifie',
        accountStatus: 'actif',
        emailVerified: 1,
        isAdmin: 0,
        cne: 'DEMO-N002',
        filiere: 'Génie Informatique',
        authSource: 'local',
        isDemo: 1,
        createdAt: isoOffset(-45),
      },
      {
        id: 'usr-youssef',
        fullName: 'Youssef Mansouri (Démo)',
        email: 'youssef.demo@usmba.example',
        passwordHash: demoLocalHash,
        role: 'membre',
        institution: 'EST Fès',
        studentStatus: 'verifie',
        accountStatus: 'actif',
        emailVerified: 1,
        isAdmin: 0,
        cne: 'DEMO-N003',
        filiere: 'Génie Électrique',
        authSource: 'local',
        isDemo: 1,
        createdAt: isoOffset(-50),
      },
      {
        id: 'usr-karim',
        fullName: 'Karim Berrada (Démo)',
        email: 'karim.demo@usmba.example',
        passwordHash: demoLocalHash,
        role: 'membre',
        institution: 'EST Fès',
        studentStatus: 'en_attente',
        accountStatus: 'actif',
        emailVerified: 1,
        isAdmin: 0,
        cne: 'DEMO-N004',
        filiere: 'Techniques de Management',
        authSource: 'local',
        isDemo: 1,
        createdAt: isoOffset(-10),
      },
      {
        id: 'usr-lib',
        fullName: 'Nadia Benali (Démo)',
        email: 'bibliothecaire.demo@est-usmba.example',
        passwordHash: demoLocalHash,
        role: 'bibliothecaire',
        institution: 'EST Fès',
        studentStatus: 'verifie',
        accountStatus: 'actif',
        emailVerified: 1,
        isAdmin: 0,
        cne: null,
        filiere: 'Direction de la Bibliothèque EST Fès',
        authSource: 'local',
        isDemo: 1,
        createdAt: isoOffset(-120),
      },
      {
        id: 'usr-admin',
        fullName: 'Hassan Tazi (Admin Démo)',
        email: 'admin.demo@est-usmba.example',
        passwordHash: demoLocalHash,
        role: 'bibliothecaire',
        institution: 'EST Fès',
        studentStatus: 'verifie',
        accountStatus: 'actif',
        emailVerified: 1,
        isAdmin: 1,
        cne: null,
        filiere: 'Administration Bibliothèque EST Fès',
        authSource: 'local',
        isDemo: 1,
        createdAt: isoOffset(-150),
      },
    ];

    for (const u of users) insertUser.run(u);

    const insertBook = db.prepare(`
      INSERT INTO books (id, title, authors, isbn, category, description, publisher, publicationYear, edition, language, coverImage, shelfLocation, archived, featured, isDemo, createdAt)
      VALUES (@id, @title, @authors, @isbn, @category, @description, @publisher, @publicationYear, @edition, @language, @coverImage, @shelfLocation, @archived, @featured, 1, @createdAt)
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
        status: 'Retenu 24h',
        physicalCondition: 'Bon état',
        location: 'Banque d’accueil · Retrait 24h',
        needsInspection: 0,
        createdAt: isoOffset(-12),
      },
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
      INSERT INTO reservations (id, memberId, bookId, requestType, requestedAt, queuePosition, status, assignedCopyId, availableAt, pickupDeadline, completedAt)
      VALUES (@id, @memberId, @bookId, @requestType, @requestedAt, @queuePosition, @status, @assignedCopyId, @availableAt, @pickupDeadline, @completedAt)
    `);

    const reservations = [
      {
        id: 'res-salma-maths',
        memberId: 'usr-salma',
        bookId: 'bk-maths',
        requestType: 'reservation_fifo',
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
        requestType: 'reservation_fifo',
        requestedAt: isoOffset(-1),
        queuePosition: 1,
        status: 'En attente',
        assignedCopyId: null,
        availableAt: null,
        pickupDeadline: null,
        completedAt: null,
      },
      {
        id: 'res-amine-compta-24h',
        memberId: 'usr-bilale',
        bookId: 'bk-comptabilite',
        requestType: 'retenue_24h',
        requestedAt: nowDate.toISOString(),
        queuePosition: null,
        status: 'Retenu 24h',
        assignedCopyId: 'cp-compta-2',
        availableAt: nowDate.toISOString(),
        pickupDeadline: isoOffset(1),
        completedAt: null,
      },
    ];

    for (const r of reservations) insertReservation.run(r);

    db.prepare(`
      INSERT INTO copy_state_logs (id, copyId, copyBarcode, bookId, bookTitle, oldStatus, newStatus, memberId, memberName, agentId, agentName, requestOrLoanId, summary, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'csl-seed-1',
      'cp-compta-2',
      'EST-TMG-0402',
      'bk-comptabilite',
      'Comptabilité Analytique et Contrôle de Gestion',
      'Disponible',
      'Retenu 24h',
      'usr-bilale',
      'Amine El Fassi (Démo)',
      'usr-bilale',
      'Amine El Fassi (Démo)',
      'res-amine-compta-24h',
      'Retenue 24 h créée lors de la validation du panier de demandes.',
      nowDate.toISOString()
    );

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

    ensureDefaultSettings(db, Boolean(options?.isDemoSandbox));
    if (options?.isDemoSandbox) {
      db.prepare(`INSERT OR REPLACE INTO demo_meta (key, value) VALUES ('clock_offset_days', '0')`).run();
      db.prepare(`INSERT OR REPLACE INTO demo_meta (key, value) VALUES ('clock_offset_hours', '0')`).run();
    }
  });

  seed();
}

export function resetDemoDatabase(demoDb: Database.Database, nowDate: Date = new Date()): void {
  const tx = demoDb.transaction(() => {
    demoDb.pragma('foreign_keys = OFF');
    demoDb.exec(`
      DELETE FROM email_verification_codes;
      DELETE FROM simulated_outbox;
      DELETE FROM demo_meta;
      DELETE FROM copy_state_logs;
      DELETE FROM cart_items;
      DELETE FROM audit_logs;
      DELETE FROM notifications;
      DELETE FROM reservations;
      DELETE FROM loans;
      DELETE FROM copies;
      DELETE FROM books;
      DELETE FROM users;
      DELETE FROM library_settings;
    `);
    demoDb.pragma('foreign_keys = ON');
  });
  tx();
  seedDatabaseIfEmpty(demoDb, nowDate, { isDemoSandbox: true });
}
