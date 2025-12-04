// src/screens/AuthScreen.tsx
import React from "react";
import { View, Pressable, Text, Alert } from "react-native";
import { useGoogleSignIn } from "../features/auth/useGoogleSignIn";

export default function AuthScreen() {
  const { signIn } = useGoogleSignIn();

  const handlePress = async () => {
    console.log("[Auth] Button pressed");
    try {
      const user = await signIn();
      console.log("[Auth] Signed in:", user?.uid);
    } catch (e: any) {
      console.error("[Auth] Sign-in error:", e);
      Alert.alert("Sign-in failed", e?.message ?? "Allow pop-ups & cookies and try again.");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#0B0F14", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        style={{ backgroundColor: "#111827", padding: 14, borderRadius: 12, minWidth: 240 }}
      >
        <Text style={{ color: "#E5E7EB", textAlign: "center", fontWeight: "600" }}>
          Continue with Google
        </Text>
      </Pressable>
      <Text style={{ color: "#9CA3AF", marginTop: 12, fontSize: 12 }}>
        If nothing happens, allow pop-ups & third-party cookies.
      </Text>
    </View>
  );
}
