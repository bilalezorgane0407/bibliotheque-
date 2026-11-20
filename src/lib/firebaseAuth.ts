import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.send',
];

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

// Jeton conservé uniquement en mémoire (jamais dans localStorage / sessionStorage)
let cachedAccessToken: string | null = null;

onAuthStateChanged(auth, (user) => {
  if (!user) {
    cachedAccessToken = null;
  }
});

export function getCachedGoogleAccessToken(): string | null {
  return cachedAccessToken;
}

export async function ensureGoogleAccessToken(loginHint?: string): Promise<string> {
  if (cachedAccessToken) return cachedAccessToken;
  const result = await signInWithAcademicGoogle(loginHint);
  if (!result.accessToken) {
    throw new Error('Jeton d’autorisation Google non obtenu.');
  }
  return result.accessToken;
}

export async function signInWithAcademicGoogle(loginHint?: string): Promise<{
  idToken: string;
  accessToken: string | null;
  email: string | null;
}> {
  const provider = new GoogleAuthProvider();
  for (const scope of SCOPES) {
    provider.addScope(scope);
  }

  const customParams: Record<string, string> = {
    prompt: 'select_account',
  };
  const cleanHint = (loginHint || '').trim();
  if (cleanHint) {
    customParams.login_hint = cleanHint;
  }
  provider.setCustomParameters(customParams);

  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  cachedAccessToken = credential?.accessToken || null;
  const idToken = await result.user.getIdToken();

  return {
    idToken,
    accessToken: cachedAccessToken,
    email: result.user.email,
  };
}

export async function firebaseSignOut(): Promise<void> {
  cachedAccessToken = null;
  if (auth.currentUser) {
    await signOut(auth);
  }
}

