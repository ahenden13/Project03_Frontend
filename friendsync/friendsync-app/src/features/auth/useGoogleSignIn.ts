import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as AuthSession from "expo-auth-session";
import {
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  signOut,
} from "firebase/auth";
// import { auth, db } from "../../lib/firebase"; // importing db
import { doc, setDoc } from "firebase/firestore"; // firestone imports
import firebase from "../../lib/firebase";
import db from "../../lib/db";
import * as simpleSync from "../../lib/sync";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { emit } from '../../lib/eventBus';
import storage from '../../lib/storage';

WebBrowser.maybeCompleteAuthSession();

const discovery = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
};

export function useGoogleSignIn() {
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID!;
  // const redirectUri = AuthSession.makeRedirectUri({ useProxy: true });
  const redirectUri = AuthSession.makeRedirectUri();

  const signIn = async () => {
    console.log("[Auth] signIn pressed. Platform:", Platform.OS);

    // Resolve firebase module robustly — dynamic import fallback in case the
    // unified `src/lib/firebase` default export isn't initialized yet at runtime.
    const resolveFirebase = async () => {
      if (firebase && (firebase as any).auth && (firebase as any).db) return firebase as any;
      try {
        if (Platform.OS === 'web') {
          const mod = await import('../../lib/firebase.web');
          return { auth: (mod as any).auth, db: (mod as any).db } as any;
        } else {
          const mod = await import('../../lib/firebase.native');
          return { auth: (mod as any).auth, db: (mod as any).db } as any;
        }
      } catch (e) {
        console.warn('[Auth] resolveFirebase dynamic import failed', e);
        return firebase as any;
      }
    };

    const fb = await resolveFirebase();
    if (Platform.OS === "web") {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(fb.auth, provider);

      const u = fb.auth.currentUser;
      if (u) {
        try {
          // Ensure a numeric local DB user exists for this Firebase user first
          const localId = await ensureLocalUserInDB(u).catch((e) => {
            console.warn('[Auth] ensureLocalUserInDB failed (web)', e); return null;
          });

          // Read local username if available
          let localName: string | undefined = undefined;
          if (localId) {
            try {
              const lu = await db.getUserById(localId);
              if (lu && lu.username) localName = lu.username;
            } catch (_) { /* ignore */ }
          }

          await setDoc(
            doc(fb.db, "users", u.uid),
            {
              uid: u.uid,
              userId: localId ?? null,
              username: localName ?? (u.displayName ? String(u.displayName).replace(/\s+/g, '_').toLowerCase() : undefined),
              email: u.email,
              displayName: u.displayName,
              photoURL: u.photoURL,
              lastLogin: new Date(),
            },
            { merge: true }
          );
        } catch (err: any) {
          console.warn('[Auth] setDoc(users/<uid>) failed', err?.code ?? err?.message ?? err);
        }
      }

      await initialSync();

      return u;
    }

    // Native: use AuthSession -> id_token -> Firebase credential
    if (!clientId) throw new Error("Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID");

    const authUrl =
      `${discovery.authorizationEndpoint}` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=id_token` +
      `&scope=${encodeURIComponent("openid profile email")}` +
      `&nonce=${encodeURIComponent(String(Math.random()))}`;

    //Bryan - changed to async
    const res = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);
    // const res = await AuthSession.startAsync({ authUrl, returnUrl: redirectUri });
    console.log("[Auth] AuthSession result:", res);

    if (res.type === "success" && res.url) {
      // Parse the URL to get id_token
      const url = new URL(res.url);
      const hash = url.hash.substring(1); // Remove the '#'
      const params = new URLSearchParams(hash);
      const idToken = params.get('id_token');

      if (idToken) {
        const fb = await (async () => {
          if (firebase && (firebase as any).auth && (firebase as any).db) return firebase as any;
          try { const mod = await import('../../lib/firebase.native'); return { auth: (mod as any).auth, db: (mod as any).db } as any; } catch (e) { return firebase as any; }
        })();

        const cred = GoogleAuthProvider.credential(idToken);
        await signInWithCredential(fb.auth, cred);

        const u = fb.auth.currentUser;
        if (u) {
          try {
            // Ensure numeric local user exists and capture id/name
            const localId = await ensureLocalUserInDB(u).catch((e) => { console.warn('[Auth] ensureLocalUserInDB failed (native)', e); return null; });
            let localName: string | undefined = undefined;
            if (localId) {
              try { const lu = await db.getUserById(localId); if (lu && lu.username) localName = lu.username; } catch (_) { /* ignore */ }
            }

            await setDoc(
              doc(fb.db, "users", u.uid),
              {
                uid: u.uid,
                userId: localId ?? null,
                username: localName ?? (u.displayName ? String(u.displayName).replace(/\s+/g, '_').toLowerCase() : undefined),
                email: u.email,
                displayName: u.displayName,
                photoURL: u.photoURL,
                lastLogin: new Date(),
              },
              { merge: true }
            );
          } catch (err: any) {
            console.warn('[Auth] setDoc(users/<uid>) failed (native)', err?.code ?? err?.message ?? err);
          }
        }

        await initialSync();
        return u;
      }
    }

    throw new Error(
      res.type === "dismiss"
        ? "Sign-in dismissed"
        : "Google sign-in canceled or failed"
    );
  };

  const logout = async () => {
    console.log("[Auth] Logging out...");
    
    simpleSync.stopAutoSync();
    // Resolve firebase instance (dynamic fallback)
    const fb = (firebase && (firebase as any).auth && (firebase as any).db) ? firebase as any : await (async () => { try { const m = await import('../../lib/firebase'); return (m as any).default || m; } catch (e) { console.warn('[Auth] dynamic import firebase failed', e); return firebase as any; } })();
    if (fb && fb.auth) await signOut(fb.auth);
    
    try { await AsyncStorage.multiRemove(['authToken', 'userId', 'userEmail', 'userName']); } catch (_) { }
    try { await storage.removeItem('authToken'); } catch (_) { }
    try { await storage.removeItem('userId'); } catch (_) { }
    try { await storage.removeItem('userEmail'); } catch (_) { }
    try { await storage.removeItem('userName'); } catch (_) { }
    
    console.log("[Auth] Logged out and sync stopped");

  };

  async function initialSync() {
    try {
      const fb = (firebase && (firebase as any).auth && (firebase as any).db) ? firebase as any : await (async () => { try { const m = await import('../../lib/firebase'); return (m as any).default || m; } catch (e) { console.warn('[Auth] dynamic import firebase failed', e); return firebase as any; } })();
      const user = fb && fb.auth ? fb.auth.currentUser : null;
      if (!user) {
        console.warn("[Auth] No current user, skipping sync initialization");
        return;
      }

      console.log("[Auth] Initializing sync for user:", user.uid);

      // 1. Initialize local database
      await db.init_db();
      console.log("[Auth] Local database initialized");

      // 2. Get Firebase ID token
      const token = await user.getIdToken();

      // 3. Save auth data to storage (both backends)
      try { await AsyncStorage.setItem('authToken', token); } catch (_) { }
      try { await storage.setItem('authToken', token); } catch (_) { }
      try { await AsyncStorage.setItem('userEmail', user.email || ''); } catch (_) { }
      try { await storage.setItem('userEmail', user.email || ''); } catch (_) { }

      // Ensure a local DB user exists for this signed-in user and store the local numeric id.
      // Mapping/creation is handled by `ensureLocalUserInDB` which is called during sign-in.
      // Here we only invoke it as a fallback when no `userId` is already present in storage.
      try {
        const existingId = await storage.getItem<string>('userId');
        const existingAlt = existingId ?? await AsyncStorage.getItem('userId');
        if (!existingAlt) {
          await ensureLocalUserInDB(user);
        }
      } catch (e) {
        console.warn('[Auth] failed to verify/create local user for signed-in account', e);
      }

      // 4. Set up sync
      simpleSync.setAuthToken(token);

      // Start auto-sync: prefer numeric id from the `storage` wrapper, fall back to AsyncStorage.
      const storedLocal = await storage.getItem<string>('userId') ?? await AsyncStorage.getItem('userId');
      const localId = storedLocal ? Number(storedLocal) : null;
      simpleSync.startAutoSync(localId ?? user.uid);

      console.log("[Auth] ✓ Sync started successfully");
    } catch (error) {
      console.error("[Auth] Failed to initialize sync:", error);
      // Don't throw - let the user continue even if sync fails
    }

  }

  // Ensure a numeric local DB user exists for the given Firebase user.
  // Returns the numeric local userId or null on failure.
  async function ensureLocalUserInDB(u: any): Promise<number | null> {
    try {
      await db.init_db();
      let local = null;
      // Prefer mapping by provider UID if available
      if (u && u.uid) {
        try { local = await db.getUserByFirebaseUid(u.uid); } catch (e) { /* ignore */ }
      }
      // Fallback to email-based lookup
      if (!local && u && u.email) local = await db.getUserByEmail(u.email);
      let localId: number | null = null;
      if (local && local.userId) {
        localId = Number(local.userId);
        // If the existing local row has no username, populate it from Firebase displayName or email localpart
        try {
          if (!local.username || String(local.username).trim().length === 0) {
            const uname = u.displayName ? String(u.displayName).replace(/\s+/g, '_').toLowerCase() : (u.email ? String(u.email).split('@')[0] : `u${Date.now()}`);
            await db.updateUser(localId, { username: uname });
            try { emit('user:updated', { userId: localId, username: uname }); } catch (_) { /* ignore */ }
          }

          // Persist provider UID if missing locally (non-destructive)
          try {
            if ((local as any).firebase_uid == null || String((local as any).firebase_uid).trim().length === 0) {
              if (u && u.uid) {
                await db.updateUser(localId, { firebase_uid: u.uid } as any);
              }
            }
          } catch (e) { /* ignore */ }
        } catch (e) {
          // ignore update errors
        }
      } else {
        const uname = u.displayName ? String(u.displayName).replace(/\s+/g, '_').toLowerCase() : (u.email ? String(u.email).split('@')[0] : `u${Date.now()}`);
        localId = await db.createUser({ username: uname, email: u.email || '', firebase_uid: u?.uid ?? null });
      }
      if (localId != null) {
        // Persist to both AsyncStorage and the storage wrapper so all codepaths
        // that read either backend will find the saved values.
        try { await AsyncStorage.setItem('userId', String(localId)); } catch (_) { }
        try { await storage.setItem('userId', String(localId)); } catch (_) { }
        try { await AsyncStorage.setItem('userEmail', u.email || '' ); } catch (_) { }
        try { await storage.setItem('userEmail', u.email || '' ); } catch (_) { }
        // store a human-friendly name for UI
        try {
          const lu = await db.getUserById(localId);
          if (lu && lu.username) {
            try { await AsyncStorage.setItem('userName', String(lu.username)); } catch (_) { }
            try { await storage.setItem('userName', String(lu.username)); } catch (_) { }
          }
        } catch (e) {
          // ignore
        }
        // provider-specific UID is stored on the DB row (firebase_uid) but we
        // don't need to duplicate it into app-level storage.
      }
      return localId;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[Auth] ensureLocalUserInDB failed', err);
      return null;
    }
  }


  return { signIn, logout };
}
