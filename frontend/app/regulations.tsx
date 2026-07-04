import React, { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { useI18n } from "@/src/i18n";
import { api } from "@/src/api/client";
import { Body, Card, H2, Muted } from "@/src/ui/kit";
import { spacing } from "@/src/ui/theme";
import { useTheme } from "@/src/ui/ThemeContext";
import { showToast } from "@/src/ui/Toast";

export default function RegulationsScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const [content, setContent] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ content: string }>("/regulations");
      setContent(r.content || "");
    } catch (e: any) {
      showToast(e?.message || "Load failed", "error");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="back-button">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <H2>{t("regulations")}</H2>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card>
          {content ? (
            <Body style={{ lineHeight: 22 }} testID="regulations-content">
              {content}
            </Body>
          ) : (
            <Muted>{t("no_data")}</Muted>
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
});
