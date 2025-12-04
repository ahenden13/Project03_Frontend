// src/lib/firebase.native.ts 
// for React Native (iOS/Android)
import { initializeApp, getApps } from "firebase/app";
import { initializeAuth, getAuth } from "firebase/auth";
// import { getReactNativePersistence } from "firebase/auth/react-native";
import { getFirestore } from "firebase/firestore"; // added this 
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: "AIzaSyD0cxLYBoYsQdlWJaPfkXbXLMsTxjph7yE",
  authDomain: "cst438project03.firebaseapp.com",
  projectId: "cst438project03",
  storageBucket: "cst438project03.firebasestorage.app",
  messagingSenderId: "1013334906995",
  appId: "1:1013334906995:web:196748b3aed3ec23077206",
};

// const app = initializeApp(firebaseConfig);
//this will only initialize it if it isnt already initialized
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = (() => {
  try {
    return getAuth(app);
  } catch {
    return initializeAuth(app, {
      persistence: AsyncStorage as any,
    });
  }
})();

// ✅ export Firestore instance
export const db = getFirestore(app);
