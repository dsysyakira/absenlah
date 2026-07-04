import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useI18n } from "@/src/i18n";
import { api, getToken } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { Body, Button, Card, H2, H3, Muted } from "@/src/ui/kit";
import { formatDate, formatRupiah, radii, spacing } from "@/src/ui/theme";
import { useTheme } from "@/src/ui/ThemeContext";
import { showToast } from "@/src/ui/Toast";

type Period = "daily" | "weekly" | "monthly";

export default function ReportsScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>("monthly");
  const [data, setData] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<any>(`/attendance/reports?period=${period}`);
      setData(res);
    } catch (e: any) {
      showToast(e?.message || "Load failed", "error");
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const doExport = async (format: "csv" | "excel") => {
    try {
      const tok = await getToken();
      const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
      const path = format === "csv" ? "export" : "export-excel";
      const url = `${baseUrl}/api/attendance/reports/${path}?access_token=${tok}`;

      const { Linking } = await import("react-native");
      Linking.openURL(url);
      showToast(`Exporting ${format.toUpperCase()}...`, "info");
    } catch (e: any) {
      showToast(e?.message || t("error"), "error");
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={["top"]}>
      <View style={styles.header}>
        <H2>{t("reports")}</H2>
      </View>

      <View style={styles.chipsRow}>
        {(["daily", "weekly", "monthly"] as Period[]).map((p) => (
          <TouchableOpacity
            key={p}
            onPress={() => setPeriod(p)}
            style={[styles.chip, period === p && styles.chipActive]}
            testID={`period-${p}`}
          >
            <Body
              style={{
                color: period === p ? "#fff" : colors.primary,
                fontWeight: "600",
                fontSize: 13,
              }}
            >
              {t(p)}
            </Body>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Card style={{ gap: spacing.md }}>
          <View style={styles.row}>
            <H3>
              {t("period")}: {t(period)}
            </H3>
            {user?.role === "admin" && (
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Button
                    title="CSV"
                    variant="outline"
                    size="sm"
                    onPress={() => doExport("csv")}
                    testID="export-csv-button"
                />
                <Button
                    title="Excel"
                    variant="outline"
                    size="sm"
                    onPress={() => doExport("excel")}
                    testID="export-excel-button"
                />
              </View>
            )}
          </View>
          <View style={styles.statsGrid}>
            <Stat
              label={t("on_time_days")}
              value={String(data?.on_time_count || 0)}
              color={colors.success}
            />
            <Stat
              label={t("late_days")}
              value={String(data?.late_count || 0)}
              color={colors.danger}
            />
            <Stat
              label={t("total_bonus")}
              value={formatRupiah(data?.total_bonus || 0)}
              color={colors.success}
            />
            <Stat
              label={t("total_penalty")}
              value={formatRupiah(data?.total_penalty || 0)}
              color={colors.danger}
            />
            <Stat
              label={t("total_overtime")}
              value={formatRupiah(data?.total_overtime || 0)}
              color={colors.info}
            />
          </View>
        </Card>

        <H3 style={{ marginTop: spacing.sm }}>
          {t("history")} ({data?.records?.length || 0})
        </H3>
        {(data?.records || []).map((r: any) => (
          <Card key={r.id} style={{ gap: 4 }}>
            <View style={styles.row}>
              <Body style={{ fontWeight: "700" }}>{formatDate(r.check_in_at)}</Body>
              <Body
                style={{
                  color: r.is_late ? colors.danger : colors.success,
                  fontWeight: "700",
                }}
              >
                {r.is_late ? t("late") : t("on_time")}
              </Body>
            </View>
            <Muted>
              Bonus: {formatRupiah(r.on_time_bonus || 0)} • Denda:{" "}
              {formatRupiah(r.penalty_amount || 0)} • Lembur:{" "}
              {formatRupiah(r.overtime_amount || 0)}
            </Muted>
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const Stat: React.FC<{ label: string; value: string; color: string }> = ({
  label,
  value,
  color,
}) => {
  const { colors } = useTheme();
  return (
    <View style={[styles.statCell, { backgroundColor: colors.muted }]}>
      <Muted style={{ fontSize: 10 }}>{label}</Muted>
      <Body style={{ fontWeight: "800", fontSize: 15, color, marginTop: 2 }}>{value}</Body>
    </View>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  chipsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexShrink: 0,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  statCell: {
    flexBasis: "48%",
    flexGrow: 1,
    padding: spacing.md,
    backgroundColor: colors.muted,
    borderRadius: radii.md,
  },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
