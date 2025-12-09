// src/features/auth/useGithubSignIn.ts
import * as WebBrowser from "expo-web-browser";
import * as AuthSession from "expo-auth-session";
import Constants from "expo-constants";

WebBrowser.maybeCompleteAuthSession();

export function useGithubSignIn() {
  const clientId = Constants.expoConfig?.extra?.EXPO_PUBLIC_GITHUB_CLIENT_ID;
  const redirectUri = AuthSession.makeRedirectUri({
    scheme: "com.friendsync.app",
    path: "redirect",
  });

  async function signIn() {
    console.log("[GitHub] Button pressed");

    const authUrl =
      `https://github.com/login/oauth/authorize` +
      `?client_id=${clientId}` +
      `&scope=read:user%20user:email` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}`;

    console.log("[GitHub] Auth URL:", authUrl);
    console.log("[GitHub] Redirect URI:", redirectUri);

    try {
      const res = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

      console.log("[GitHub] Browser result:", res);

      if (res.type !== "success") {
        throw new Error("GitHub login canceled.");
      }

      // GitHub returns ?code=XYZ inside the URL
      const code = res.url.split("code=")[1];
      if (!code) throw new Error("No GitHub code received.");

      console.log("[GitHub] Received code:", code);

      // TEMPORARY: Just return the code so login works front-end
      return { code };
    } catch (err) {
      console.error("[Auth] GitHub sign-in error:", err);
      throw err;
    }
  }

  return { signIn };
}
