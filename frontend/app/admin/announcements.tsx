import React, { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { useI18n } from "@/src/i18n";
import { api } from "@/src/api/client";
import { Body, Button, Card, H2, H3, Input, Muted } from "@/src/ui/kit";
import { formatDate, spacing } from "@/src/ui/theme";
import { useTheme } from "@/src/ui/ThemeContext";
import { showToast } from "@/src/ui/Toast";

export default function AdminAnnouncementsScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<any[]>("/announcements");
      setItems(res);
    } catch (e: any) {
      showToast(e.message, "error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const [duration, setDuration] = useState("7");

  const submit = async () => {
    if (!title || !content) return;
    setBusy(true);
    try {
      await api.post("/announcements", { title, content, send_push: true, duration_days: parseInt(duration) });
      setTitle("");
      setContent("");
      showToast("Sent!", "success");
      await load();
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (id: string) => {
    try {
      await api.del(`/announcements/${id}`);
      showToast("Deleted", "success");
      await load();
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={["top"]}>
      <Stack.Screen options={{ title: "Manage Announcements", headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="back-button">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <H2>Pengumuman</H2>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Card style={{ gap: spacing.sm }}>
          <H3>Kirim Pengumuman Baru</H3>
          <Input label="Judul" value={title} onChangeText={setTitle} />
          <Input label="Isi Pesan" multiline numberOfLines={3} value={content} onChangeText={setContent} style={{ height: 80, textAlignVertical: "top" }} />
          <Input label="Durasi (Hari)" value={duration} onChangeText={setDuration} keyboardType="numeric" />
          <Button title="Kirim ke Semua (Push)" onPress={submit} loading={busy} />
        </Card>

        <H3 style={{ marginTop: spacing.md }}>Riwayat</H3>
        {items.map((a) => (
          <Card key={a.id} style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Body style={{ fontWeight: "700", flex: 1 }}>{a.title}</Body>
                <TouchableOpacity onPress={() => doDelete(a.id)}>
                    <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </TouchableOpacity>
            </View>
            <Muted>{formatDate(a.created_at)}</Muted>
            <Body>{a.content}</Body>
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, paddingBottom: spacing.sm },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
});
