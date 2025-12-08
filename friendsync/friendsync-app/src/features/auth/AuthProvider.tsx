import React from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import firebase from "../../lib/firebase";

type Ctx = { user: User | null; ready: boolean };
const AuthContext = React.createContext<Ctx>({ user: null, ready: false });
export const useAuth = () => React.useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    const unsub = onAuthStateChanged(firebase.auth, (u) => { setUser(u); setReady(true); });
    return unsub;
  }, []);

  return <AuthContext.Provider value={{ user, ready }}>{children}</AuthContext.Provider>;
}
