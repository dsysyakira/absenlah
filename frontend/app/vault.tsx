import React, { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { useI18n } from "@/src/i18n";
import { api } from "@/src/api/client";
import { Body, Card, H2, H3, Muted } from "@/src/ui/kit";
import { formatDate, spacing } from "@/src/ui/theme";
import { useTheme } from "@/src/ui/ThemeContext";
import { showToast } from "@/src/ui/Toast";

export default function VaultScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ann, docs] = await Promise.all([
        api.get<any[]>("/announcements"),
        api.get<any[]>("/documents/me"),
      ]);
      setAnnouncements(ann);
      setDocuments(docs);
    } catch (e: any) {
      showToast(e?.message || "Load failed", "error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openUrl = (url: string) => {
    Linking.openURL(url).catch(() => showToast("Could not open URL", "error"));
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={["top"]}>
      <Stack.Screen options={{ title: "Vault", headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="back-button">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <H2>Vault</H2>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <H3>{t("indonesian") === "Bahasa Indonesia" ? "Pengumuman" : "Announcements"}</H3>
        {announcements.map((a) => (
          <Card key={a.id} style={{ gap: 4 }}>
            <Body style={{ fontWeight: "700" }}>{a.title}</Body>
            <Muted style={{ fontSize: 12 }}>{formatDate(a.created_at)}</Muted>
            <Body style={{ marginTop: 4 }}>{a.content}</Body>
          </Card>
        ))}
        {announcements.length === 0 && <Muted>{t("no_data")}</Muted>}

        <H3 style={{ marginTop: spacing.lg }}>{t("indonesian") === "Bahasa Indonesia" ? "Dokumen Saya" : "My Documents"}</H3>
        {documents.map((d) => (
          <TouchableOpacity key={d.id} onPress={() => openUrl(d.url)}>
            <Card style={styles.docCard}>
              <Ionicons name="document-outline" size={24} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "700" }}>{d.title}</Body>
                <Muted style={{ fontSize: 12 }}>{formatDate(d.created_at)}</Muted>
              </View>
              <Ionicons name="download-outline" size={20} color={colors.textSecondary} />
            </Card>
          </TouchableOpacity>
        ))}
        {documents.length === 0 && <Muted>{t("no_data")}</Muted>}
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
  docCard: { flexDirection: "row", alignItems: "center", gap: spacing.md },
});
