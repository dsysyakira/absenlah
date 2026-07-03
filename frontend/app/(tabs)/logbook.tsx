import React, { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useI18n } from "@/src/i18n";
import { api } from "@/src/api/client";
import { Body, Button, Card, H2, H3, Input, Muted } from "@/src/ui/kit";
import { colors, formatDate, spacing } from "@/src/ui/theme";
import { showToast } from "@/src/ui/Toast";

export default function LogbookScreen() {
  const { t } = useI18n();
  const [logs, setLogs] = useState<any[]>([]);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<any[]>("/activity-logs/me");
      setLogs(res);
    } catch (e: any) {
      showToast(e?.message || "Load failed", "error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!content.trim()) return;
    setBusy(true);
    try {
      await api.post("/activity-logs", { content });
      setContent("");
      showToast(t("saved"), "success");
      await load();
    } catch (e: any) {
      showToast(e?.message || t("error"), "error");
    } finally {
      setBusy(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <H2>Logbook</H2>
        <Muted>{t("indonesian") === "Bahasa Indonesia" ? "Catatan Aktivitas Harian" : "Daily Activity Logs"}</Muted>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Card style={{ gap: spacing.md }}>
          <H3>{t("indonesian") === "Bahasa Indonesia" ? "Input Aktivitas" : "Input Activity"}</H3>
          <Input
            placeholder={t("indonesian") === "Bahasa Indonesia" ? "Apa yang Anda kerjakan hari ini?" : "What are you working on today?"}
            multiline
            numberOfLines={4}
            value={content}
            onChangeText={setContent}
            testID="logbook-input"
            style={{ height: 100, textAlignVertical: "top" }}
          />
          <Button
            title={t("submit")}
            onPress={submit}
            loading={busy}
            testID="logbook-submit-button"
          />
        </Card>

        <H3 style={{ marginTop: spacing.md }}>{t("history")}</H3>
        {logs.map((log) => (
          <Card key={log.id} style={{ gap: 4 }}>
            <View style={styles.row}>
              <Body style={{ fontWeight: "700" }}>{formatDate(log.created_at)}</Body>
            </View>
            <Body>{log.content}</Body>
          </Card>
        ))}
        {logs.length === 0 && <Muted>{t("no_data")}</Muted>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { padding: spacing.lg, paddingBottom: spacing.sm },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
