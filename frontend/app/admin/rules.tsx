import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { useI18n } from "@/src/i18n";
import { api } from "@/src/api/client";
import { Body, Button, Card, H2, H3, Input, Muted } from "@/src/ui/kit";
import { colors, radii, spacing } from "@/src/ui/theme";
import { showToast } from "@/src/ui/Toast";

export default function RulesAdmin() {
  const { t } = useI18n();
  const router = useRouter();
  const [cfg, setCfg] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const c = await api.get<any>("/config");
      setCfg(c);
    } catch (e: any) {
      showToast(e?.message || "Load failed", "error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const payload = {
        shift_start: cfg.shift_start,
        shift_end: cfg.shift_end,
        lateness_start: cfg.lateness_start,
        on_time_bonus: parseInt(String(cfg.on_time_bonus), 10) || 0,
        late_tiers: (cfg.late_tiers || []).map((x: any) => ({
          from_min: parseInt(String(x.from_min), 10) || 0,
          to_min: parseInt(String(x.to_min), 10) || 0,
          fine: parseInt(String(x.fine), 10) || 0,
          label: x.label || "",
        })),
        overtime_tiers: (cfg.overtime_tiers || []).map((x: any) => ({
          minutes_after: parseInt(String(x.minutes_after), 10) || 0,
          amount: parseInt(String(x.amount), 10) || 0,
        })),
        overtime_step_min: parseInt(String(cfg.overtime_step_min), 10) || 30,
        overtime_step_amount: parseInt(String(cfg.overtime_step_amount), 10) || 0,
        shift_duration_hours: parseInt(String(cfg.shift_duration_hours), 10) || 10,
        early_departure_earliest: cfg.early_departure_earliest,
        early_departure_monthly_limit: parseInt(String(cfg.early_departure_monthly_limit), 10) || 3,
        late_step_after_tiers_min: parseInt(String(cfg.late_step_after_tiers_min), 10) || 30,
        late_step_after_tiers_amount:
          parseInt(String(cfg.late_step_after_tiers_amount), 10) || 0,
        leave_min_hours_before_shift:
          parseInt(String(cfg.leave_min_hours_before_shift), 10) || 2,
        manual_arrival_limit_hours: parseInt(String(cfg.manual_arrival_limit_hours), 10) || 2,
        lateness_monthly_quota: parseInt(String(cfg.lateness_monthly_quota), 10) || 3,
        emergency_quota_period_months:
          parseInt(String(cfg.emergency_quota_period_months), 10) || 6,
        emergency_quota_limit: parseInt(String(cfg.emergency_quota_limit), 10) || 2,
      };
      const updated = await api.put("/config", payload);
      setCfg(updated);
      showToast(t("saved"), "success");
    } catch (e: any) {
      showToast(e?.message || t("error"), "error");
    } finally {
      setSaving(false);
    }
  };

  if (!cfg) {
    return (
      <SafeAreaView style={styles.safe}>
        <Muted style={{ padding: spacing.lg }}>{t("loading")}</Muted>
      </SafeAreaView>
    );
  }

  const update = (k: string, v: any) => setCfg({ ...cfg, [k]: v });

  const addLateTier = () =>
    update("late_tiers", [
      ...(cfg.late_tiers || []),
      { from_min: 0, to_min: 0, fine: 0, label: "" },
    ]);
  const removeLateTier = (i: number) =>
    update(
      "late_tiers",
      (cfg.late_tiers || []).filter((_: any, idx: number) => idx !== i),
    );
  const setLateTier = (i: number, key: string, v: any) => {
    const arr = [...cfg.late_tiers];
    arr[i] = { ...arr[i], [key]: v };
    update("late_tiers", arr);
  };

  const addOtTier = () =>
    update("overtime_tiers", [...(cfg.overtime_tiers || []), { minutes_after: 0, amount: 0 }]);
  const removeOtTier = (i: number) =>
    update(
      "overtime_tiers",
      (cfg.overtime_tiers || []).filter((_: any, idx: number) => idx !== i),
    );
  const setOtTier = (i: number, key: string, v: any) => {
    const arr = [...cfg.overtime_tiers];
    arr[i] = { ...arr[i], [key]: v };
    update("overtime_tiers", arr);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="back-button">
          <Ionicons name="arrow-back" size={22} color={colors.primary} />
        </TouchableOpacity>
        <H2>{t("dynamic_rules")}</H2>
        <View style={{ width: 22 }} />
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Shift block */}
          <Card style={{ gap: spacing.md }}>
            <H3>Shift</H3>
            <RowGrid>
              <Input
                label={t("shift_start")}
                value={cfg.shift_start}
                onChangeText={(v) => update("shift_start", v)}
                testID="rule-shift-start"
              />
              <Input
                label={t("shift_end")}
                value={cfg.shift_end}
                onChangeText={(v) => update("shift_end", v)}
                testID="rule-shift-end"
              />
            </RowGrid>
            <RowGrid>
              <Input
                label={t("lateness_start")}
                value={cfg.lateness_start}
                onChangeText={(v) => update("lateness_start", v)}
                testID="rule-lateness-start"
              />
              <Input
                label={t("duration_hours")}
                value={String(cfg.shift_duration_hours)}
                onChangeText={(v) => update("shift_duration_hours", v)}
                keyboardType="numeric"
                testID="rule-duration"
              />
            </RowGrid>
            <Input
              label={t("on_time_bonus_label")}
              value={String(cfg.on_time_bonus)}
              onChangeText={(v) => update("on_time_bonus", v)}
              keyboardType="numeric"
              testID="rule-on-time-bonus"
            />
          </Card>

          {/* Late tiers */}
          <Card style={{ gap: spacing.md }}>
            <View style={styles.rowSpace}>
              <H3>{t("late_tiers_label")}</H3>
              <Button title={t("add_tier")} variant="outline" size="sm" onPress={addLateTier} testID="add-late-tier" />
            </View>
            {(cfg.late_tiers || []).map((tier: any, i: number) => (
              <View key={i} style={styles.tierRow} testID={`late-tier-${i}`}>
                <Input
                  label={t("range_min")}
                  value={String(tier.from_min)}
                  onChangeText={(v) => setLateTier(i, "from_min", v)}
                  keyboardType="numeric"
                  style={{ flex: 1 }}
                />
                <Input
                  label={t("range_max")}
                  value={String(tier.to_min)}
                  onChangeText={(v) => setLateTier(i, "to_min", v)}
                  keyboardType="numeric"
                  style={{ flex: 1 }}
                />
                <Input
                  label={t("fine")}
                  value={String(tier.fine)}
                  onChangeText={(v) => setLateTier(i, "fine", v)}
                  keyboardType="numeric"
                  style={{ flex: 1 }}
                />
                <TouchableOpacity onPress={() => removeLateTier(i)} testID={`remove-late-tier-${i}`}>
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </TouchableOpacity>
              </View>
            ))}
            <RowGrid>
              <Input
                label={t("step_min")}
                value={String(cfg.late_step_after_tiers_min)}
                onChangeText={(v) => update("late_step_after_tiers_min", v)}
                keyboardType="numeric"
                testID="rule-late-step-min"
              />
              <Input
                label={t("step_amount")}
                value={String(cfg.late_step_after_tiers_amount)}
                onChangeText={(v) => update("late_step_after_tiers_amount", v)}
                keyboardType="numeric"
                testID="rule-late-step-amount"
              />
            </RowGrid>
          </Card>

          {/* Overtime */}
          <Card style={{ gap: spacing.md }}>
            <View style={styles.rowSpace}>
              <H3>{t("overtime_tiers_label")}</H3>
              <Button title={t("add_tier")} variant="outline" size="sm" onPress={addOtTier} testID="add-ot-tier" />
            </View>
            {(cfg.overtime_tiers || []).map((tier: any, i: number) => (
              <View key={i} style={styles.tierRow} testID={`ot-tier-${i}`}>
                <Input
                  label={t("minutes_after")}
                  value={String(tier.minutes_after)}
                  onChangeText={(v) => setOtTier(i, "minutes_after", v)}
                  keyboardType="numeric"
                  style={{ flex: 1 }}
                />
                <Input
                  label={t("amount")}
                  value={String(tier.amount)}
                  onChangeText={(v) => setOtTier(i, "amount", v)}
                  keyboardType="numeric"
                  style={{ flex: 1 }}
                />
                <TouchableOpacity onPress={() => removeOtTier(i)} testID={`remove-ot-tier-${i}`}>
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </TouchableOpacity>
              </View>
            ))}
            <RowGrid>
              <Input
                label={t("step_min")}
                value={String(cfg.overtime_step_min)}
                onChangeText={(v) => update("overtime_step_min", v)}
                keyboardType="numeric"
                testID="rule-ot-step-min"
              />
              <Input
                label={t("step_amount")}
                value={String(cfg.overtime_step_amount)}
                onChangeText={(v) => update("overtime_step_amount", v)}
                keyboardType="numeric"
                testID="rule-ot-step-amount"
              />
            </RowGrid>
          </Card>

          {/* Early departure & leave */}
          <Card style={{ gap: spacing.md }}>
            <H3>{t("early_departure")}</H3>
            <RowGrid>
              <Input
                label={t("earliest_early_departure")}
                value={cfg.early_departure_earliest}
                onChangeText={(v) => update("early_departure_earliest", v)}
                testID="rule-earliest-ed"
              />
              <Input
                label={t("monthly_limit")}
                value={String(cfg.early_departure_monthly_limit)}
                onChangeText={(v) => update("early_departure_monthly_limit", v)}
                keyboardType="numeric"
                testID="rule-monthly-limit"
              />
            </RowGrid>
            <RowGrid>
              <Input
                label={t("min_hours_before_shift")}
                value={String(cfg.leave_min_hours_before_shift)}
                onChangeText={(v) => update("leave_min_hours_before_shift", v)}
                keyboardType="numeric"
                testID="rule-leave-min-hours"
              />
              <Input
                label={t("manual_arrival_limit")}
                value={String(cfg.manual_arrival_limit_hours)}
                onChangeText={(v) => update("manual_arrival_limit_hours", v)}
                keyboardType="numeric"
                testID="rule-manual-limit"
              />
            </RowGrid>
          </Card>

          {/* Quotas */}
          <Card style={{ gap: spacing.md }}>
            <H3>{t("lateness_quota")} & {t("emergency_quota")}</H3>
            <Input
              label={t("lateness_monthly_quota")}
              value={String(cfg.lateness_monthly_quota ?? 3)}
              onChangeText={(v) => update("lateness_monthly_quota", v)}
              keyboardType="numeric"
              testID="rule-lateness-quota"
            />
            <RowGrid>
              <Input
                label={t("emergency_quota_period_months")}
                value={String(cfg.emergency_quota_period_months ?? 6)}
                onChangeText={(v) => update("emergency_quota_period_months", v)}
                keyboardType="numeric"
                testID="rule-emergency-period"
              />
              <Input
                label={t("emergency_quota_limit")}
                value={String(cfg.emergency_quota_limit ?? 2)}
                onChangeText={(v) => update("emergency_quota_limit", v)}
                keyboardType="numeric"
                testID="rule-emergency-limit"
              />
            </RowGrid>
          </Card>

          <Button
            title={t("save_rules")}
            size="lg"
            onPress={save}
            loading={saving}
            testID="save-rules-button"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const RowGrid: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <View style={{ flexDirection: "row", gap: spacing.md }}>
    {React.Children.map(children, (c) => (
      <View style={{ flex: 1 }}>{c}</View>
    ))}
  </View>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: 60 },
  rowSpace: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tierRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "flex-end",
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
