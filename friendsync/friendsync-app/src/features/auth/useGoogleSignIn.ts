import { Platform } from "react-native";
import {
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  signOut,
} from "firebase/auth";

import { GoogleSignin } from "@react-native-google-signin/google-signin";

import { doc, setDoc } from "firebase/firestore";

// ✅ FIX: Use the correct RN Firebase native imports
import { auth as firebaseAuth, db as firebaseDb } from "../../lib/firebase.native";

import db from "../../lib/db";
import * as simpleSync from "../../lib/sync";
import AsyncStorage from "@react-native-async-storage/async-storage";
import storage from "../../lib/storage";
import { emit } from "../../lib/eventBus";
import Constants from "expo-constants";

import * as WebBrowser from "expo-web-browser";
WebBrowser.maybeCompleteAuthSession();

export function useGoogleSignIn() {
  const WEB_CLIENT_ID =
    Constants.expoConfig?.extra?.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
    Constants.manifest?.extra?.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

  let signingIn = false;

  const signIn = async () => {
    if (signingIn) return;
    signingIn = true;

    console.log("[Auth] signIn pressed. Platform:", Platform.OS);

    // ----------------------------------------------------
    // 🌐 WEB LOGIN
    // ----------------------------------------------------
    if (Platform.OS === "web") {
      try {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });

        await signInWithPopup(firebaseAuth, provider);

        const u = firebaseAuth.currentUser;
        if (u) await handleUserAfterSignIn(u);

        return u;
      } finally {
        signingIn = false;
      }
    }

    // ----------------------------------------------------
    // 🤖 ANDROID NATIVE LOGIN
    // ----------------------------------------------------
    if (Platform.OS === "android") {
      try {
        console.log("[Auth] Using Native Google Sign-In on Android");

        GoogleSignin.configure({
          webClientId: WEB_CLIENT_ID,
          offlineAccess: true,
          forceCodeForRefreshToken: false,
        });

        await GoogleSignin.hasPlayServices({
          showPlayServicesUpdateDialog: true,
        });

        // 🚀 Force account chooser every time
        try {
          await GoogleSignin.signOut();
          await GoogleSignin.revokeAccess();
        } catch {}

        const result = await GoogleSignin.signIn();
        console.log("[Auth] Google Sign-In raw result:", result);

        const idToken = result.data?.idToken ?? result.idToken;
        if (!idToken) throw new Error("Google Sign-In returned no idToken");

        // 🔥 FIX: Use firebaseAuth, NOT firebase.auth
        const cred = GoogleAuthProvider.credential(idToken);
        await signInWithCredential(firebaseAuth, cred);

        const u = firebaseAuth.currentUser;
        if (u) await handleUserAfterSignIn(u);

        return u;
      } catch (err) {
        console.error("[Auth] Native Google sign-in failed:", err);
        throw err;
      } finally {
        signingIn = false;
      }
    }

    signingIn = false;
    throw new Error("Unsupported platform");
  };

  // ----------------------------------------------------
  // LOGOUT
  // ----------------------------------------------------
  const logout = async () => {
    console.log("[Auth] Logging out...");

    simpleSync.stopAutoSync();
    await signOut(firebaseAuth);

    await AsyncStorage.multiRemove(["authToken", "userId", "userEmail", "userName"]);
    await storage.removeItem("authToken");
    await storage.removeItem("userId");
    await storage.removeItem("userEmail");
    await storage.removeItem("userName");

    try {
      await GoogleSignin.signOut();
    } catch {}

    console.log("[Auth] Logged out");
  };

  // ----------------------------------------------------
  // FIREBASE + LOCAL SYNC
  // ----------------------------------------------------
  async function handleUserAfterSignIn(u: any) {
    const localId = await ensureLocalUserInDB(u).catch(() => null);

    await setDoc(
      doc(firebaseDb, "users", u.uid),
      {
        uid: u.uid,
        userId: localId ?? null,
        email: u.email,
        displayName: u.displayName,
        photoURL: u.photoURL,
        lastLogin: new Date(),
      },
      { merge: true }
    );

    await initialSync();
  }

  async function initialSync() {
    const user = firebaseAuth.currentUser;
    if (!user) return;

    await db.init_db();

    const token = await user.getIdToken();

    await AsyncStorage.setItem("authToken", token);
    await storage.setItem("authToken", token);

    simpleSync.setAuthToken(token);

    const localId =
      (await storage.getItem("userId")) ??
      (await AsyncStorage.getItem("userId"));

    simpleSync.startAutoSync(localId ?? user.uid);
  }

  async function ensureLocalUserInDB(u: any): Promise<number | null> {
    await db.init_db();

    let local =
      (await db.getUserByFirebaseUid(u.uid).catch(() => null)) ||
      (u.email ? await db.getUserByEmail(u.email).catch(() => null) : null);

    let localId;

    if (!local) {
      localId = await db.createUser({
        username: u.displayName || u.email?.split("@")[0] || `u${Date.now()}`,
        email: u.email,
        firebase_uid: u.uid,
      });
    } else {
      localId = Number(local.userId);

      if (!local.username) {
        const username = u.displayName || u.email?.split("@")[0];
        await db.updateUser(localId, { username });
        emit("user:updated", { userId: localId, username });
      }
    }

    await AsyncStorage.setItem("userId", String(localId));
    await storage.setItem("userId", String(localId));

    return localId;
  }

  return { signIn, logout };
}
