import React from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import firebase from "../../lib/firebase";
import { Platform } from 'react-native';

type Ctx = { user: User | null; ready: boolean };
const AuthContext = React.createContext<Ctx>({ user: null, ready: false });
export const useAuth = () => React.useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    let cleanup: (() => void) | null = null;

    const setup = async () => {
      try {
        let fb: any = firebase;
        if (!fb || !fb.auth) {
          try {
            const mod = await import('../../lib/firebase');
            fb = (mod as any).default || mod;
          } catch (_) {
            // fallback to platform-specific module
            try {
              if (Platform.OS === 'web') {
                const mod = await import('../../lib/firebase.web');
                fb = { auth: (mod as any).auth };
              } else {
                const mod = await import('../../lib/firebase.native');
                fb = { auth: (mod as any).auth };
              }
            } catch (e) {
              // give up — will mark ready below
            }
          }
        }

        if (!mounted) return;

        if (fb && fb.auth) {
          cleanup = onAuthStateChanged(fb.auth, (u: User | null) => {
            if (!mounted) return;
            setUser(u);
            setReady(true);
          });
        } else {
          // No auth available — mark ready so UI can continue
          setUser(null);
          setReady(true);
        }
      } catch (err) {
        if (mounted) {
          setUser(null);
          setReady(true);
        }
      }
    };

    setup();
    return () => {
      mounted = false;
      try { if (cleanup) cleanup(); } catch (e) { /* ignore */ }
    };
  }, []);

  return <AuthContext.Provider value={{ user, ready }}>{children}</AuthContext.Provider>;
}
