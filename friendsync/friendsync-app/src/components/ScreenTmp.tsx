// src/components/ScreenTmp.tsx
import React from "react";
import { ScrollView, ViewProps, View } from "react-native";
import { useTheme } from "../lib/ThemeProvider";

export default function Screen({
  style,
  children,
  ...rest
}: ViewProps & { children?: React.ReactNode }) {
  const t = useTheme();

  return (
    <ScrollView
      style={[{ flex: 1, backgroundColor: t.color.bg }, style]}
      contentContainerStyle={{
        flexGrow: 1,
        minHeight: "100%",
        padding: t.space.lg,
      }}
      {...rest}
    >
      <View style={{ flex: 1 }}>{children}</View>
    </ScrollView>
  );
}
