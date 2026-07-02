import React, { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useI18n } from "@/src/i18n";
import { api } from "@/src/api/client";
import { Body, Card, H2, H3, Muted } from "@/src/ui/kit";
import { colors, formatDate, formatRupiah, formatTime, spacing } from "@/src/ui/theme";
import { showToast } from "@/src/ui/Toast";

export default function AttendanceScreen() {
  const { t } = useI18n();
  const [history, setHistory] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ history: any[] }>("/attendance/me?limit=60");
      setHistory(res.history || []);
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

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <H2>{t("history")}</H2>
        <Muted>{history.length}</Muted>
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {history.length === 0 ? (
          <Card>
            <Muted>{t("no_data")}</Muted>
          </Card>
        ) : (
          history.map((h) => (
            <Card key={h.id} style={{ gap: 6 }} testID={`attendance-item-${h.id}`}>
              <View style={styles.row}>
                <H3>{formatDate(h.check_in_at)}</H3>
                <Body
                  style={{
                    fontWeight: "700",
                    color: h.is_late ? colors.danger : colors.success,
                  }}
                >
                  {h.is_late ? t("late") : t("on_time")}
                </Body>
              </View>
              <View style={styles.row}>
                <Muted>{t("check_in")}</Muted>
                <Body>
                  {formatTime(h.check_in_at)}
                  {h.check_out_at ? ` → ${formatTime(h.check_out_at)}` : ""}
                </Body>
              </View>
              {h.on_time_bonus > 0 && (
                <View style={styles.row}>
                  <Muted>{t("total_bonus")}</Muted>
                  <Body style={{ color: colors.success, fontWeight: "600" }}>
                    +{formatRupiah(h.on_time_bonus)}
                  </Body>
                </View>
              )}
              {h.penalty_amount > 0 && (
                <View style={styles.row}>
                  <Muted>
                    {t("total_penalty")} ({h.late_tier || `${h.late_minutes} ${t("minutes")}`})
                  </Muted>
                  <Body style={{ color: colors.danger, fontWeight: "600" }}>
                    -{formatRupiah(h.penalty_amount)}
                  </Body>
                </View>
              )}
              {h.overtime_amount > 0 && (
                <View style={styles.row}>
                  <Muted>
                    {t("overtime")} ({h.overtime_minutes} {t("minutes")})
                  </Muted>
                  <Body style={{ color: colors.info, fontWeight: "600" }}>
                    +{formatRupiah(h.overtime_amount)}
                  </Body>
                </View>
              )}
              {h.early_departure && (
                <View style={styles.row}>
                  <Muted>{t("early_departure")}</Muted>
                  <Body style={{ color: colors.warning, fontWeight: "600" }}>
                    {h.early_departure_deduction ? `-${formatRupiah(h.early_departure_deduction)}` : "OK"}
                  </Body>
                </View>
              )}
              {h.manual && (
                <Body style={{ fontSize: 11, color: colors.warning, marginTop: 4 }}>
                  {t("manual_attendance")} • {h.manual_reason}
                </Body>
              )}
            </Card>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    padding: spacing.lg,
    paddingBottom: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
