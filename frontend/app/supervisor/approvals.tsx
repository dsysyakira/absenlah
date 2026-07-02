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

type Tab = "early_departure" | "emergency";

export default function ApprovalsScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("early_departure");
  const [ed, setEd] = useState<any[]>([]);
  const [em, setEm] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [proofView, setProofView] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        api.get<any[]>("/early-departure/pending"),
        api.get<any[]>("/emergency/pending"),
      ]);
      setEd(a);
      setEm(b);
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

  const list = tab === "early_departure" ? ed : em;

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

      <View style={styles.chipsRow}>
        <TouchableOpacity
          onPress={() => setTab("early_departure")}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          style={[styles.chip, tab === "early_departure" && styles.chipActive]}
          testID="approvals-tab-ed"
        >
          <Body
            style={{
              color: tab === "early_departure" ? "#fff" : colors.primary,
              fontWeight: "600",
              fontSize: 13,
            }}
          >
            {t("tab_early_departure")} ({ed.length})
          </Body>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setTab("emergency")}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          style={[styles.chip, tab === "emergency" && styles.chipActive]}
          testID="approvals-tab-em"
        >
          <Body
            style={{
              color: tab === "emergency" ? "#fff" : colors.primary,
              fontWeight: "600",
              fontSize: 13,
            }}
          >
            {t("tab_emergency")} ({em.length})
          </Body>
        </TouchableOpacity>
      </View>

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
              <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
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
