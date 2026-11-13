import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDatabase, seedDatabaseIfEmpty } from '../server/db/database.ts';
import { createApp } from '../server/app.ts';
import { GoogleAuthAdapter } from '../server/auth/googleAuthAdapter.ts';
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

test('2. Un membre inéligible (statut EST Fès non vérifié ou compte non vérifié) ne peut pas emprunter', () => {
  const { service, baseTime } = setupTestEnv();
  assert.throws(
    () => service.borrowBook('usr-karim', 'bk-algo', baseTime),
    (err: unknown) =>
      err instanceof DomainError &&
      err.statusCode === 403 &&
      err.code === 'EST_STATUS_NOT_VERIFIED'
  );
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
      n.message.includes("Aucune date de disponibilité n'est garantie")
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

test('6 & 7. File FIFO stricte et attribution en deux étapes (Exemplaire attribué puis confirmation bibliothécaire)', () => {
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

  // Retourner l'emprunt de Amine (ln-bilale-1) en état réutilisable -> attribué à Salma (#1) sans démarrer encore les 3 jours
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
  assert.equal(target?.status, 'Exemplaire attribué');
  assert.equal(target?.pickupDeadline, null);
  assert.ok(target?.assignedCopyId);

  // Vérifier que les positions restantes ont avancé (#1 pour Amina, #2 pour Omar)
  const aminaRes = service.getMemberReservations('usr-amina', tReturn);
  assert.equal(aminaRes.find((r) => r.id === rAmina.id)?.queuePosition, 1);
  const omarRes = service.getMemberReservations('usr-omar', tReturn);
  assert.equal(omarRes.find((r) => r.id === rOmar.id)?.queuePosition, 2);

  // Le bibliothécaire confirme la mise à disposition -> statut 'Disponible pour retrait' et délai de 3 jours démarré
  const tConfirm = new Date(baseTime.getTime() + 240_000);
  const confirmed = service.confirmReservationAvailability(
    'res-salma-sys',
    { id: 'usr-lib', fullName: 'Nadia Benali', role: 'bibliothecaire' },
    tConfirm
  );
  assert.equal(confirmed.status, 'Disponible pour retrait');
  assert.equal(confirmed.pickupDeadline, addDays(tConfirm, 3).toISOString());
});

test('8. L’annulation d’une réservation met à jour la file d’attente et libère un exemplaire déjà attribué', () => {
  const { db, service, baseTime } = setupTestEnv();
  db.prepare(
    `INSERT INTO users (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, cne, filiere, authSource, createdAt)
     VALUES ('usr-amina', 'Amina Test', 'amina.test@usmba.example', 'hash', 'membre', 'EST Fès', 'verifie', 'actif', 'DEMO-T01', 'Génie Informatique', 'local', ?),
            ('usr-omar', 'Omar Test', 'omar.test@usmba.example', 'hash', 'membre', 'EST Fès', 'verifie', 'actif', 'DEMO-T02', 'Génie Informatique', 'local', ?)`
  ).run(baseTime.toISOString(), baseTime.toISOString());

  const rAmina = service.reserveBook('usr-amina', 'bk-sys-dist', new Date(baseTime.getTime() + 60_000));
  const rOmar = service.reserveBook('usr-omar', 'bk-sys-dist', new Date(baseTime.getTime() + 120_000));

  // Retourner ln-bilale-1 -> attribué à Salma
  service.returnLoan('ln-bilale-1', 'reutilisable', 'Bon état', '', new Date(baseTime.getTime() + 180_000));

  // Salma annule sa réservation 'Exemplaire attribué' -> l'exemplaire doit passer à Amina !
  service.cancelReservation(
    'res-salma-sys',
    { id: 'usr-salma', role: 'membre' },
    new Date(baseTime.getTime() + 240_000)
  );

  const aminaRes = service
    .getMemberReservations('usr-amina', new Date(baseTime.getTime() + 240_000))
    .find((r) => r.id === rAmina.id);
  assert.equal(aminaRes?.status, 'Exemplaire attribué');

  const omarRes = service
    .getMemberReservations('usr-omar', new Date(baseTime.getTime() + 240_000))
    .find((r) => r.id === rOmar.id);
  assert.equal(omarRes?.queuePosition, 1);
});

test('9 & 10. Le délai de retrait de 3 jours démarre à la confirmation et son expiration transfère l’exemplaire au suivant', () => {
  const { db, service, baseTime } = setupTestEnv();
  db.prepare(
    `INSERT INTO users (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, cne, filiere, authSource, createdAt)
     VALUES ('usr-amina', 'Amina Test', 'amina.test@usmba.example', 'hash', 'membre', 'EST Fès', 'verifie', 'actif', 'DEMO-T01', 'Génie Informatique', 'local', ?)`
  ).run(baseTime.toISOString());

  const rAmina = service.reserveBook('usr-amina', 'bk-sys-dist', new Date(baseTime.getTime() + 60_000));

  const tReturn = new Date(baseTime.getTime() + 120_000);
  service.returnLoan('ln-bilale-1', 'reutilisable', 'Bon état', '', tReturn);

  // Avant confirmation : aucun délai de retrait n'a démarré
  const beforeConfirm = service
    .getMemberReservations('usr-salma', tReturn)
    .find((r) => r.id === 'res-salma-sys');
  assert.equal(beforeConfirm?.status, 'Exemplaire attribué');
  assert.equal(beforeConfirm?.pickupDeadline, null);

  // Confirmation bibliothécaire à tConfirm -> 3 jours démarrent
  const tConfirm = new Date(baseTime.getTime() + 180_000);
  service.confirmReservationAvailability(
    'res-salma-sys',
    { id: 'usr-lib', fullName: 'Nadia Benali', role: 'bibliothecaire' },
    tConfirm
  );

  const salmaRes = service
    .getMemberReservations('usr-salma', tConfirm)
    .find((r) => r.id === 'res-salma-sys');
  assert.equal(salmaRes?.status, 'Disponible pour retrait');
  assert.equal(salmaRes?.pickupDeadline, addDays(tConfirm, 3).toISOString());

  // Avancer le temps de 3 jours + 1 heure -> expiration automatique et attribution à Amina
  const tExpired = new Date(tConfirm.getTime() + (3 * 24 + 1) * 60 * 60 * 1000);
  const expiredCount = service.processDeadlines(tExpired);
  assert.ok(expiredCount >= 1);

  const salmaAfter = service
    .getMemberReservations('usr-salma', tExpired)
    .find((r) => r.id === 'res-salma-sys');
  assert.equal(salmaAfter?.status, 'Expirée');

  const aminaAfter = service
    .getMemberReservations('usr-amina', tExpired)
    .find((r) => r.id === rAmina.id);
  assert.equal(aminaAfter?.status, 'Exemplaire attribué');
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

test('16. Inscription autonome désactivée (403) et Google OAuth non simulé si non configuré (501)', async () => {
  const { db, baseTime } = setupTestEnv();
  const { app } = createApp(db, () => baseTime);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. L'inscription autonome est strictement refusée
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Test Self Reg',
        email: 'self@usmba.ac.ma',
        password: 'Password123!',
      }),
    });
    assert.equal(regRes.status, 403);
    const regJson = (await regRes.json()) as { code: string };
    assert.equal(regJson.code, 'SELF_REGISTRATION_DISABLED');

    // 2. Sans GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, /api/auth/google/url renvoie 501 sans simuler
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      const urlRes = await fetch(`${baseUrl}/api/auth/google/url`);
      assert.equal(urlRes.status, 501);
      const urlJson = (await urlRes.json()) as { code: string };
      assert.equal(urlJson.code, 'GOOGLE_OAUTH_NOT_CONFIGURED');
    }

    // 3. Un compte google_oidc ne peut jamais se connecter via /api/auth/login
    db.prepare(
      `INSERT INTO users (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, cne, filiere, authSource, isDemo, createdAt)
       VALUES ('usr-g1', 'Compte Google', 'etudiant.google@usmba.ac.ma', 'google_oidc:locked', 'membre', 'EST Fès', 'verifie', 'actif', NULL, NULL, 'google_oidc', 0, ?)`
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

test('17. GoogleAuthAdapter : un domaine Google seul ne prouve pas l’appartenance à l’EST Fès et le rôle bibliothécaire dépend de la configuration serveur', async () => {
  const { db, baseTime } = setupTestEnv();
  const adapter = new GoogleAuthAdapter({
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    APP_URL: 'https://biblio.est.example',
    GOOGLE_ALLOWED_HOSTED_DOMAIN: 'usmba.ac.ma',
    LIBRARIAN_EMAILS: 'chef.biblio@usmba.ac.ma',
    EST_ELIGIBILITY_EMAILS: 'verifie.est@usmba.ac.ma',
  });

  // 1. Compte @usmba.ac.ma inconnu de la source d'éligibilité -> créé en statut 'en_attente' (bloqué)
  const unverified = await adapter.resolveProvisionedUser(
    db,
    {
      sub: 'sub-1',
      email: 'autre.faculte@usmba.ac.ma',
      email_verified: true,
      name: 'Étudiant Autre Faculté',
      hd: 'usmba.ac.ma',
    },
    baseTime
  );
  assert.equal(unverified.user.role, 'membre');
  assert.equal(unverified.user.studentStatus, 'en_attente');
  assert.equal(unverified.requiresLibrarianValidation, true);

  // 2. Compte présent dans la source d'éligibilité -> statut 'verifie'
  const verified = await adapter.resolveProvisionedUser(
    db,
    {
      sub: 'sub-2',
      email: 'verifie.est@usmba.ac.ma',
      email_verified: true,
      name: 'Étudiant EST Vérifié',
      hd: 'usmba.ac.ma',
    },
    baseTime
  );
  assert.equal(verified.user.role, 'membre');
  assert.equal(verified.user.studentStatus, 'verifie');
  assert.equal(verified.requiresLibrarianValidation, false);

  // 3. Compte bibliothécaire configuré côté serveur -> rôle 'bibliothecaire'
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
  db.close();
});

test('18 & 19. Panier de demandes : limite 1 exemplaire par titre, aucune pré-réservation, vérification serveur à la confirmation et blocage en cas de retard', () => {
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

  // 2. Confirmation du panier -> emprunt pour bk-algo, réservation FIFO pour bk-sys-dist, refus pour obsolete
  const res = service.confirmCart('usr-amina', baseTime);
  assert.equal(res.results.length, 3);
  assert.equal(res.results.find((r) => r.bookId === 'bk-algo')?.outcome, 'emprunt_enregistre');
  assert.equal(res.results.find((r) => r.bookId === 'bk-sys-dist')?.outcome, 'reservation_enregistree');
  assert.equal(res.results.find((r) => r.bookId === obsolete.id)?.outcome, 'refuse');
  // Seul l'article refusé reste dans le panier
  assert.equal(res.remainingCartCount, 1);

  // 3. Un membre en retard (usr-youssef) voit tout son panier refusé sans faux succès
  service.addToCart('usr-youssef', 'bk-algo', 1, baseTime);
  const resYoussef = service.confirmCart('usr-youssef', baseTime);
  assert.equal(resYoussef.results[0]?.outcome, 'refuse');
  assert.equal(resYoussef.results[0]?.code, 'OVERDUE_RETURN');
  assert.equal(resYoussef.remainingCartCount, 1);

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
