import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Image,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useI18n } from "@/src/i18n";
import { api } from "@/src/api/client";
import { Body, Button, Card, H2, H3, Input, Muted } from "@/src/ui/kit";
import { colors, formatDate, formatRupiah, formatTime, radii, spacing } from "@/src/ui/theme";
import { showToast } from "@/src/ui/Toast";

type Section = "attendance" | "lateness" | "early_departure" | "emergency";

export default function AttendanceScreen() {
  const { t } = useI18n();
  const [section, setSection] = useState<Section>("attendance");
  const [refreshing, setRefreshing] = useState(false);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [lateness, setLateness] = useState<any>({ history: [] });
  const [earlyDep, setEarlyDep] = useState<any[]>([]);
  const [emergency, setEmergency] = useState<any[]>([]);
  const [emergencyQuota, setEmergencyQuota] = useState<any>(null);
  const [modal, setModal] = useState(false);

  const load = useCallback(async () => {
    try {
      const [att, lt, ed, em, qt] = await Promise.all([
        api.get<{ history: any[] }>("/attendance/me?limit=60"),
        api.get<any>("/lateness/me"),
        api.get<any[]>("/early-departure/me"),
        api.get<any[]>("/emergency/me"),
        api.get<any>("/emergency/quota"),
      ]);
      setAttendance(att.history || []);
      setLateness(lt);
      setEarlyDep(ed);
      setEmergency(em);
      setEmergencyQuota(qt);
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
        <H2>{t("my_history")}</H2>
        {section === "emergency" && (
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => setModal(true)}
            testID="request-emergency-button"
          >
            <Ionicons name="add" size={18} color="#fff" />
            <Body style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>
              {t("request_emergency")}
            </Body>
          </TouchableOpacity>
        )}
      </View>

      {/* Chips row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsScroll}
        contentContainerStyle={styles.chipsRow}
      >
        {(
          [
            ["attendance", t("tab_attendance")],
            ["lateness", t("tab_lateness")],
            ["early_departure", t("tab_early_departure")],
            ["emergency", t("tab_emergency")],
          ] as [Section, string][]
        ).map(([key, label]) => (
          <TouchableOpacity
            key={key}
            onPress={() => setSection(key)}
            style={[styles.chip, section === key && styles.chipActive]}
            testID={`history-chip-${key}`}
          >
            <Body
              style={{
                color: section === key ? "#fff" : colors.primary,
                fontWeight: "600",
                fontSize: 13,
              }}
            >
              {label}
            </Body>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {section === "attendance" && <AttendanceList items={attendance} />}
        {section === "lateness" && <LatenessSection data={lateness} />}
        {section === "early_departure" && <EarlyDepartureSection items={earlyDep} />}
        {section === "emergency" && (
          <EmergencySection items={emergency} quota={emergencyQuota} />
        )}
      </ScrollView>

      <EmergencyModal visible={modal} onClose={() => setModal(false)} onSaved={load} />
    </SafeAreaView>
  );
}

/* ---------- Sections ---------- */

const AttendanceList: React.FC<{ items: any[] }> = ({ items }) => {
  const { t } = useI18n();
  if (items.length === 0)
    return (
      <Card>
        <Muted>{t("no_data")}</Muted>
      </Card>
    );
  return (
    <>
      {items.map((h) => (
        <Card key={h.id} style={{ gap: 6 }} testID={`attendance-item-${h.id}`}>
          <View style={styles.rowSpace}>
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
          <View style={styles.rowSpace}>
            <Muted>{t("check_in")}</Muted>
            <Body>
              {formatTime(h.check_in_at)}
              {h.check_out_at ? ` → ${formatTime(h.check_out_at)}` : ""}
            </Body>
          </View>
          {h.on_time_bonus > 0 && (
            <Row label={t("total_bonus")} value={`+${formatRupiah(h.on_time_bonus)}`} color={colors.success} />
          )}
          {h.penalty_amount > 0 && (
            <Row
              label={`${t("total_penalty")} (${h.late_tier || `${h.late_minutes} ${t("minutes")}`})`}
              value={`-${formatRupiah(h.penalty_amount)}`}
              color={colors.danger}
            />
          )}
          {h.overtime_amount > 0 && (
            <Row
              label={`${t("overtime")} (${h.overtime_minutes} ${t("minutes")})`}
              value={`+${formatRupiah(h.overtime_amount)}`}
              color={colors.info}
            />
          )}
          {h.early_departure && (
            <Row
              label={t("early_departure")}
              value={statusLabel(h.early_departure_status, t)}
              color={statusColor(h.early_departure_status)}
            />
          )}
        </Card>
      ))}
    </>
  );
};

const LatenessSection: React.FC<{ data: any }> = ({ data }) => {
  const { t } = useI18n();
  const remaining = data?.remaining_this_month ?? 0;
  const usedPct = data?.quota
    ? Math.min(100, ((data.used_this_month || 0) / data.quota) * 100)
    : 0;
  return (
    <>
      <Card>
        <H3>{t("lateness_quota")}</H3>
        <View style={styles.rowSpace}>
          <Muted>{t("used_this_month")}</Muted>
          <Body style={{ fontWeight: "700" }} testID="lateness-used">
            {data?.used_this_month || 0} / {data?.quota || 0}
          </Body>
        </View>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressBar,
              { width: `${usedPct}%`, backgroundColor: remaining > 0 ? colors.warning : colors.danger },
            ]}
          />
        </View>
        <View style={styles.rowSpace}>
          <Muted>{t("remaining_this_month")}</Muted>
          <Body style={{ fontWeight: "700", color: remaining > 0 ? colors.success : colors.danger }} testID="lateness-remaining">
            {remaining}
          </Body>
        </View>
      </Card>
      {(data?.history || []).length === 0 ? (
        <Card>
          <Muted>{t("no_data")}</Muted>
        </Card>
      ) : (
        (data?.history || []).map((h: any) => (
          <Card key={h.id} style={{ gap: 6 }}>
            <View style={styles.rowSpace}>
              <H3>{formatDate(h.check_in_at)}</H3>
              <Body style={{ fontWeight: "700", color: colors.danger }}>
                {h.late_minutes} {t("minutes")}
              </Body>
            </View>
            <Muted>
              {t("check_in")}: {formatTime(h.check_in_at)} • {t("fine")}: {formatRupiah(h.penalty_amount || 0)}
            </Muted>
            {h.late_tier ? <Muted>Tier: {h.late_tier}</Muted> : null}
          </Card>
        ))
      )}
    </>
  );
};

const EarlyDepartureSection: React.FC<{ items: any[] }> = ({ items }) => {
  const { t } = useI18n();
  if (items.length === 0)
    return (
      <Card>
        <Muted>{t("no_data")}</Muted>
      </Card>
    );
  return (
    <>
      {items.map((r) => (
        <Card key={r.id} style={{ gap: 6 }} testID={`ed-item-${r.id}`}>
          <View style={styles.rowSpace}>
            <H3>{formatDate(r.date)}</H3>
            <StatusPill status={r.status} />
          </View>
          <Muted>
            {t("check_out")}: {formatTime(r.requested_check_out_at)}
          </Muted>
          {r.reviewed_by_name ? (
            <Muted>
              {t("reviewed_by")}: {r.reviewed_by_name}
            </Muted>
          ) : null}
          {r.review_note ? <Body style={{ fontSize: 13 }}>{r.review_note}</Body> : null}
          {r.deduction_applied ? (
            <Row label={t("deduction")} value={`-${formatRupiah(r.deduction_applied)}`} color={colors.danger} />
          ) : null}
        </Card>
      ))}
    </>
  );
};

const EmergencySection: React.FC<{ items: any[]; quota: any }> = ({ items, quota }) => {
  const { t } = useI18n();
  const [proofView, setProofView] = useState<string | null>(null);
  return (
    <>
      {quota && (
        <Card>
          <H3>{t("emergency_quota")}</H3>
          <Muted>
            {t("period")}: {quota.period_start} → {quota.period_end}
          </Muted>
          <View style={styles.rowSpace}>
            <Muted>{t("quota_used")}</Muted>
            <Body style={{ fontWeight: "700" }} testID="emergency-used">
              {quota.approved} / {quota.limit}
            </Body>
          </View>
          <View style={styles.rowSpace}>
            <Muted>{t("quota_remaining")}</Muted>
            <Body
              style={{
                fontWeight: "700",
                color: quota.remaining > 0 ? colors.success : colors.danger,
              }}
              testID="emergency-remaining"
            >
              {quota.remaining}
            </Body>
          </View>
        </Card>
      )}
      {items.length === 0 ? (
        <Card>
          <Muted>{t("no_data")}</Muted>
        </Card>
      ) : (
        items.map((r) => (
          <Card key={r.id} style={{ gap: 6 }} testID={`em-item-${r.id}`}>
            <View style={styles.rowSpace}>
              <H3>{formatDate(r.date)}</H3>
              <StatusPill status={r.status} />
            </View>
            <Body style={{ fontSize: 13 }}>{r.reason}</Body>
            {r.proof_base64 ? (
              <TouchableOpacity
                onPress={() => setProofView(r.proof_base64)}
                testID={`view-proof-${r.id}`}
              >
                <Body style={{ color: colors.accent, fontWeight: "600" }}>
                  {t("view_proof")}
                </Body>
              </TouchableOpacity>
            ) : null}
            {r.reviewed_by_name ? (
              <Muted>
                {t("reviewed_by")}: {r.reviewed_by_name}
              </Muted>
            ) : null}
            {r.review_note ? <Body style={{ fontSize: 13 }}>{r.review_note}</Body> : null}
          </Card>
        ))
      )}
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
              source={{ uri: uriFromBase64(proofView) }}
              style={{ width: "90%", height: "70%", resizeMode: "contain" }}
            />
          )}
        </TouchableOpacity>
      </Modal>
    </>
  );
};

/* ---------- Emergency modal ---------- */
const EmergencyModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}> = ({ visible, onClose, onSaved }) => {
  const { t } = useI18n();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [proof, setProof] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) {
      setReason("");
      setProof(null);
    }
  }, [visible]);

  const pick = async () => {
    const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
    let granted = perm.granted;
    if (!granted && perm.canAskAgain) {
      const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
      granted = req.granted;
    }
    if (!granted) {
      showToast(t("location_permission_denied"), "error");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
      base64: true,
    });
    if (!res.canceled && res.assets && res.assets[0]) {
      const a = res.assets[0];
      const b64 = a.base64 ? `data:image/jpeg;base64,${a.base64}` : a.uri;
      setProof(b64);
    }
  };

  const submit = async () => {
    if (!proof) {
      showToast(t("upload_proof"), "error");
      return;
    }
    if (!reason.trim()) {
      showToast(t("reason"), "error");
      return;
    }
    setSaving(true);
    try {
      await api.post("/emergency", { date, reason, proof_base64: proof });
      showToast(t("saved"), "success");
      onClose();
      onSaved();
    } catch (e: any) {
      showToast(e?.message || t("error"), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalSheet}
        >
          <ScrollView contentContainerStyle={{ gap: spacing.md }}>
            <View style={styles.rowSpace}>
              <H3>{t("request_emergency")}</H3>
              <TouchableOpacity onPress={onClose} testID="close-emergency-modal">
                <Ionicons name="close" size={22} />
              </TouchableOpacity>
            </View>
            <Input
              label={t("leave_date")}
              value={date}
              onChangeText={setDate}
              autoCapitalize="none"
              testID="emergency-date-input"
            />
            <View style={{ gap: 6 }}>
              <Muted style={styles.label}>{t("emergency_reason")}</Muted>
              <TextInput
                value={reason}
                onChangeText={setReason}
                multiline
                numberOfLines={3}
                placeholder={t("emergency_reason")}
                placeholderTextColor={colors.textSecondary}
                style={styles.textarea}
                testID="emergency-reason-input"
              />
            </View>
            <Button
              title={proof ? t("proof_uploaded") : t("pick_image")}
              variant={proof ? "success" : "outline"}
              onPress={pick}
              testID="pick-proof-button"
            />
            {proof && (
              <Image
                source={{ uri: uriFromBase64(proof) }}
                style={{ width: "100%", height: 180, borderRadius: radii.md, resizeMode: "cover" }}
              />
            )}
            <Button
              title={t("submit")}
              size="lg"
              onPress={submit}
              loading={saving}
              testID="submit-emergency-button"
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

/* ---------- Small helpers ---------- */
const Row: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <View style={styles.rowSpace}>
    <Muted>{label}</Muted>
    <Body style={{ color, fontWeight: "700" }}>{value}</Body>
  </View>
);

const StatusPill: React.FC<{ status: string }> = ({ status }) => {
  const { t } = useI18n();
  const bg = statusColor(status);
  const label = statusLabel(status, t);
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Body style={{ color: "#fff", fontWeight: "700", fontSize: 11 }}>{label}</Body>
    </View>
  );
};

function statusColor(s?: string): string {
  if (s === "approved") return colors.success;
  if (s === "rejected") return colors.danger;
  if (s === "pending") return colors.warning;
  return colors.textSecondary;
}
function statusLabel(s: string | undefined, t: (k: string) => string): string {
  if (s === "approved") return t("approved");
  if (s === "rejected") return t("rejected");
  if (s === "pending") return t("pending");
  return "-";
}
function uriFromBase64(v: string): string {
  return v.startsWith("data:") ? v : `data:image/jpeg;base64,${v}`;
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
  addBtn: {
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.md,
  },
  chipsScroll: { flexGrow: 0 },
  chipsRow: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  chip: {
    paddingHorizontal: 14,
    height: 36,
    justifyContent: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexShrink: 0,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  rowSpace: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  progressTrack: {
    height: 8,
    backgroundColor: colors.muted,
    borderRadius: 4,
    overflow: "hidden",
    marginVertical: 8,
  },
  progressBar: { height: "100%" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.5)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    gap: spacing.md,
    maxHeight: "90%",
  },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" },
  textarea: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    minHeight: 80,
    textAlignVertical: "top",
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  proofOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
});
