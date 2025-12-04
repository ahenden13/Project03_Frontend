// src/lib/firebase.web.ts
// for Web
import { initializeApp, getApps } from "firebase/app";
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore"; // added this

const firebaseConfig = {
  apiKey: "AIzaSyD0cxLYBoYsQdlWJaPfkXbXLMsTxjph7yE",
  authDomain: "cst438project03.firebaseapp.com",
  projectId: "cst438project03", // added this
  storageBucket: "cst438project03.firebasestorage.app",
  messagingSenderId: "1013334906995",
  appId: "1:1013334906995:web:196748b3aed3ec23077206",
};

// const app = initializeApp(firebaseConfig);
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = (() => {
  const a = getAuth(app);
  setPersistence(a, browserLocalPersistence).catch(console.error);
  return a;
})();

// ✅ export Firestore instance
export const db = getFirestore(app);
