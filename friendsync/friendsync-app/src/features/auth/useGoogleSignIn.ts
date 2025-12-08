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

    if (Platform.OS === "web") {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(firebase.auth, provider);

      const u = firebase.auth.currentUser;
      if (u) {
          try {
            await setDoc(
              doc(firebase.db, "users", u.uid),
              {
                uid: u.uid,
                email: u.email,
                displayName: u.displayName,
                photoURL: u.photoURL,
                lastLogin: new Date(),
              },
              { merge: true }
            );
        } catch (err: any) {
          // If Firestore rules prevent writes, log details but don't fail sign-in.
          // Common cause: Firestore security rules require request.auth.uid == userId
          // or admin-only writes. Inspect console logs and Firestore rules in Firebase Console.
          // eslint-disable-next-line no-console
          console.warn('[Auth] setDoc(users/<uid>) failed', err?.code ?? err?.message ?? err);
        }
      }

      // Ensure a numeric local DB user exists for this Firebase user
      if (u) {
        try {
          await ensureLocalUserInDB(u);
        } catch (err) {
          // non-fatal
          // eslint-disable-next-line no-console
          console.warn('[Auth] ensureLocalUserInDB failed (web)', err);
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
        const cred = GoogleAuthProvider.credential(idToken);
        await signInWithCredential(firebase.auth, cred);

        const u = firebase.auth.currentUser;
        if (u) {
          try {
            await setDoc(
              doc(firebase.db, "users", u.uid),
              {
                uid: u.uid,
                email: u.email,
                displayName: u.displayName,
                photoURL: u.photoURL,
                lastLogin: new Date(),
              },
              { merge: true }
            );
          } catch (err: any) {
            // eslint-disable-next-line no-console
            console.warn('[Auth] setDoc(users/<uid>) failed (native)', err?.code ?? err?.message ?? err);
          }
        }

        // Ensure a numeric local DB user exists for this Firebase user (native flow)
        if (u) {
          try {
            await ensureLocalUserInDB(u);
          } catch (err) {
            // non-fatal
            // eslint-disable-next-line no-console
            console.warn('[Auth] ensureLocalUserInDB failed (native)', err);
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
    
    await signOut(firebase.auth);
    
    await AsyncStorage.multiRemove(['authToken', 'userId', 'userEmail', 'userName']);
    
    console.log("[Auth] Logged out and sync stopped");

  };

  async function initialSync() {
    try {
      const user = firebase.auth.currentUser;
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

      // 3. Save auth data to storage
      await AsyncStorage.setItem('authToken', token);
      await AsyncStorage.setItem('userEmail', user.email || '');

      // Ensure a local DB user exists for this signed-in user and store the local numeric id.
      // Mapping/creation is handled by `ensureLocalUserInDB` which is called during sign-in.
      // Here we only invoke it as a fallback when no `userId` is already present in storage.
      try {
        const existingId = await AsyncStorage.getItem('userId');
        if (!existingId) {
          await ensureLocalUserInDB(user);
        }
      } catch (e) {
        console.warn('[Auth] failed to verify/create local user for signed-in account', e);
      }

      // 4. Set up sync -- disabled temporarily
      simpleSync.setAuthToken(token);

      // Start auto-sync using the local numeric user id saved by `ensureLocalUserInDB`.
      // Pass numeric id if available otherwise resolve later in startAutoSync.
      const storedLocal = await AsyncStorage.getItem('userId');
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
      if (u.email) local = await db.getUserByEmail(u.email);
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
          // No longer storing provider-specific UID locally — rely on numeric local userId.
        } catch (e) {
          // ignore update errors
        }
      } else {
        const uname = u.displayName ? String(u.displayName).replace(/\s+/g, '_').toLowerCase() : (u.email ? String(u.email).split('@')[0] : `u${Date.now()}`);
        localId = await db.createUser({ username: uname, email: u.email || '' });
      }
      if (localId != null) {
        await AsyncStorage.setItem('userId', String(localId));
        await AsyncStorage.setItem('userEmail', u.email || '' );
        // store a human-friendly name for UI
        try {
          const lu = await db.getUserById(localId);
          if (lu && lu.username) await AsyncStorage.setItem('userName', String(lu.username));
        } catch (e) {
          // ignore
        }
        // do not persist provider-specific UID locally
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
