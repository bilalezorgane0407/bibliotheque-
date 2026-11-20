import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDatabase, seedDatabaseIfEmpty } from '../server/db/database.ts';
import { createApp } from '../server/app.ts';
import { GoogleAuthAdapter } from '../server/auth/googleAuthAdapter.ts';
import { hashPassword } from '../server/auth/password.ts';
import { DomainError, LibraryService } from '../server/services/libraryService.ts';

function setupTestEnv(baseTime = new Date('2026-11-12T10:00:00.000Z')) {
  const db = createDatabase(':memory:');
  seedDatabaseIfEmpty(db, baseTime);
  const service = new LibraryService(db);
  return { db, service, baseTime };
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

test('1. Un membre éligible peut emprunter un ouvrage disponible (durée 7 jours)', () => {
  const { service, baseTime } = setupTestEnv();
  const loan = service.borrowBook('usr-bilale', 'bk-algo', baseTime);
  assert.equal(loan.status, 'En cours');
  assert.equal(loan.bookId, 'bk-algo');
  const expectedDue = addDays(baseTime, 7).toISOString();
  assert.equal(loan.dueAt, expectedDue);

  const detail = service.getBookDetail('bk-algo', baseTime);
  assert.equal(detail.availableCopies, 1);
  assert.equal(detail.borrowedCopies, 2);
});

test('2. Diagramme 1 : adresse vérifiée ≠ statut EST Fès vérifié ; validation requise avant emprunt et compte suspendu refusé', () => {
  const { db, service, baseTime } = setupTestEnv();
  // usr-karim a emailVerified = 1 mais studentStatus = 'en_attente' -> refusé tant que non validé par le personnel
  assert.throws(
    () => service.borrowBook('usr-karim', 'bk-algo', baseTime),
    (err: unknown) =>
      err instanceof DomainError &&
      err.statusCode === 403 &&
      err.code === 'EST_STATUS_NOT_VERIFIED'
  );

  // Une fois le statut EST Fès validé par un bibliothécaire, Karim peut emprunter
  service.updateMemberVerificationAdmin(
    'usr-karim',
    'verifie',
    'actif',
    { id: 'usr-lib', fullName: 'Nadia Benali', role: 'bibliothecaire' },
    baseTime
  );
  const karimLoan = service.borrowBook('usr-karim', 'bk-algo', baseTime);
  assert.equal(karimLoan.status, 'En cours');

  // Un compte suspendu est toujours refusé (403 ACCOUNT_SUSPENDED)
  db.prepare(
    `INSERT INTO users (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, emailVerified, isAdmin, cne, filiere, authSource, createdAt)
     VALUES ('usr-ext-susp', 'Externe Suspendu', 'ext.susp@usmba.ac.ma', 'hash', 'membre', 'FSDM', 'verifie', 'suspendu', 1, 0, NULL, NULL, 'local', ?)`
  ).run(baseTime.toISOString());

  assert.throws(
    () => service.borrowBook('usr-ext-susp', 'bk-algo', baseTime),
    (err: unknown) =>
      err instanceof DomainError &&
      err.statusCode === 403 &&
      err.code === 'ACCOUNT_SUSPENDED'
  );
  db.close();
});

test('3. Un membre ayant un retour en retard ne peut ni emprunter ni réserver', () => {
  const { service, baseTime } = setupTestEnv();
  // usr-youssef a un emprunt en retard dans le seed
  assert.throws(
    () => service.borrowBook('usr-youssef', 'bk-algo', baseTime),
    (err: unknown) =>
      err instanceof DomainError && err.statusCode === 403 && err.code === 'OVERDUE_RETURN'
  );
  assert.throws(
    () => service.reserveBook('usr-youssef', 'bk-sys-dist', baseTime),
    (err: unknown) =>
      err instanceof DomainError && err.statusCode === 403 && err.code === 'OVERDUE_RETURN'
  );
});

test('4. Un ouvrage indisponible possédant des exemplaires en circulation peut être réservé', () => {
  const { db, service, baseTime } = setupTestEnv();
  db.prepare(
    `INSERT INTO users (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, cne, filiere, authSource, createdAt)
     VALUES ('usr-amina', 'Amina Test', 'amina.test@usmba.example', 'hash', 'membre', 'EST Fès', 'verifie', 'actif', 'DEMO-T01', 'Génie Informatique', 'local', ?)`
  ).run(baseTime.toISOString());

  // bk-sys-dist a 0 disponible mais 2 empruntés ; Salma est au rang 1 dans le seed
  const res = service.reserveBook('usr-amina', 'bk-sys-dist', baseTime);
  assert.equal(res.status, 'En attente');
  assert.equal(res.queuePosition, 2);

  const notifs = service.getMemberNotifications('usr-amina');
  assert.ok(
    notifs.some((n) =>
      n.message.replace(/’/g, "'").includes("Aucune date de disponibilité n'est garantie")
    )
  );
});

test('5. Un ouvrage dont tous les exemplaires sont retirés définitivement ne peut pas être réservé', () => {
  const { db, service, baseTime } = setupTestEnv();
  const created = service.createBook(
    {
      title: 'Ouvrage Obsolète',
      authors: 'Auteur Test',
      isbn: null,
      category: 'Génie Informatique',
      description: 'Test retrait permanent',
      publisher: 'Test',
      publicationYear: 2010,
      edition: '1re',
      language: 'Français',
      coverImage: '/src/assets/images/cover_informatique_1794527753411.jpg',
      shelfLocation: 'ARC-01',
      featured: false,
    },
    baseTime
  );
  service.registerCopy(
    created.id,
    { barcode: 'EST-ARC-9001', physicalCondition: 'Hors service', location: 'Archives Réforme' },
    baseTime
  );

  // Vérifier aussi que l'exemplaire retiré n'apparaît pas en inventaire disponible
  const detail = service.getBookDetail(created.id, baseTime);
  assert.equal(detail.circulatingCopies, 0);

  assert.throws(
    () => service.reserveBook('usr-bilale', created.id, baseTime),
    (err: unknown) =>
      err instanceof DomainError &&
      err.statusCode === 409 &&
      err.code === 'NO_CIRCULATING_COPIES'
  );
  db.close();
});

test('6 & 7. File FIFO stricte et affectation automatique immédiate avec délai de 3 jours au retour réutilisable', () => {
  const { db, service, baseTime } = setupTestEnv();
  db.prepare(
    `INSERT INTO users (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, cne, filiere, authSource, createdAt)
     VALUES ('usr-amina', 'Amina Test', 'amina.test@usmba.example', 'hash', 'membre', 'EST Fès', 'verifie', 'actif', 'DEMO-T01', 'Génie Informatique', 'local', ?),
            ('usr-omar', 'Omar Test', 'omar.test@usmba.example', 'hash', 'membre', 'EST Fès', 'verifie', 'actif', 'DEMO-T02', 'Génie Informatique', 'local', ?)`
  ).run(baseTime.toISOString(), baseTime.toISOString());

  // Salma est déjà #1 pour bk-sys-dist (seed). Amina réserve à T+1min (#2), Omar réserve à T+2min (#3)
  const rAmina = service.reserveBook('usr-amina', 'bk-sys-dist', new Date(baseTime.getTime() + 60_000));
  const rOmar = service.reserveBook('usr-omar', 'bk-sys-dist', new Date(baseTime.getTime() + 120_000));
  assert.equal(rAmina.queuePosition, 2);
  assert.equal(rOmar.queuePosition, 3);

  // Retourner l'emprunt de Amine (ln-bilale-1) en état réutilisable -> affectation automatique à Salma (#1) avec fenêtre de retrait 3 jours
  const tReturn = new Date(baseTime.getTime() + 180_000);
  const { assignedReservationId } = service.returnLoan(
    'ln-bilale-1',
    'reutilisable',
    'Bon état',
    'RAS',
    tReturn
  );
  assert.equal(assignedReservationId, 'res-salma-sys');

  const salmaRes = service.getMemberReservations('usr-salma', tReturn);
  const target = salmaRes.find((r) => r.id === 'res-salma-sys');
  assert.equal(target?.status, 'Disponible pour retrait');
  assert.equal(target?.pickupDeadline, addDays(tReturn, 3).toISOString());
  // Parcours membre : aucun code-barres ou ID de copie exposé publiquement
  assert.equal(target?.assignedCopyId, null);
  assert.equal(target?.assignedCopyBarcode, null);
  // Vue personnel : l'exemplaire attribué est bien enregistré
  const adminTarget = service.getAllReservationsAdmin(tReturn).find((r) => r.id === 'res-salma-sys');
  assert.ok(adminTarget?.assignedCopyId);
  assert.ok(adminTarget?.assignedCopyBarcode);

  // Vérifier que les positions restantes ont avancé (#1 pour Amina, #2 pour Omar)
  const aminaRes = service.getMemberReservations('usr-amina', tReturn);
  assert.equal(aminaRes.find((r) => r.id === rAmina.id)?.queuePosition, 1);
  const omarRes = service.getMemberReservations('usr-omar', tReturn);
  assert.equal(omarRes.find((r) => r.id === rOmar.id)?.queuePosition, 2);
});

test('8. L’annulation d’une réservation met à jour la file d’attente et réattribue immédiatement au suivant', () => {
  const { db, service, baseTime } = setupTestEnv();
  db.prepare(
    `INSERT INTO users (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, cne, filiere, authSource, createdAt)
     VALUES ('usr-amina', 'Amina Test', 'amina.test@usmba.example', 'hash', 'membre', 'EST Fès', 'verifie', 'actif', 'DEMO-T01', 'Génie Informatique', 'local', ?),
            ('usr-omar', 'Omar Test', 'omar.test@usmba.example', 'hash', 'membre', 'EST Fès', 'verifie', 'actif', 'DEMO-T02', 'Génie Informatique', 'local', ?)`
  ).run(baseTime.toISOString(), baseTime.toISOString());

  const rAmina = service.reserveBook('usr-amina', 'bk-sys-dist', new Date(baseTime.getTime() + 60_000));
  const rOmar = service.reserveBook('usr-omar', 'bk-sys-dist', new Date(baseTime.getTime() + 120_000));

  // Retourner ln-bilale-1 -> attribué directement à Salma ('Disponible pour retrait')
  service.returnLoan('ln-bilale-1', 'reutilisable', 'Bon état', '', new Date(baseTime.getTime() + 180_000));

  // Salma annule sa réservation -> l'exemplaire passe immédiatement à Amina pour retrait 3 jours !
  const tCancel = new Date(baseTime.getTime() + 240_000);
  service.cancelReservation(
    'res-salma-sys',
    { id: 'usr-salma', role: 'membre' },
    tCancel
  );

  const aminaRes = service
    .getMemberReservations('usr-amina', tCancel)
    .find((r) => r.id === rAmina.id);
  assert.equal(aminaRes?.status, 'Disponible pour retrait');
  assert.equal(aminaRes?.pickupDeadline, addDays(tCancel, 3).toISOString());

  const omarRes = service
    .getMemberReservations('usr-omar', tCancel)
    .find((r) => r.id === rOmar.id);
  assert.equal(omarRes?.queuePosition, 1);
});

test('9 & 10. L’expiration du délai de retrait de 3 jours transfère l’exemplaire au membre suivant FIFO', () => {
  const { db, service, baseTime } = setupTestEnv();
  db.prepare(
    `INSERT INTO users (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, cne, filiere, authSource, createdAt)
     VALUES ('usr-amina', 'Amina Test', 'amina.test@usmba.example', 'hash', 'membre', 'EST Fès', 'verifie', 'actif', 'DEMO-T01', 'Génie Informatique', 'local', ?)`
  ).run(baseTime.toISOString());

  const rAmina = service.reserveBook('usr-amina', 'bk-sys-dist', new Date(baseTime.getTime() + 60_000));

  const tReturn = new Date(baseTime.getTime() + 120_000);
  service.returnLoan('ln-bilale-1', 'reutilisable', 'Bon état', '', tReturn);

  const salmaRes = service
    .getMemberReservations('usr-salma', tReturn)
    .find((r) => r.id === 'res-salma-sys');
  assert.equal(salmaRes?.status, 'Disponible pour retrait');
  assert.equal(salmaRes?.pickupDeadline, addDays(tReturn, 3).toISOString());

  // Avancer le temps de 3 jours + 1 heure -> expiration automatique et attribution à Amina
  const tExpired = new Date(tReturn.getTime() + (3 * 24 + 1) * 60 * 60 * 1000);
  const expiredCount = service.processDeadlines(tExpired);
  assert.ok(expiredCount >= 1);

  const salmaAfter = service
    .getMemberReservations('usr-salma', tExpired)
    .find((r) => r.id === 'res-salma-sys');
  assert.equal(salmaAfter?.status, 'Expirée');

  const aminaAfter = service
    .getMemberReservations('usr-amina', tExpired)
    .find((r) => r.id === rAmina.id);
  assert.equal(aminaAfter?.status, 'Disponible pour retrait');
  assert.equal(aminaAfter?.pickupDeadline, addDays(tExpired, 3).toISOString());
});

test('11 & 12. Un exemplaire endommagé ne peut pas être emprunté et un exemplaire réparé doit être inspecté avant remise en circulation', () => {
  const { service, baseTime } = setupTestEnv();
  const created = service.createBook(
    {
      title: 'Systèmes Temps Réel',
      authors: 'Dr. El Haddad',
      isbn: '978-2-10-000001-1',
      category: 'Génie Électrique',
      description: 'Test réparation',
      publisher: 'EST Press',
      publicationYear: 2025,
      edition: '1re',
      language: 'Français',
      coverImage: '/src/assets/images/cover_genie_electrique_1794527754591.jpg',
      shelfLocation: 'GEL-99-Z',
      featured: false,
    },
    baseTime
  );

  const { copy } = service.registerCopy(
    created.id,
    { barcode: 'EST-TEST-REP1', physicalCondition: 'Neuf', location: 'GEL-99-Z' },
    baseTime
  );

  const loan = service.borrowBook('usr-bilale', created.id, baseTime);

  // Retour en état endommagé -> passe en réparation et ne peut pas être emprunté
  service.returnLoan(loan.id, 'endommage', 'Endommagé', 'Reliure décollée', baseTime);

  assert.throws(
    () => service.borrowBook('usr-salma', created.id, baseTime),
    (err: unknown) => err instanceof DomainError && err.code === 'NO_AVAILABLE_COPY'
  );

  // Réparation terminée, mais pas encore inspecté -> toujours impossible à emprunter !
  const repaired = service.completeCopyRepair(copy.id);
  assert.equal(repaired.status, 'En réparation');
  assert.equal(repaired.needsInspection, true);

  assert.throws(
    () => service.borrowBook('usr-salma', created.id, baseTime),
    (err: unknown) => err instanceof DomainError && err.code === 'NO_AVAILABLE_COPY'
  );

  // Inspection finale validée -> redevient disponible
  const inspected = service.inspectRepairedCopy(copy.id, 'reutilisable', 'Bon état', baseTime);
  assert.equal(inspected.copy.status, 'Disponible');
  assert.equal(inspected.copy.needsInspection, false);

  const borrowedAgain = service.borrowBook('usr-salma', created.id, baseTime);
  assert.equal(borrowedAgain.status, 'En cours');
});

test('13. Un exemplaire retiré définitivement est exclu de l’inventaire disponible et circulant', () => {
  const { service, baseTime } = setupTestEnv();
  const statsBefore = service.getDashboardStats(baseTime);
  // bk-elec-puiss a 1 disponible et 1 retiré définitivement (totalPhysicalCopies = total hors retirés)
  const detail = service.getBookDetail('bk-elec-puiss', baseTime);
  assert.equal(detail.withdrawnCopies, 1);
  assert.equal(detail.totalCopies, 1);
  assert.equal(detail.availableCopies, 1);

  // Retourner un emprunt comme retiré définitivement diminue l'inventaire actif
  service.returnLoan('ln-salma-1', 'retire_definitivement', 'Hors service', 'Pages manquantes', baseTime);
  const statsAfter = service.getDashboardStats(baseTime);
  assert.equal(statsAfter.withdrawnCopies, statsBefore.withdrawnCopies + 1);
  assert.equal(statsAfter.totalPhysicalCopies, statsBefore.totalPhysicalCopies - 1);
});

test('14. Un étudiant authentifié ne peut jamais accéder aux routes d’administration bibliothécaire (403 Forbidden)', async () => {
  const { db, baseTime } = setupTestEnv();
  const { app } = createApp(db, () => baseTime);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Non authentifié -> 401
    const unauthRes = await fetch(`${baseUrl}/api/admin/stats`);
    assert.equal(unauthRes.status, 401);

    // 2. Connexion étudiant démo Salma -> récupère cookie
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'salma.demo@usmba.example',
        password: 'DemoBiblioEST2026!',
      }),
    });
    assert.equal(loginRes.status, 200);
    const cookie = loginRes.headers.get('set-cookie');
    assert.ok(cookie);

    // 3. Étudiant tente d'accéder au dashboard bibliothécaire et de modifier le catalogue -> 403
    const adminStatsRes = await fetch(`${baseUrl}/api/admin/stats`, {
      headers: { Cookie: cookie.split(';')[0] },
    });
    assert.equal(adminStatsRes.status, 403);

    const adminCreateBookRes = await fetch(`${baseUrl}/api/admin/books`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie.split(';')[0],
      },
      body: JSON.stringify({
        title: 'Tentative intrusion',
        authors: 'Etudiant',
        category: 'Génie Informatique',
        shelfLocation: 'INF-99',
      }),
    });
    assert.equal(adminCreateBookRes.status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test('15. Authentification complète : identifiants invalides, contexte HTTPS top-level vs iframe, persistance session, anti-cache et déconnexion', async () => {
  const { db, baseTime } = setupTestEnv();
  const { app } = createApp(db, () => baseTime);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Identifiants invalides -> 401
    const badRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'salma.demo@usmba.example',
        password: 'MauvaisMotDePasse!',
      }),
    });
    assert.equal(badRes.status, 401);

    // 2. Connexion étudiant en contexte HTTPS top-level -> SameSite=Lax; Secure; HttpOnly
    const topLevelHttpsLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({
        email: 'salma.demo@usmba.example',
        password: 'DemoBiblioEST2026!',
      }),
    });
    assert.equal(topLevelHttpsLogin.status, 200);
    const topLevelSetCookie = topLevelHttpsLogin.headers.get('set-cookie') || '';
    assert.match(topLevelSetCookie, /HttpOnly/i);
    assert.match(topLevelSetCookie, /Secure/i);
    assert.match(topLevelSetCookie, /SameSite=Lax/i);
    assert.doesNotMatch(topLevelSetCookie, /SameSite=None/i);

    // 3. Connexion étudiant en contexte iframe cross-site HTTPS -> SameSite=None; Secure; Partitioned
    const iframeLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
        'X-BiblioEST-Embed': 'cross-site-iframe',
      },
      body: JSON.stringify({
        email: 'salma.demo@usmba.example',
        password: 'DemoBiblioEST2026!',
      }),
    });
    assert.equal(iframeLogin.status, 200);
    const iframeSetCookie = iframeLogin.headers.get('set-cookie') || '';
    assert.match(iframeSetCookie, /HttpOnly/i);
    assert.match(iframeSetCookie, /SameSite=None/i);
    assert.match(iframeSetCookie, /Secure/i);
    assert.match(iframeSetCookie, /Partitioned/i);

    const studentCookiePair = iframeSetCookie.split(';')[0];

    // 4. Persistance de session via /api/auth/me + en-têtes anti-cache
    const meStudentRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Cookie: `bad_third_party=100%ZZ; ${studentCookiePair}`,
        'X-Forwarded-Proto': 'https',
        'X-BiblioEST-Embed': 'cross-site-iframe',
      },
    });
    assert.equal(meStudentRes.status, 200);
    assert.match(meStudentRes.headers.get('cache-control') || '', /no-store/i);
    assert.match(meStudentRes.headers.get('vary') || '', /Cookie/i);
    const meStudentData = (await meStudentRes.json()) as {
      authenticated: boolean;
      cookieReceived: boolean;
      user: { id: string; role: string } | null;
    };
    assert.equal(meStudentData.authenticated, true);
    assert.equal(meStudentData.cookieReceived, true);
    assert.equal(meStudentData.user?.id, 'usr-salma');
    assert.equal(meStudentData.user?.role, 'membre');

    // 5. Connexion bibliothécaire + accès /api/admin/stats
    const libLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'bibliothecaire.demo@est-usmba.example',
        password: 'DemoBiblioEST2026!',
      }),
    });
    assert.equal(libLogin.status, 200);
    const libCookiePair = (libLogin.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(libCookiePair);

    const adminStats = await fetch(`${baseUrl}/api/admin/stats`, {
      headers: { Cookie: libCookiePair },
    });
    assert.equal(adminStats.status, 200);

    // 6. Déconnexion efface le cookie
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: libCookiePair,
        'X-Forwarded-Proto': 'https',
        'X-BiblioEST-Embed': 'cross-site-iframe',
      },
    });
    assert.equal(logoutRes.status, 200);
    const clearedCookie = logoutRes.headers.get('set-cookie') || '';
    assert.match(clearedCookie, /biblioest_session=;/);
    assert.match(clearedCookie, /SameSite=None/i);
    assert.match(clearedCookie, /Partitioned/i);

    const meAfterLogout = await fetch(`${baseUrl}/api/auth/me`);
    const afterLogoutData = (await meAfterLogout.json()) as {
      authenticated: boolean;
      user: unknown;
    };
    assert.equal(afterLogoutData.authenticated, false);
    assert.equal(afterLogoutData.user, null);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test('16. Inscription académique par code OTP (/api/auth/register & /api/auth/verify-email) : adresse vérifiée ≠ statut EST vérifié, et Google OAuth non configuré (501)', async () => {
  const { db, baseTime } = setupTestEnv();
  const { app } = createApp(db, () => baseTime);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Inscription avec adresse académique existante (mode démo pour récupérer le code OTP)
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Nouveau Candidat EST',
        email: 'candidat.est@usmba.ac.ma',
        password: 'Password123!',
        filiere: 'Génie Informatique',
        demoMode: true,
      }),
    });
    assert.equal(regRes.status, 201);
    const regJson = (await regRes.json()) as {
      user: { role: string; emailVerified: boolean; studentStatus: string; isAdmin: boolean };
      emailVerificationRequired: boolean;
      demoVerificationCode?: string;
    };
    assert.equal(regJson.emailVerificationRequired, true);
    assert.equal(regJson.user.role, 'membre');
    assert.equal(regJson.user.isAdmin, false);
    assert.equal(regJson.user.emailVerified, false);
    assert.equal(regJson.user.studentStatus, 'en_attente');
    assert.ok(regJson.demoVerificationCode);

    // 2. Validation du code reçu par e-mail -> emailVerified passe à true, mais studentStatus reste 'en_attente' !
    const verifyRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'candidat.est@usmba.ac.ma',
        code: regJson.demoVerificationCode,
        demoMode: true,
      }),
    });
    assert.equal(verifyRes.status, 200);
    const verifyJson = (await verifyRes.json()) as {
      authenticated: boolean;
      user: { emailVerified: boolean; studentStatus: string };
      eligibility: { eligible: boolean; reasonCode: string };
    };
    assert.equal(verifyJson.authenticated, true);
    assert.equal(verifyJson.user.emailVerified, true);
    assert.equal(verifyJson.user.studentStatus, 'en_attente');
    assert.equal(verifyJson.eligibility.eligible, false);
    assert.equal(verifyJson.eligibility.reasonCode, 'EST_STATUS_NOT_VERIFIED');

    // 3. Sans GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, /api/auth/google/url renvoie 501 sans simuler
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      const urlRes = await fetch(`${baseUrl}/api/auth/google/url`);
      assert.equal(urlRes.status, 501);
      const urlJson = (await urlRes.json()) as { code: string };
      assert.equal(urlJson.code, 'GOOGLE_OAUTH_NOT_CONFIGURED');
    }

    // 4. Un compte google_oidc ne peut jamais se connecter via /api/auth/login
    db.prepare(
      `INSERT INTO users (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, emailVerified, isAdmin, cne, filiere, authSource, isDemo, createdAt)
       VALUES ('usr-g1', 'Compte Google', 'etudiant.google@usmba.ac.ma', 'google_oidc:locked', 'membre', 'EST Fès', 'verifie', 'actif', 1, 0, NULL, NULL, 'google_oidc', 0, ?)`
    ).run(baseTime.toISOString());

    const loginGoogleViaPass = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'etudiant.google@usmba.ac.ma',
        password: 'AnyPassword',
      }),
    });
    assert.equal(loginGoogleViaPass.status, 403);
    const loginErr = (await loginGoogleViaPass.json()) as { code: string };
    assert.equal(loginErr.code, 'GOOGLE_OAUTH_REQUIRED');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test('17. GoogleAuthAdapter : adresse académique vérifiée ≠ statut EST Fès vérifié ; rôles bibliothécaire & admin attribués côté serveur', async () => {
  const { db, baseTime } = setupTestEnv();
  const adapter = new GoogleAuthAdapter({
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    APP_URL: 'https://biblio.est.example',
    GOOGLE_ALLOWED_HOSTED_DOMAIN: 'usmba.ac.ma',
    LIBRARIAN_EMAILS: 'chef.biblio@usmba.ac.ma',
    ADMIN_EMAILS: 'directeur.biblio@usmba.ac.ma',
  });

  // 1. Nouvel étudiant @usmba.ac.ma -> adresse vérifiée par Google, mais statut EST Fès en attente
  const candidate = await adapter.resolveProvisionedUser(
    db,
    {
      sub: 'sub-1',
      email: 'nouvel.etudiant@usmba.ac.ma',
      email_verified: true,
      name: 'Nouvel Étudiant',
      hd: 'usmba.ac.ma',
    },
    baseTime
  );
  assert.equal(candidate.user.role, 'membre');
  assert.equal(candidate.user.emailVerified, true);
  assert.equal(candidate.user.studentStatus, 'en_attente');
  assert.equal(candidate.requiresLibrarianValidation, true);

  // 2. Compte bibliothécaire configuré côté serveur -> rôle 'bibliothecaire'
  const librarian = await adapter.resolveProvisionedUser(
    db,
    {
      sub: 'sub-3',
      email: 'chef.biblio@usmba.ac.ma',
      email_verified: true,
      name: 'Conservateur EST Fès',
      hd: 'usmba.ac.ma',
    },
    baseTime
  );
  assert.equal(librarian.user.role, 'bibliothecaire');
  assert.equal(librarian.user.isAdmin, false);

  // 3. Compte administrateur configuré côté serveur -> rôle 'bibliothecaire' + isAdmin = true
  const admin = await adapter.resolveProvisionedUser(
    db,
    {
      sub: 'sub-4',
      email: 'directeur.biblio@usmba.ac.ma',
      email_verified: true,
      name: 'Directeur Bibliothèque',
      hd: 'usmba.ac.ma',
    },
    baseTime
  );
  assert.equal(admin.user.role, 'bibliothecaire');
  assert.equal(admin.user.isAdmin, true);
  db.close();
});

test('18 & 19. Diagramme 1 Panier : aucune pré-réservation, retenue 24 h si dispo, FIFO sinon, refus isolé des lignes impossibles et refus global si non éligible', () => {
  const { db, service, baseTime } = setupTestEnv();
  db.prepare(
    `INSERT INTO users (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, cne, filiere, authSource, createdAt)
     VALUES ('usr-amina', 'Amina Test', 'amina.test@usmba.example', 'hash', 'membre', 'EST Fès', 'verifie', 'actif', 'DEMO-T01', 'Génie Informatique', 'local', ?)`
  ).run(baseTime.toISOString());

  // Livre hors circulation (tous exemplaires retirés)
  const obsolete = service.createBook(
    {
      title: 'Manuel Obsolète',
      authors: 'Ancien Auteur',
      isbn: null,
      category: 'Génie Mécanique',
      description: 'Retiré',
      publisher: 'Test',
      publicationYear: 2005,
      edition: '1re',
      language: 'Français',
      coverImage: '/src/assets/images/cover_genie_mecanique_1794527754806.jpg',
      shelfLocation: 'MEC-99',
      featured: false,
    },
    baseTime
  );
  service.registerCopy(
    obsolete.id,
    { barcode: 'EST-OBS-1', physicalCondition: 'Hors service', location: 'Archives' },
    baseTime
  );

  // 1. Limite de 1 exemplaire par titre appliquée côté serveur
  assert.throws(
    () => service.addToCart('usr-amina', 'bk-algo', 2, baseTime),
    (err: unknown) => err instanceof DomainError && err.code === 'MAX_QUANTITY_PER_TITLE'
  );

  service.addToCart('usr-amina', 'bk-algo', 1, baseTime);
  service.addToCart('usr-amina', 'bk-sys-dist', 1, baseTime);
  service.addToCart('usr-amina', obsolete.id, 1, baseTime);

  // Vérifier que le panier ne diminue PAS la disponibilité avant confirmation
  assert.equal(service.getBookDetail('bk-algo', baseTime).availableCopies, 2);

  // 2. Confirmation du panier -> retenue 24 h pour bk-algo (aucun prêt immédiat), FIFO pour bk-sys-dist, refus pour obsolete
  const res = service.confirmCart('usr-amina', baseTime);
  assert.equal(res.results.length, 3);

  const algoItem = res.results.find((r) => r.bookId === 'bk-algo');
  assert.equal(algoItem?.outcome, 'retenue_24h_creee');
  assert.equal(algoItem?.reservation?.status, 'Retenu 24h');
  assert.equal(algoItem?.reservation?.requestType, 'retenue_24h');
  assert.equal(algoItem?.reservation?.pickupDeadline, new Date(baseTime.getTime() + 24 * 60 * 60 * 1000).toISOString());
  // Aucun code-barres exposé au membre
  assert.equal(algoItem?.reservation?.assignedCopyBarcode, null);
  assert.equal(algoItem?.reservation?.assignedCopyId, null);
  // Aucun prêt actif créé avant le passage au comptoir
  assert.equal(service.getMemberLoans('usr-amina', baseTime).length, 0);
  // Un exemplaire est passé de Disponible à Retenu 24h
  const algoAfter = service.getBookDetail('bk-algo', baseTime);
  assert.equal(algoAfter.availableCopies, 1);
  assert.equal(algoAfter.held24hCopies, 1);

  const sysItem = res.results.find((r) => r.bookId === 'bk-sys-dist');
  assert.equal(sysItem?.outcome, 'reservation_enregistree');
  assert.equal(sysItem?.reservation?.status, 'En attente');
  assert.equal(sysItem?.reservation?.assignedCopyBarcode, null);

  assert.equal(res.results.find((r) => r.bookId === obsolete.id)?.outcome, 'refuse');
  // Seul l'article refusé reste dans le panier ; les lignes acceptées ont été confirmées et retirées du panier
  assert.equal(res.remainingCartCount, 1);

  // 3. Un membre en retard (usr-youssef) ou non vérifié EST (usr-karim) voit son panier refusé globalement sans mutation
  service.addToCart('usr-youssef', 'bk-algo', 1, baseTime);
  assert.throws(
    () => service.confirmCart('usr-youssef', baseTime),
    (err: unknown) => err instanceof DomainError && err.statusCode === 403 && err.code === 'OVERDUE_RETURN'
  );
  assert.equal(service.getCart('usr-youssef', baseTime).length, 1);
  assert.equal(service.getMemberReservations('usr-youssef', baseTime).length, 0);
  assert.equal(service.getBookDetail('bk-algo', baseTime).availableCopies, 1);

  service.addToCart('usr-karim', 'bk-algo', 1, baseTime);
  assert.throws(
    () => service.confirmCart('usr-karim', baseTime),
    (err: unknown) => err instanceof DomainError && err.statusCode === 403 && err.code === 'EST_STATUS_NOT_VERIFIED'
  );
  assert.equal(service.getCart('usr-karim', baseTime).length, 1);
  assert.equal(service.getMemberReservations('usr-karim', baseTime).length, 0);

  db.close();
});

test('20 & 21. Prêt direct bibliothécaire, concurrence sur dernier exemplaire et journal d’audit complet', () => {
  const { db, service, baseTime } = setupTestEnv();
  const book = service.createBook(
    {
      title: 'Réseaux Locaux Industriels',
      authors: 'Prof. Benchakroun',
      isbn: null,
      category: 'Génie Électrique',
      description: 'Test concurrence',
      publisher: 'EST Fès',
      publicationYear: 2025,
      edition: '1re',
      language: 'Français',
      coverImage: '/src/assets/images/cover_genie_electrique_1794527754591.jpg',
      shelfLocation: 'GEL-77',
      featured: false,
    },
    baseTime
  );
  service.registerCopy(
    book.id,
    { barcode: 'EST-UNIQUE-1', physicalCondition: 'Neuf', location: 'GEL-77' },
    baseTime
  );

  // 1. Le bibliothécaire ne peut pas enregistrer un prêt pour un membre en retard
  assert.throws(
    () =>
      service.createLoanAdmin(
        'usr-youssef',
        book.id,
        null,
        { id: 'usr-lib', fullName: 'Nadia Benali', role: 'bibliothecaire' },
        baseTime
      ),
    (err: unknown) => err instanceof DomainError && err.code === 'OVERDUE_RETURN'
  );

  // 2. Le premier membre obtient l'unique exemplaire ; le second échoue proprement sans double attribution
  const loan1 = service.createLoanAdmin(
    'usr-bilale',
    book.id,
    null,
    { id: 'usr-lib', fullName: 'Nadia Benali', role: 'bibliothecaire' },
    baseTime
  );
  assert.equal(loan1.copyBarcode, 'EST-UNIQUE-1');

  assert.throws(
    () => service.borrowBook('usr-salma', book.id, baseTime),
    (err: unknown) => err instanceof DomainError && err.code === 'NO_AVAILABLE_COPY'
  );

  // 3. Vérification de la traçabilité dans le journal d'audit
  const logs = service.getAuditLogsAdmin(50);
  assert.ok(logs.some((l) => l.action === 'BOOK_CREATED' && l.entityId === book.id));
  assert.ok(logs.some((l) => l.action === 'COPY_REGISTERED'));
  assert.ok(logs.some((l) => l.action === 'LOAN_CREATED' && l.entityId === loan1.id));

  db.close();
});

test('22. Connexion Gmail académique (/api/auth/google/firebase) : rejette les comptes personnels et provisionne un compte @usmba.ac.ma avec session cookie', async () => {
  const { db, baseTime } = setupTestEnv();
  const mockGoogleFetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('openidconnect.googleapis.com/v1/userinfo')) {
      return new Response(
        JSON.stringify({
          sub: 'google-sub-test',
          email: 'bilale.zorgane@usmba.ac.ma',
          email_verified: true,
          name: 'Bilale Zorgane',
          hd: 'usmba.ac.ma',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  }) as typeof fetch;

  const adapter = new GoogleAuthAdapter({}, mockGoogleFetch);
  const { app } = createApp(db, () => baseTime, adapter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Rejet si aucun jeton fourni
    const missingRes = await fetch(`${baseUrl}/api/auth/google/firebase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(missingRes.status, 400);

    // 2. Rejet si compte personnel @gmail.com
    const personalFetch = (async () =>
      new Response(
        JSON.stringify({
          sub: 'google-sub-personal',
          email: 'perso.utilisateur@gmail.com',
          email_verified: true,
          name: 'Compte Personnel',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch;
    const personalAdapter = new GoogleAuthAdapter({}, personalFetch);
    const { app: personalApp } = createApp(db, () => baseTime, personalAdapter);
    const personalServer = http.createServer(personalApp);
    await new Promise<void>((resolve) => personalServer.listen(0, '127.0.0.1', resolve));
    const personalAddr = personalServer.address();
    assert.ok(personalAddr && typeof personalAddr === 'object');

    try {
      const rejectedRes = await fetch(`http://127.0.0.1:${personalAddr.port}/api/auth/google/firebase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: 'fake-personal-token' }),
      });
      assert.equal(rejectedRes.status, 403);
      const rejectedJson = (await rejectedRes.json()) as { code: string };
      assert.equal(rejectedJson.code, 'ACADEMIC_GOOGLE_AUTH_REJECTED');
    } finally {
      await new Promise<void>((resolve) => personalServer.close(() => resolve()));
    }

    // 3. Connexion valide avec Gmail académique @usmba.ac.ma -> statut EST en attente pour un nouveau compte,
    // puis éligible dès que la bibliothèque valide le statut EST Fès
    const loginRes = await fetch(`${baseUrl}/api/auth/google/firebase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: 'valid-usmba-access-token' }),
    });
    assert.equal(loginRes.status, 200);
    const setCookie = loginRes.headers.get('set-cookie') || '';
    assert.match(setCookie, /HttpOnly/i);
    const cookiePair = setCookie.split(';')[0];
    assert.ok(cookiePair);

    const loginJson = (await loginRes.json()) as {
      authenticated: boolean;
      user: { id: string; email: string; authSource: string; emailVerified: boolean; studentStatus: string; accountStatus: string; role: string };
      eligibility: { eligible: boolean; reasonCode: string };
      requiresLibrarianValidation: boolean;
    };
    assert.equal(loginJson.authenticated, true);
    assert.equal(loginJson.user.email, 'bilale.zorgane@usmba.ac.ma');
    assert.equal(loginJson.user.authSource, 'google_oidc');
    assert.equal(loginJson.user.emailVerified, true);
    assert.equal(loginJson.user.studentStatus, 'en_attente');
    assert.equal(loginJson.user.accountStatus, 'actif');
    assert.equal(loginJson.user.role, 'membre');
    assert.equal(loginJson.eligibility.eligible, false);
    assert.equal(loginJson.eligibility.reasonCode, 'EST_STATUS_NOT_VERIFIED');
    assert.equal(loginJson.requiresLibrarianValidation, true);

    // Un bibliothécaire valide le statut EST Fès -> la reconnexion conserve le statut 'verifie' et rend le compte éligible
    db.prepare(`UPDATE users SET studentStatus = 'verifie' WHERE id = ?`).run(loginJson.user.id);
    const reLoginRes = await fetch(`${baseUrl}/api/auth/google/firebase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: 'valid-usmba-access-token' }),
    });
    assert.equal(reLoginRes.status, 200);
    const reLoginJson = (await reLoginRes.json()) as {
      user: { studentStatus: string };
      eligibility: { eligible: boolean; reasonCode: string };
      requiresLibrarianValidation: boolean;
    };
    assert.equal(reLoginJson.user.studentStatus, 'verifie');
    assert.equal(reLoginJson.eligibility.eligible, true);
    assert.equal(reLoginJson.eligibility.reasonCode, 'ELIGIBLE');
    assert.equal(reLoginJson.requiresLibrarianValidation, false);

    // 4. Vérification /api/auth/me avec le cookie de session émis
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: cookiePair },
    });
    assert.equal(meRes.status, 200);
    const meJson = (await meRes.json()) as {
      authenticated: boolean;
      user: { email: string } | null;
    };
    assert.equal(meJson.authenticated, true);
    assert.equal(meJson.user?.email, 'bilale.zorgane@usmba.ac.ma');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test('23. Notification des emprunts en retard (/api/admin/loans/notify-overdue) : réservée au bibliothécaire, enregistre rappel et journal d’audit', async () => {
  const { db, baseTime } = setupTestEnv();
  const { app } = createApp(db, () => baseTime);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Membre non bibliothécaire -> 403
    const memLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'salma.demo@usmba.example',
        password: 'DemoBiblioEST2026!',
      }),
    });
    const memCookie = (memLogin.headers.get('set-cookie') || '').split(';')[0];
    const forbiddenRes = await fetch(`${baseUrl}/api/admin/loans/notify-overdue`, {
      method: 'POST',
      headers: { Cookie: memCookie },
    });
    assert.equal(forbiddenRes.status, 403);

    // 2. Bibliothécaire -> 200 avec destinataire usr-youssef (emprunt en retard dans le seed)
    const libLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'bibliothecaire.demo@est-usmba.example',
        password: 'DemoBiblioEST2026!',
      }),
    });
    const libCookie = (libLogin.headers.get('set-cookie') || '').split(';')[0];

    const notifyRes = await fetch(`${baseUrl}/api/admin/loans/notify-overdue`, {
      method: 'POST',
      headers: { Cookie: libCookie },
    });
    assert.equal(notifyRes.status, 200);
    const notifyJson = (await notifyRes.json()) as {
      notifiedMembersCount: number;
      overdueLoansCount: number;
      recipients: Array<{ memberId: string; memberEmail: string; books: Array<{ title: string }> }>;
    };
    assert.equal(notifyJson.notifiedMembersCount, 1);
    assert.equal(notifyJson.overdueLoansCount, 1);
    assert.equal(notifyJson.recipients[0]?.memberId, 'usr-youssef');
    assert.equal(notifyJson.recipients[0]?.memberEmail, 'youssef.demo@usmba.example');
    assert.ok((notifyJson.recipients[0]?.books.length || 0) >= 1);

    // 3. Vérifier la notification enregistrée pour usr-youssef et l'entrée d'audit
    const notifs = db
      .prepare(`SELECT * FROM notifications WHERE userId = 'usr-youssef' AND type = 'rappel'`)
      .all() as Array<{ title: string }>;
    assert.ok(notifs.some((n) => n.title.includes('Emprunt en retard')));

    const audit = db
      .prepare(`SELECT * FROM audit_logs WHERE action = 'OVERDUE_MEMBERS_NOTIFIED'`)
      .all();
    assert.equal(audit.length, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test('24. Envoi réel via Gmail API (/api/admin/loans/notify-overdue) : transmet le message MIME encodé pour une session réelle', async () => {
  const { db, baseTime } = setupTestEnv();
  // Insérer un bibliothécaire réel (isDemo = 0) et Bilale Zorgane avec emprunt en retard
  db.prepare(`
    INSERT INTO users (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, emailVerified, isAdmin, cne, filiere, authSource, isDemo, createdAt)
    VALUES ('usr-real-lib', 'Bibliothécaire Réel', 'biblio.reel@usmba.ac.ma', ?, 'bibliothecaire', 'EST Fès', 'verifie', 'actif', 1, 0, NULL, NULL, 'local', 0, ?),
           ('usr-bilale-z', 'Bilale Zorgane', 'bilale.zorgane@usmba.ac.ma', 'hash', 'membre', 'EST Fès', 'verifie', 'actif', 1, 0, 'N138092451', 'Génie Informatique', 'google_oidc', 0, ?)
  `).run(hashPassword('RealLib2026!'), baseTime.toISOString(), baseTime.toISOString());
  db.prepare(`
    INSERT INTO loans (id, memberId, copyId, bookId, borrowedAt, dueAt, returnedAt, returnCondition, returnNotes, status)
    VALUES ('ln-bz-overdue', 'usr-bilale-z', 'cp-algo-1', 'bk-algo', '2026-11-01T00:00:00.000Z', '2026-11-08T00:00:00.000Z', NULL, NULL, NULL, 'En retard')
  `).run();

  const originalFetch = globalThis.fetch;
  let gmailApiPayloadSent: { raw?: string } | null = null;
  let gmailAuthHeader: string | null = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (urlStr.includes('gmail.googleapis.com/gmail/v1/users/me/messages/send')) {
      gmailAuthHeader = (init?.headers as Record<string, string> | undefined)?.Authorization || null;
      gmailApiPayloadSent = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ id: 'msg-gmail-123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  const { app } = createApp(db, () => baseTime);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const libLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'biblio.reel@usmba.ac.ma',
        password: 'RealLib2026!',
      }),
    });
    assert.equal(libLogin.status, 200);
    const libCookie = (libLogin.headers.get('set-cookie') || '').split(';')[0];

    const notifyRes = await fetch(`${baseUrl}/api/admin/loans/notify-overdue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: libCookie },
      body: JSON.stringify({ googleAccessToken: 'ya29.google-test-token' }),
    });

    assert.equal(notifyRes.status, 200);
    const notifyJson = (await notifyRes.json()) as {
      gmailApiUsed: boolean;
      demoSimulated: boolean;
      emailsSentCount: number;
      recipients: Array<{ memberEmail: string; emailSent: boolean }>;
    };
    assert.equal(notifyJson.demoSimulated, false);
    assert.equal(notifyJson.gmailApiUsed, true);
    assert.equal(gmailAuthHeader, 'Bearer ya29.google-test-token');
    assert.ok(notifyJson.emailsSentCount >= 1);
    const payload = gmailApiPayloadSent as { raw?: string } | null;
    assert.ok(payload?.raw);

    const decodedMime = Buffer.from(
      payload.raw.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf-8');
    assert.ok(decodedMime.includes('bilale.zorgane@usmba.ac.ma'));
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test('25. Ajout en lot d’exemplaires (/api/admin/books/:id/copies/batch) et attribution automatique en file FIFO', () => {
  const { db, service, baseTime } = setupTestEnv();
  // bk-sys-dist a 0 dispo et Salma (#1) en attente dans le seed
  const batchRes = service.registerCopiesBatch(
    'bk-sys-dist',
    {
      barcodes: ['EST-SYS-B1', 'EST-SYS-B2', 'EST-SYS-B1', 'EST-INF-0101'],
      physicalCondition: 'Neuf',
      location: 'Rayon · INF-03-C',
    },
    baseTime,
    { id: 'usr-lib', fullName: 'Nadia Benali', role: 'bibliothecaire' }
  );

  assert.equal(batchRes.created.length, 2);
  assert.deepEqual(batchRes.skippedBarcodes, ['EST-INF-0101']);
  assert.equal(batchRes.assignedReservationsCount, 1);

  const salmaRes = service
    .getMemberReservations('usr-salma', baseTime)
    .find((r) => r.id === 'res-salma-sys');
  assert.equal(salmaRes?.status, 'Disponible pour retrait');
  db.close();
});

test('26. Bascule d’état de retard pour test (/api/admin/loans/:id/toggle-overdue-test)', () => {
  const { db, service, baseTime } = setupTestEnv();
  const loan = service.borrowBook('usr-bilale', 'bk-algo', baseTime);
  assert.equal(loan.status, 'En cours');

  const overdue = service.toggleLoanOverdueTest(
    loan.id,
    { id: 'usr-lib', fullName: 'Nadia Benali', role: 'bibliothecaire' },
    baseTime
  );
  assert.equal(overdue.status, 'En retard');

  const restored = service.toggleLoanOverdueTest(
    loan.id,
    { id: 'usr-lib', fullName: 'Nadia Benali', role: 'bibliothecaire' },
    baseTime
  );
  assert.equal(restored.status, 'En cours');
  db.close();
});

test('27. Rôles Administrateur, paramètres bibliothèque et restriction stricte du bouton d’e-mail de test', async () => {
  const { db, baseTime } = setupTestEnv();
  const { app } = createApp(db, () => baseTime);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Simple bibliothécaire (isAdmin = false) ne peut pas modifier les rôles ni les paramètres
    const libLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'bibliothecaire.demo@est-usmba.example',
        password: 'DemoBiblioEST2026!',
      }),
    });
    const libCookie = (libLogin.headers.get('set-cookie') || '').split(';')[0];

    const forbiddenRoleRes = await fetch(`${baseUrl}/api/admin/members/usr-salma/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: libCookie },
      body: JSON.stringify({ role: 'bibliothecaire', isAdmin: false }),
    });
    assert.equal(forbiddenRoleRes.status, 403);

    const forbiddenSettingsRes = await fetch(`${baseUrl}/api/admin/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: libCookie },
      body: JSON.stringify({ borrowingDurationDays: 14 }),
    });
    assert.equal(forbiddenSettingsRes.status, 403);

    // 2. E-mail de test refusé si destinataire différent de l'adresse de test configurée
    const wrongRecipientRes = await fetch(`${baseUrl}/api/admin/email/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: libCookie },
      body: JSON.stringify({ recipientEmail: 'autre@example.com' }),
    });
    assert.equal(wrongRecipientRes.status, 403);
    const wrongRecipientJson = (await wrongRecipientRes.json()) as { code: string };
    assert.equal(wrongRecipientJson.code, 'TEST_EMAIL_RECIPIENT_RESTRICTED');

    // 3. Administrateur (usr-admin) peut attribuer un rôle bibliothécaire et configurer les paramètres
    const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin.demo@est-usmba.example',
        password: 'DemoBiblioEST2026!',
      }),
    });
    assert.equal(adminLogin.status, 200);
    const adminCookie = (adminLogin.headers.get('set-cookie') || '').split(';')[0];

    const promoteRes = await fetch(`${baseUrl}/api/admin/members/usr-salma/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ role: 'bibliothecaire', isAdmin: false }),
    });
    assert.equal(promoteRes.status, 200);
    const promoteJson = (await promoteRes.json()) as { member: { role: string } };
    assert.equal(promoteJson.member.role, 'bibliothecaire');

    const patchSettingsRes = await fetch(`${baseUrl}/api/admin/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ borrowingDurationDays: 10, pickupWindowDays: 4 }),
    });
    assert.equal(patchSettingsRes.status, 200);
    const settingsJson = (await patchSettingsRes.json()) as {
      settings: { borrowingDurationDays: number; pickupWindowDays: number };
    };
    assert.equal(settingsJson.settings.borrowingDurationDays, 10);
    assert.equal(settingsJson.settings.pickupWindowDays, 4);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test('28. Isolation stricte du Mode Démo : bases séparées, horloge simulée, journal d’e-mails simulés, réinitialisation et blocage si désactivé', async () => {
  const baseTime = new Date('2026-11-12T10:00:00.000Z');
  const realDb = createDatabase(':memory:');
  seedDatabaseIfEmpty(realDb, baseTime, { isDemoSandbox: false });
  const demoDb = createDatabase(':memory:');
  seedDatabaseIfEmpty(demoDb, baseTime, { isDemoSandbox: true });

  const { app } = createApp(realDb, () => baseTime, undefined, demoDb);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Connexion en Mode Démo avec un bibliothécaire démo
    const demoLibLogin = await fetch(`${baseUrl}/api/auth/demo-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'usr-lib' }),
    });
    assert.equal(demoLibLogin.status, 200);
    const demoCookie = (demoLibLogin.headers.get('set-cookie') || '').split(';')[0];

    // 2. Notification des retards en Mode Démo -> enregistre dans simulated_outbox, aucun appel réel
    const notifyDemoRes = await fetch(`${baseUrl}/api/admin/loans/notify-overdue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: demoCookie },
    });
    assert.equal(notifyDemoRes.status, 200);
    const notifyDemoJson = (await notifyDemoRes.json()) as {
      demoSimulated: boolean;
      emailsSentCount: number;
    };
    assert.equal(notifyDemoJson.demoSimulated, true);
    assert.equal(notifyDemoJson.emailsSentCount, 1);

    const demoOutbox = demoDb.prepare(`SELECT * FROM simulated_outbox`).all();
    assert.equal(demoOutbox.length, 1);
    const realOutbox = realDb.prepare(`SELECT * FROM simulated_outbox`).all();
    assert.equal(realOutbox.length, 0);

    // 3. Créer un livre dans demoDb ne touche PAS realDb
    const createDemoBook = await fetch(`${baseUrl}/api/admin/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: demoCookie },
      body: JSON.stringify({
        title: 'Ouvrage Uniquement Démo',
        authors: 'Test Sandbox',
        category: 'Génie Informatique',
        shelfLocation: 'DEMO-99',
      }),
    });
    assert.equal(createDemoBook.status, 201);
    assert.equal(
      (demoDb.prepare(`SELECT COUNT(*) as c FROM books WHERE title = 'Ouvrage Uniquement Démo'`).get() as { c: number }).c,
      1
    );
    assert.equal(
      (realDb.prepare(`SELECT COUNT(*) as c FROM books WHERE title = 'Ouvrage Uniquement Démo'`).get() as { c: number }).c,
      0
    );

    // 4. Avancer l'horloge simulée de +4 jours
    const clockRes = await fetch(`${baseUrl}/api/demo/clock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: demoCookie },
      body: JSON.stringify({ addDays: 4 }),
    });
    assert.equal(clockRes.status, 200);
    const clockJson = (await clockRes.json()) as { clockOffsetDays: number };
    assert.equal(clockJson.clockOffsetDays, 4);

    // 5. Réinitialiser la démo supprime l'ouvrage démo et remet l'horloge à 0
    const resetRes = await fetch(`${baseUrl}/api/demo/reset`, {
      method: 'POST',
      headers: { Cookie: demoCookie },
    });
    assert.equal(resetRes.status, 200);
    const resetJson = (await resetRes.json()) as { clockOffsetDays: number; outbox: unknown[] };
    assert.equal(resetJson.clockOffsetDays, 0);
    assert.equal(resetJson.outbox.length, 0);
    assert.equal(
      (demoDb.prepare(`SELECT COUNT(*) as c FROM books WHERE title = 'Ouvrage Uniquement Démo'`).get() as { c: number }).c,
      0
    );

    // 6. Si DISABLE_DEMO_MODE=true, /api/demo/state et /api/auth/demo-login renvoient 403
    const prevFlag = process.env.DISABLE_DEMO_MODE;
    process.env.DISABLE_DEMO_MODE = 'true';
    try {
      const blockedState = await fetch(`${baseUrl}/api/demo/state`);
      assert.equal(blockedState.status, 403);
      const blockedLogin = await fetch(`${baseUrl}/api/auth/demo-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'usr-salma' }),
      });
      assert.equal(blockedLogin.status, 403);
    } finally {
      if (prevFlag === undefined) delete process.env.DISABLE_DEMO_MODE;
      else process.env.DISABLE_DEMO_MODE = prevFlag;
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    realDb.close();
    demoDb.close();
  }
});

test('29. Confidentialité des codes-barres physiques : masqués dans le parcours public/membre et visibles uniquement pour le personnel', async () => {
  const { db, baseTime } = setupTestEnv();
  const { app } = createApp(db, () => baseTime);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Visiteur anonyme : copies = []
    const anonDetailRes = await fetch(`${baseUrl}/api/books/bk-algo`);
    assert.equal(anonDetailRes.status, 200);
    const anonDetail = (await anonDetailRes.json()) as { book: { copies: unknown[]; availableCopies: number } };
    assert.equal(anonDetail.book.availableCopies, 2);
    assert.equal(anonDetail.book.copies.length, 0);

    // 2. Membre connecté (Salma) : copies = [] et /api/reservations/mine masque assignedCopyId / assignedCopyBarcode
    const memLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'salma.demo@usmba.example',
        password: 'DemoBiblioEST2026!',
      }),
    });
    const memCookie = (memLogin.headers.get('set-cookie') || '').split(';')[0];

    const memDetailRes = await fetch(`${baseUrl}/api/books/bk-maths`, {
      headers: { Cookie: memCookie },
    });
    const memDetail = (await memDetailRes.json()) as { book: { copies: unknown[] } };
    assert.equal(memDetail.book.copies.length, 0);

    const myResResponse = await fetch(`${baseUrl}/api/reservations/mine`, {
      headers: { Cookie: memCookie },
    });
    const myResJson = (await myResResponse.json()) as {
      reservations: Array<{ id: string; assignedCopyId: string | null; assignedCopyBarcode: string | null }>;
    };
    const mathsReady = myResJson.reservations.find((r) => r.id === 'res-salma-maths');
    assert.ok(mathsReady);
    assert.equal(mathsReady?.assignedCopyId, null);
    assert.equal(mathsReady?.assignedCopyBarcode, null);

    // 3. Bibliothécaire : voit la liste complète des exemplaires physiques avec codes-barres
    const libLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'bibliothecaire.demo@est-usmba.example',
        password: 'DemoBiblioEST2026!',
      }),
    });
    const libCookie = (libLogin.headers.get('set-cookie') || '').split(';')[0];

    const libDetailRes = await fetch(`${baseUrl}/api/books/bk-maths`, {
      headers: { Cookie: libCookie },
    });
    const libDetail = (await libDetailRes.json()) as { book: { copies: Array<{ barcode: string }> } };
    assert.ok(libDetail.book.copies.some((c) => c.barcode === 'EST-MAT-0602'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test('30. Diagramme 2 Comptoir : scan carte membre + code-barres copie, refus sans mutation sur mauvais exemplaire, prêt 7 j et journal des états', async () => {
  const { db, baseTime } = setupTestEnv();
  const { app } = createApp(db, () => baseTime);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Membre non autorisé à accéder au comptoir
    const memLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'salma.demo@usmba.example',
        password: 'DemoBiblioEST2026!',
      }),
    });
    const memCookie = (memLogin.headers.get('set-cookie') || '').split(';')[0];
    const forbiddenCounter = await fetch(`${baseUrl}/api/admin/counter/member?q=DEMO-N002`, {
      headers: { Cookie: memCookie },
    });
    assert.equal(forbiddenCounter.status, 403);

    // 2. Connexion bibliothécaire & scan de la carte membre d'Amine (CNE DEMO-N002)
    const libLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'bibliothecaire.demo@est-usmba.example',
        password: 'DemoBiblioEST2026!',
      }),
    });
    const libCookie = (libLogin.headers.get('set-cookie') || '').split(';')[0];

    const lookupRes = await fetch(`${baseUrl}/api/admin/counter/member?q=DEMO-N002`, {
      headers: { Cookie: libCookie },
    });
    assert.equal(lookupRes.status, 200);
    const lookupJson = (await lookupRes.json()) as {
      dossier: {
        member: { id: string; fullName: string };
        eligibility: { eligible: boolean };
        holds24h: Array<{ id: string; assignedCopyBarcode: string | null }>;
        activeLoans: Array<{ id: string }>;
      };
    };
    assert.equal(lookupJson.dossier.member.id, 'usr-bilale');
    assert.equal(lookupJson.dossier.eligibility.eligible, true);
    assert.equal(lookupJson.dossier.holds24h.length, 1);
    assert.equal(lookupJson.dossier.holds24h[0]?.assignedCopyBarcode, 'EST-TMG-0402');

    // 3. Scan d'un mauvais exemplaire du même titre (EST-TMG-0401) -> refus 409 sans aucune mutation
    const wrongCopyRes = await fetch(`${baseUrl}/api/admin/counter/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: libCookie },
      body: JSON.stringify({ memberId: 'usr-bilale', barcode: 'EST-TMG-0401' }),
    });
    assert.equal(wrongCopyRes.status, 409);
    const wrongCopyJson = (await wrongCopyRes.json()) as { code: string };
    assert.equal(wrongCopyJson.code, 'WRONG_COPY_FOR_REQUEST');

    // Scan d'un exemplaire affecté à un autre membre (EST-MAT-0602 attribué à Salma) -> refus 409
    const otherMemberCopyRes = await fetch(`${baseUrl}/api/admin/counter/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: libCookie },
      body: JSON.stringify({ memberId: 'usr-bilale', barcode: 'EST-MAT-0602' }),
    });
    assert.equal(otherMemberCopyRes.status, 409);
    const otherMemberCopyJson = (await otherMemberCopyRes.json()) as { code: string };
    assert.equal(otherMemberCopyJson.code, 'COPY_ASSIGNED_TO_OTHER_MEMBER');

    // Vérifier qu'aucun état n'a changé après les 2 scans invalides
    const copyRowAfterWrong = db
      .prepare(`SELECT status FROM copies WHERE id = 'cp-compta-2'`)
      .get() as { status: string };
    assert.equal(copyRowAfterWrong.status, 'Retenu 24h');

    // 4. Scan du bon code-barres (EST-TMG-0402) -> crée un prêt de 7 jours + journalise l'agent
    const validCheckoutRes = await fetch(`${baseUrl}/api/admin/counter/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: libCookie },
      body: JSON.stringify({ memberId: 'usr-bilale', barcode: 'EST-TMG-0402' }),
    });
    assert.equal(validCheckoutRes.status, 201);
    const checkoutJson = (await validCheckoutRes.json()) as {
      loan: { id: string; dueAt: string; copyBarcode: string; status: string };
      fulfilledRequest: { status: string };
      dossier: { holds24h: unknown[]; activeLoans: Array<{ id: string }> };
    };
    assert.equal(checkoutJson.loan.copyBarcode, 'EST-TMG-0402');
    assert.equal(checkoutJson.loan.status, 'En cours');
    assert.equal(checkoutJson.loan.dueAt, addDays(baseTime, 7).toISOString());
    assert.equal(checkoutJson.fulfilledRequest.status, 'Retirée');
    assert.equal(checkoutJson.dossier.holds24h.length, 0);

    // 5. Scan retour au comptoir (/api/admin/counter/scan-return) identifie le prêt actif
    const scanReturnRes = await fetch(`${baseUrl}/api/admin/counter/scan-return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: libCookie },
      body: JSON.stringify({ barcode: 'EST-TMG-0402' }),
    });
    assert.equal(scanReturnRes.status, 200);
    const scanReturnJson = (await scanReturnRes.json()) as { activeLoan: { id: string } | null };
    assert.equal(scanReturnJson.activeLoan?.id, checkoutJson.loan.id);

    // 6. Vérification du journal des états d'exemplaires (/api/admin/copy-state-logs)
    const stateLogsRes = await fetch(`${baseUrl}/api/admin/copy-state-logs`, {
      headers: { Cookie: libCookie },
    });
    assert.equal(stateLogsRes.status, 200);
    const stateLogsJson = (await stateLogsRes.json()) as {
      logs: Array<{ copyBarcode: string; oldStatus: string | null; newStatus: string; agentId: string | null }>;
    };
    assert.ok(
      stateLogsJson.logs.some(
        (l) =>
          l.copyBarcode === 'EST-TMG-0402' &&
          l.oldStatus === 'Retenu 24h' &&
          l.newStatus === 'Emprunté' &&
          l.agentId === 'usr-lib'
      )
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test('31. Diagramme 3 : expiration automatique après 25 h d’une retenue 24 h bascule vers la file FIFO (3 j) ou Disponible', async () => {
  const baseTime = new Date('2026-11-12T10:00:00.000Z');
  const realDb = createDatabase(':memory:');
  seedDatabaseIfEmpty(realDb, baseTime, { isDemoSandbox: false });
  const demoDb = createDatabase(':memory:');
  seedDatabaseIfEmpty(demoDb, baseTime, { isDemoSandbox: true });

  const { app } = createApp(realDb, () => baseTime, undefined, demoDb);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Retirer l'autre exemplaire disponible de bk-comptabilite (cp-compta-1) par Salma pour ne laisser que cp-compta-2 ('Retenu 24h')
    const salmaLogin = await fetch(`${baseUrl}/api/auth/demo-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'usr-salma' }),
    });
    const salmaCookie = (salmaLogin.headers.get('set-cookie') || '').split(';')[0];

    await fetch(`${baseUrl}/api/cart/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: salmaCookie },
      body: JSON.stringify({ bookId: 'bk-comptabilite', quantity: 1 }),
    });
    const salmaConfirm = await fetch(`${baseUrl}/api/cart/confirm`, {
      method: 'POST',
      headers: { Cookie: salmaCookie },
    });
    assert.equal(salmaConfirm.status, 200);

    // 2. Créer un 3e membre démo éligible (Omar) qui demande bk-comptabilite via panier -> aucun dispo donc entre en file FIFO (#1)
    demoDb
      .prepare(
        `INSERT INTO users (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, emailVerified, isAdmin, cne, filiere, authSource, isDemo, createdAt)
         VALUES ('usr-omar', 'Omar FIFO (Démo)', 'omar.demo@usmba.example', 'hash', 'membre', 'EST Fès', 'verifie', 'actif', 1, 0, 'DEMO-N099', 'Génie Informatique', 'local', 1, ?)`
      )
      .run(baseTime.toISOString());

    const omarLogin = await fetch(`${baseUrl}/api/auth/demo-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'usr-omar' }),
    });
    const omarCookie = (omarLogin.headers.get('set-cookie') || '').split(';')[0];

    await fetch(`${baseUrl}/api/cart/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: omarCookie },
      body: JSON.stringify({ bookId: 'bk-comptabilite', quantity: 1 }),
    });
    const omarConfirmRes = await fetch(`${baseUrl}/api/cart/confirm`, {
      method: 'POST',
      headers: { Cookie: omarCookie },
    });
    assert.equal(omarConfirmRes.status, 200);
    const omarConfirm = (await omarConfirmRes.json()) as {
      results: Array<{ outcome: string; reservation?: { status: string; queuePosition: number | null } }>;
    };
    assert.equal(omarConfirm.results[0]?.outcome, 'reservation_enregistree');
    assert.equal(omarConfirm.results[0]?.reservation?.status, 'En attente');
    assert.equal(omarConfirm.results[0]?.reservation?.queuePosition, 1);

    // 3. Avancer l'horloge démo de +25 heures -> les deux retenues 24 h (Amine & Salma) expirent :
    // cp-compta-2 passe au premier FIFO (Omar, délai 3 jours, statut copie 'Réservé') et cp-compta-1 redevient 'Disponible' !
    const clockRes = await fetch(`${baseUrl}/api/demo/clock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: omarCookie },
      body: JSON.stringify({ addHours: 25 }),
    });
    assert.equal(clockRes.status, 200);
    const clockJson = (await clockRes.json()) as {
      clockOffsetHours: number;
      expiredReservationsCount: number;
    };
    assert.equal(clockJson.clockOffsetHours, 25);
    assert.ok(clockJson.expiredReservationsCount >= 2);

    const omarResList = (await (
      await fetch(`${baseUrl}/api/reservations/mine`, { headers: { Cookie: omarCookie } })
    ).json()) as { reservations: Array<{ bookId: string; status: string }> };
    assert.equal(
      omarResList.reservations.find((r) => r.bookId === 'bk-comptabilite')?.status,
      'Disponible pour retrait'
    );

    const cpCompta1 = demoDb
      .prepare(`SELECT status FROM copies WHERE id = 'cp-compta-1'`)
      .get() as { status: string };
    const cpCompta2 = demoDb
      .prepare(`SELECT status FROM copies WHERE id = 'cp-compta-2'`)
      .get() as { status: string };
    const statuses = [cpCompta1.status, cpCompta2.status].sort();
    assert.deepEqual(statuses, ['Disponible', 'Réservé']);

    const stateLogs = demoDb
      .prepare(`SELECT oldStatus, newStatus FROM copy_state_logs WHERE bookId = 'bk-comptabilite'`)
      .all() as Array<{ oldStatus: string | null; newStatus: string }>;
    assert.ok(stateLogs.some((l) => l.oldStatus === 'Retenu 24h' && l.newStatus === 'Réservé'));
    assert.ok(stateLogs.some((l) => l.oldStatus === 'Retenu 24h' && l.newStatus === 'Disponible'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    realDb.close();
    demoDb.close();
  }
});



