import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "@/src/i18n";
import { useAuth } from "@/src/auth/AuthContext";
import { api } from "@/src/api/client";
import { Body, Button, Card, H2, H3, Input, Muted } from "@/src/ui/kit";
import { formatDate, radii, spacing } from "@/src/ui/theme";
import { useTheme } from "@/src/ui/ThemeContext";
import { showToast } from "@/src/ui/Toast";

export default function LeaveScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { user } = useAuth();
  const [tab, setTab] = useState<"division" | "mine">("division");
  const [division, setDivision] = useState<any[]>([]);
  const [mine, setMine] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState(false);
  const [date, setDate] = useState(defaultDate());
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, m] = await Promise.all([
        api.get<any[]>("/leave/division"),
        api.get<any[]>("/leave/me"),
      ]);
      setDivision(d);
      setMine(m);
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

  const submit = async () => {
    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      showToast("Format tanggal: YYYY-MM-DD", "error");
      return;
    }
    if (!reason.trim()) {
      showToast(t("reason"), "error");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/leave", { date, reason });
      showToast(t("saved"), "success");
      setModal(false);
      setReason("");
      await load();
    } catch (e: any) {
      showToast(e?.message || t("error"), "error");
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async (id: string) => {
    try {
      await api.del(`/leave/${id}`);
      showToast(t("cancelled"), "success");
      await load();
    } catch (e: any) {
      showToast(e?.message || t("error"), "error");
    }
  };

  const list = useMemo(() => (tab === "division" ? division : mine), [tab, division, mine]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={["top"]}>
      <View style={styles.header}>
        <H2>{t("leave")}</H2>
        <TouchableOpacity
          style={[styles.addBtn, { backgroundColor: colors.primary }]}
          onPress={() => setModal(true)}
          testID="request-leave-button"
        >
          <Ionicons name="add" size={20} color="#fff" />
          <Body style={{ color: "#fff", fontWeight: "700" }}>{t("request_leave")}</Body>
        </TouchableOpacity>
      </View>

      <View style={styles.tabsRow}>
        <TabChip
          label={t("leave_information_center")}
          active={tab === "division"}
          onPress={() => setTab("division")}
          testID="leave-tab-division"
        />
        <TabChip
          label={t("my_leaves")}
          active={tab === "mine"}
          onPress={() => setTab("mine")}
          testID="leave-tab-mine"
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {tab === "division" && (
          <Muted>
            {t("division")}: {user?.division || "—"}
          </Muted>
        )}
        {list.length === 0 ? (
          <Card>
            <Muted>{t("no_data")}</Muted>
          </Card>
        ) : (
          list.map((l) => (
            <Card key={l.id} style={{ gap: 6 }} testID={`leave-item-${l.id}`}>
              <View style={styles.row}>
                <H3>{formatDate(l.date)}</H3>
                <Body
                  style={{
                    fontWeight: "700",
                    color: l.status === "cancelled" ? colors.textSecondary : colors.success,
                  }}
                >
                  {l.status === "cancelled" ? t("cancelled") : l.status.toUpperCase()}
                </Body>
              </View>
              <Muted>
                {t("booked_by")}: {l.user_name} • {l.position}
              </Muted>
              <Body>{l.reason}</Body>
              {tab === "mine" && l.status !== "cancelled" && (
                <Button
                  title={t("cancel_leave")}
                  variant="outline"
                  size="sm"
                  onPress={() => cancel(l.id)}
                  testID={`cancel-leave-${l.id}`}
                />
              )}
            </Card>
          ))
        )}
      </ScrollView>

      <Modal
        visible={modal}
        animationType="slide"
        transparent
        onRequestClose={() => setModal(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={[styles.modalSheet, { backgroundColor: colors.surface }]}
          >
            <View style={styles.modalHeader}>
              <H3>{t("request_leave")}</H3>
              <TouchableOpacity onPress={() => setModal(false)} testID="close-leave-modal">
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <Input
              label={t("leave_date")}
              placeholder="YYYY-MM-DD"
              value={date}
              onChangeText={setDate}
              autoCapitalize="none"
              testID="leave-date-input"
            />
            <View style={{ gap: 6 }}>
              <Muted style={styles.label}>{t("reason")}</Muted>
              <TextInput
                value={reason}
                onChangeText={setReason}
                multiline
                numberOfLines={3}
                placeholder={t("reason")}
                placeholderTextColor={colors.textSecondary}
                style={[
                  styles.textarea,
                  {
                    borderColor: colors.border,
                    color: colors.textPrimary,
                    backgroundColor: colors.surface,
                  },
                ]}
                testID="leave-reason-input"
              />
            </View>
            <Button
              title={t("submit")}
              size="lg"
              onPress={submit}
              loading={submitting}
              testID="submit-leave-button"
            />
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const TabChip: React.FC<{
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}> = ({ label, active, onPress, testID }) => {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: colors.surface, borderColor: colors.border },
        active && { backgroundColor: colors.primary, borderColor: colors.primary },
      ]}
      testID={testID}
    >
      <Body
        style={{
          color: active ? "#fff" : colors.primary,
          fontWeight: "600",
          fontSize: 13,
        }}
      >
        {label}
      </Body>
    </TouchableOpacity>
  );
};

function defaultDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    padding: spacing.lg,
    paddingBottom: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.md,
  },
  tabsRow: {
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
    flexShrink: 0,
  },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.5)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    padding: spacing.lg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    gap: spacing.md,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  textarea: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    minHeight: 80,
    textAlignVertical: "top",
    fontSize: 15,
  },
});
