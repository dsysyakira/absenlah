import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Image,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { useI18n } from "@/src/i18n";
import { api } from "@/src/api/client";
import { Body, Button, Card, H2, H3, Muted } from "@/src/ui/kit";
import { colors, formatDate, formatTime, radii, spacing } from "@/src/ui/theme";
import { showToast } from "@/src/ui/Toast";

type Tab = "early_departure" | "emergency" | "lateness" | "manual";

export default function ApprovalsScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("early_departure");
  const [ed, setEd] = useState<any[]>([]);
  const [em, setEm] = useState<any[]>([]);
  const [late, setLate] = useState<any[]>([]);
  const [manual, setManual] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [proofView, setProofView] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, b, c, d] = await Promise.all([
        api.get<any[]>("/early-departure/pending"),
        api.get<any[]>("/emergency/pending"),
        api.get<any>("/attendance/reports?is_late=true"),
        api.get<any>("/attendance/reports?manual=true&arrival_status=pending"),
      ]);
      setEd(a);
      setEm(b);
      setLate((c.records || []).filter((r: any) => !r.lateness_reviewed));
      setManual(d.records || []);
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

  const decide = async (
    kind: "early-departure" | "emergency",
    id: string,
    approve: boolean,
  ) => {
    setBusyId(id);
    try {
      await api.post(`/${kind}/${id}/review`, { approve });
      showToast(approve ? t("approved") : t("rejected"), "success");
      await load();
    } catch (e: any) {
      showToast(e?.message || t("error"), "error");
    } finally {
      setBusyId(null);
    }
  };

  const reviewLate = async (id: string, penalty_type: string) => {
    setBusyId(id);
    try {
      await api.post(`/attendance/${id}/review-lateness`, { penalty_type });
      showToast("Lateness reviewed", "success");
      await load();
    } catch (e: any) {
      showToast(e?.message || t("error"), "error");
    } finally {
      setBusyId(null);
    }
  };

  const confirmArrival = async (id: string) => {
    setBusyId(id);
    try {
      await api.post(`/attendance/${id}/confirm-arrival`, {
        confirmed_arrival_at: new Date().toISOString(),
      });
      showToast("Arrival confirmed", "success");
      await load();
    } catch (e: any) {
      showToast(e?.message || t("error"), "error");
    } finally {
      setBusyId(null);
    }
  };

  const getList = () => {
    if (tab === "early_departure") return ed;
    if (tab === "emergency") return em;
    if (tab === "lateness") return late;
    return manual;
  };
  const list = getList();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="back-button">
          <Ionicons name="arrow-back" size={22} color={colors.primary} />
        </TouchableOpacity>
        <H2>{t("approvals_inbox")}</H2>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRowScroll}>
        <View style={styles.chipsRow}>
          <TabChip label={t("tab_early_departure")} count={ed.length} active={tab === "early_departure"} onPress={() => setTab("early_departure")} />
          <TabChip label={t("tab_emergency")} count={em.length} active={tab === "emergency"} onPress={() => setTab("emergency")} />
          <TabChip label={t("late")} count={late.length} active={tab === "lateness"} onPress={() => setTab("lateness")} />
          <TabChip label="Manual" count={manual.length} active={tab === "manual"} onPress={() => setTab("manual")} />
        </View>
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {list.length === 0 ? (
          <Card>
            <Muted>{t("no_pending")}</Muted>
          </Card>
        ) : (
          list.map((r) => (
            <Card key={r.id} style={{ gap: 6 }} testID={`approval-item-${r.id}`}>
              <View style={styles.rowSpace}>
                <View>
                  <H3>{r.user_name}</H3>
                  <Muted>
                    {r.position} • {r.division}
                  </Muted>
                </View>
                <Body style={{ fontWeight: "700" }}>{formatDate(r.date)}</Body>
              </View>
              {tab === "early_departure" && (
                <Muted>
                  {t("check_out")}: {formatTime(r.requested_check_out_at)}
                </Muted>
              )}
              {tab === "lateness" && (
                <Muted>
                  {t("late")}: {r.late_minutes} {t("minutes")}
                </Muted>
              )}
              {tab === "manual" && (
                <Muted>
                  Limit Arrival: {formatTime(r.arrival_limit_at)}
                </Muted>
              )}
              {tab === "emergency" && (
                <>
                  <Body style={{ fontSize: 13 }}>{r.reason}</Body>
                  {r.proof_base64 && (
                    <TouchableOpacity
                      onPress={() => setProofView(r.proof_base64)}
                      testID={`view-proof-${r.id}`}
                    >
                      <Body style={{ color: colors.accent, fontWeight: "600" }}>
                        {t("view_proof")}
                      </Body>
                    </TouchableOpacity>
                  )}
                </>
              )}
              <View style={{ gap: 8, marginTop: 6 }}>
                {tab === "lateness" ? (
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Button
                      title="Quota"
                      variant="outline"
                      size="sm"
                      onPress={() => reviewLate(r.id, "lateness_quota")}
                      loading={busyId === r.id}
                      style={{ flex: 1 }}
                    />
                    <Button
                      title="Libur"
                      variant="outline"
                      size="sm"
                      onPress={() => reviewLate(r.id, "leave_day")}
                      loading={busyId === r.id}
                      style={{ flex: 1 }}
                    />
                    <Button
                      title="Darurat"
                      variant="outline"
                      size="sm"
                      onPress={() => reviewLate(r.id, "emergency_quota")}
                      loading={busyId === r.id}
                      style={{ flex: 1 }}
                    />
                  </View>
                ) : tab === "manual" ? (
                  <Button
                    title="Konfirmasi Kedatangan"
                    variant="success"
                    size="sm"
                    onPress={() => confirmArrival(r.id)}
                    loading={busyId === r.id}
                  />
                ) : (
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Button
                      title={t("reject")}
                      variant="outline"
                      size="sm"
                      onPress={() => decide(tab === "early_departure" ? "early-departure" : "emergency", r.id, false)}
                      loading={busyId === r.id}
                      style={{ flex: 1 }}
                      testID={`reject-${r.id}`}
                    />
                    <Button
                      title={t("approve")}
                      variant="success"
                      size="sm"
                      onPress={() => decide(tab === "early_departure" ? "early-departure" : "emergency", r.id, true)}
                      loading={busyId === r.id}
                      style={{ flex: 1 }}
                      testID={`approve-${r.id}`}
                    />
                  </View>
                )}
              </View>
            </Card>
          ))
        )}
      </ScrollView>

      <Modal
        visible={!!proofView}
        transparent
        animationType="fade"
        onRequestClose={() => setProofView(null)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setProofView(null)}
          style={styles.proofOverlay}
        >
          {proofView && (
            <Image
              source={{
                uri: proofView.startsWith("data:") ? proofView : `data:image/jpeg;base64,${proofView}`,
              }}
              style={{ width: "90%", height: "70%", resizeMode: "contain" }}
            />
          )}
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const TabChip = ({ label, count, active, onPress }: any) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.chip, active && styles.chipActive]}
  >
    <Body
      numberOfLines={1}
      style={{
        color: active ? "#fff" : colors.primary,
        fontWeight: "600",
        fontSize: 12,
      }}
    >
      {label} ({count})
    </Body>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  chipsRowScroll: { flexGrow: 0, maxHeight: 52 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
    height: 36,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flex: 1,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  rowSpace: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  proofOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
});
