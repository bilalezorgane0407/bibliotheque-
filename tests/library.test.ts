import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDatabase, seedDatabaseIfEmpty } from '../server/db/database.ts';
import { createApp } from '../server/app.ts';
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
     VALUES ('usr-amina', 'Amina Idrissi', 'amina.idrissi@usmba.ac.ma', 'hash', 'membre', 'EST Fès', 'verifie', 'actif', 'N130001122', 'Génie Informatique', 'local', ?)`
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

test('6 & 7. La file de réservation respecte strictement FIFO et un exemplaire retourné réutilisable va au plus ancien éligible', () => {
  const { db, service, baseTime } = setupTestEnv();
  db.prepare(
    `INSERT INTO users (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, cne, filiere, authSource, createdAt)
     VALUES ('usr-amina', 'Amina Idrissi', 'amina.idrissi@usmba.ac.ma', 'hash', 'membre', 'EST Fès', 'verifie', 'actif', 'N130001122', 'Génie Informatique', 'local', ?),
            ('usr-omar', 'Omar Berrada', 'omar.berrada@usmba.ac.ma', 'hash', 'membre', 'EST Fès', 'verifie', 'actif', 'N130001123', 'Génie Informatique', 'local', ?)`
  ).run(baseTime.toISOString(), baseTime.toISOString());

  // Salma est déjà #1 pour bk-sys-dist (seed). Amina réserve à T+1min (#2), Omar réserve à T+2min (#3)
  const rAmina = service.reserveBook('usr-amina', 'bk-sys-dist', new Date(baseTime.getTime() + 60_000));
  const rOmar = service.reserveBook('usr-omar', 'bk-sys-dist', new Date(baseTime.getTime() + 120_000));
  assert.equal(rAmina.queuePosition, 2);
  assert.equal(rOmar.queuePosition, 3);

  // Retourner l'emprunt de Bilale (ln-bilale-1) en état réutilisable -> doit être attribué à Salma (#1)
  const { assignedReservationId } = service.returnLoan(
    'ln-bilale-1',
    'reutilisable',
    'Bon état',
    'RAS',
    new Date(baseTime.getTime() + 180_000)
  );
  assert.equal(assignedReservationId, 'res-salma-sys');

  const salmaRes = service.getMemberReservations('usr-salma', new Date(baseTime.getTime() + 180_000));
  const target = salmaRes.find((r) => r.id === 'res-salma-sys');
  assert.equal(target?.status, 'Disponible pour retrait');
  assert.ok(target?.assignedCopyId);

  // Vérifier que les positions restantes ont avancé (#1 pour Amina, #2 pour Omar)
  const aminaRes = service.getMemberReservations('usr-amina', new Date(baseTime.getTime() + 180_000));
  assert.equal(aminaRes.find((r) => r.id === rAmina.id)?.queuePosition, 1);
  const omarRes = service.getMemberReservations('usr-omar', new Date(baseTime.getTime() + 180_000));
  assert.equal(omarRes.find((r) => r.id === rOmar.id)?.queuePosition, 2);
});

test('8. L’annulation d’une réservation met à jour la file d’attente et libère un exemplaire déjà attribué', () => {
  const { db, service, baseTime } = setupTestEnv();
  db.prepare(
    `INSERT INTO users (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, cne, filiere, authSource, createdAt)
     VALUES ('usr-amina', 'Amina Idrissi', 'amina.idrissi@usmba.ac.ma', 'hash', 'membre', 'EST Fès', 'verifie', 'actif', 'N130001122', 'Génie Informatique', 'local', ?),
            ('usr-omar', 'Omar Berrada', 'omar.berrada@usmba.ac.ma', 'hash', 'membre', 'EST Fès', 'verifie', 'actif', 'N130001123', 'Génie Informatique', 'local', ?)`
  ).run(baseTime.toISOString(), baseTime.toISOString());

  const rAmina = service.reserveBook('usr-amina', 'bk-sys-dist', new Date(baseTime.getTime() + 60_000));
  const rOmar = service.reserveBook('usr-omar', 'bk-sys-dist', new Date(baseTime.getTime() + 120_000));

  // Retourner ln-bilale-1 -> attribué à Salma
  service.returnLoan('ln-bilale-1', 'reutilisable', 'Bon état', '', new Date(baseTime.getTime() + 180_000));

  // Salma annule sa réservation 'Disponible pour retrait' -> l'exemplaire doit passer à Amina !
  service.cancelReservation(
    'res-salma-sys',
    { id: 'usr-salma', role: 'membre' },
    new Date(baseTime.getTime() + 240_000)
  );

  const aminaRes = service
    .getMemberReservations('usr-amina', new Date(baseTime.getTime() + 240_000))
    .find((r) => r.id === rAmina.id);
  assert.equal(aminaRes?.status, 'Disponible pour retrait');

  const omarRes = service
    .getMemberReservations('usr-omar', new Date(baseTime.getTime() + 240_000))
    .find((r) => r.id === rOmar.id);
  assert.equal(omarRes?.queuePosition, 1);
});

test('9 & 10. Un exemplaire réservé dispose d’un délai de retrait de 3 jours et son expiration le transfère au suivant', () => {
  const { db, service, baseTime } = setupTestEnv();
  db.prepare(
    `INSERT INTO users (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, cne, filiere, authSource, createdAt)
     VALUES ('usr-amina', 'Amina Idrissi', 'amina.idrissi@usmba.ac.ma', 'hash', 'membre', 'EST Fès', 'verifie', 'actif', 'N130001122', 'Génie Informatique', 'local', ?)`
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

    // 2. Connexion étudiant Salma -> récupère cookie
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'salma.bennani@usmba.ac.ma',
        password: 'EtudiantEST2026!',
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
        email: 'salma.bennani@usmba.ac.ma',
        password: 'MauvaisMotDePasse!',
      }),
    });
    assert.equal(badRes.status, 401);

    // 2. Connexion étudiant en contexte HTTPS top-level -> SameSite=Lax; Secure; HttpOnly (pas de SameSite=None aveugle)
    const topLevelHttpsLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({
        email: 'salma.bennani@usmba.ac.ma',
        password: 'EtudiantEST2026!',
      }),
    });
    assert.equal(topLevelHttpsLogin.status, 200);
    const topLevelSetCookie = topLevelHttpsLogin.headers.get('set-cookie') || '';
    assert.match(topLevelSetCookie, /HttpOnly/i);
    assert.match(topLevelSetCookie, /Secure/i);
    assert.match(topLevelSetCookie, /SameSite=Lax/i);
    assert.doesNotMatch(topLevelSetCookie, /SameSite=None/i);

    // 3. Connexion étudiant en contexte iframe cross-site HTTPS (Google AI Studio preview) -> SameSite=None; Secure; Partitioned
    const iframeLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
        'X-BiblioEST-Embed': 'cross-site-iframe',
      },
      body: JSON.stringify({
        email: 'salma.bennani@usmba.ac.ma',
        password: 'EtudiantEST2026!',
      }),
    });
    assert.equal(iframeLogin.status, 200);
    const iframeSetCookie = iframeLogin.headers.get('set-cookie') || '';
    assert.match(iframeSetCookie, /HttpOnly/i);
    assert.match(iframeSetCookie, /SameSite=None/i);
    assert.match(iframeSetCookie, /Secure/i);
    assert.match(iframeSetCookie, /Partitioned/i);

    const studentCookiePair = iframeSetCookie.split(';')[0];

    // 4. Persistance de session via /api/auth/me + en-têtes anti-cache + tolérance à un cookie voisin malformé
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
        email: 'bibliothecaire@est-usmba.ac.ma',
        password: 'BiblioAdmin2026!',
      }),
    });
    assert.equal(libLogin.status, 200);
    const libCookiePair = (libLogin.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(libCookiePair);

    const adminStats = await fetch(`${baseUrl}/api/admin/stats`, {
      headers: { Cookie: libCookiePair },
    });
    assert.equal(adminStats.status, 200);

    // 6. Déconnexion efface le cookie avec les attributs correspondants et invalide /api/auth/me
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

