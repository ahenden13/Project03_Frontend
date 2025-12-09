// src/screens/AuthScreen.tsx

import React, { useState } from "react";
import {
  View,
  Pressable,
  Text,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";

import { useGoogleSignIn } from "../features/auth/useGoogleSignIn";
import { useGithubSignIn } from "../features/auth/useGithubSignIn";

export default function AuthScreen() {
  const { signIn: googleSignIn } = useGoogleSignIn();
  const { signIn: githubSignIn } = useGithubSignIn();

  const [googleLoading, setGoogleLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);

  const handleGooglePress = async () => {
    if (googleLoading || githubLoading) return;

    setGoogleLoading(true);
    console.log("[Auth] Google button pressed");

    try {
      const user = await googleSignIn();
      console.log("[Auth] Google signed in:", user?.uid);

      if (user?.email) {
        Alert.alert("Signed in with Google", user.email);
      }
    } catch (e: any) {
      console.error("[Auth] Google sign-in error:", e);
      Alert.alert(
        "Google Sign-In Failed",
        e?.message ?? "Something went wrong. Please try again."
      );
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleGithubPress = async () => {
    if (googleLoading || githubLoading) return;

    setGithubLoading(true);
    console.log("[Auth] GitHub button pressed");

    try {
      const result = await githubSignIn(); // currently returns { code }
      console.log("[Auth] GitHub OAuth result:", result);

      if (result?.code) {
        // For now we just confirm front-end success;
        // backend token exchange will happen later.
        Alert.alert(
          "GitHub OAuth Code Received",
          `${result.code.substring(0, 8)}…`
        );
      }
    } catch (e: any) {
      console.error("[Auth] GitHub sign-in error:", e);
      Alert.alert(
        "GitHub Sign-In Failed",
        e?.message ?? "Something went wrong. Please try again."
      );
    } finally {
      setGithubLoading(false);
    }
  };

  const anyLoading = googleLoading || githubLoading;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#0B0F14",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      {/* Title */}
      <Text
        style={{
          color: "#FFFFFF",
          fontSize: 24,
          marginBottom: 32,
          fontWeight: "600",
        }}
      >
        Sign In to FriendSync
      </Text>

      {/* Google Button */}
      <Pressable
        onPress={handleGooglePress}
        disabled={anyLoading}
        style={{
          opacity: anyLoading ? 0.7 : 1,
          backgroundColor: "#DB4437",
          paddingVertical: 14,
          paddingHorizontal: 20,
          borderRadius: 12,
          minWidth: 260,
          marginBottom: 16,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {googleLoading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text
            style={{
              textAlign: "center",
              color: "#FFFFFF",
              fontWeight: "600",
            }}
          >
            Continue with Google
          </Text>
        )}
      </Pressable>

      {/* GitHub Button */}
      <Pressable
        onPress={handleGithubPress}
        disabled={anyLoading}
        style={{
          opacity: anyLoading ? 0.7 : 1,
          backgroundColor: "#111827",
          paddingVertical: 14,
          paddingHorizontal: 20,
          borderRadius: 12,
          minWidth: 260,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {githubLoading ? (
          <ActivityIndicator color="#E5E7EB" />
        ) : (
          <Text
            style={{
              textAlign: "center",
              color: "#E5E7EB",
              fontWeight: "600",
            }}
          >
            Continue with GitHub
          </Text>
        )}
      </Pressable>

      <Text
        style={{
          color: "#9CA3AF",
          marginTop: 16,
          fontSize: 12,
          textAlign: "center",
          paddingHorizontal: 24,
        }}
      >
        If nothing happens, enable pop-ups and third-party cookies in your
        browser.
        {Platform.OS === "web"
          ? " You’ll be redirected back here after you sign in."
          : ""}
      </Text>
    </View>
  );
}
