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

export default function ManualAttendance() {
  const { t } = useI18n();
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [checkInIso, setCheckInIso] = useState(new Date().toISOString().slice(0, 16));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const u = await api.get<any[]>("/users");
      setUsers(u.filter((x: any) => x.role !== "admin"));
    } catch (e: any) {
      showToast(e?.message || "Load failed", "error");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!selected) {
      showToast("Pilih user", "error");
      return;
    }
    if (!reason.trim()) {
      showToast(t("reason"), "error");
      return;
    }
    // convert local YYYY-MM-DDTHH:MM to ISO
    const iso = new Date(checkInIso).toISOString();
    setSaving(true);
    try {
      await api.post("/attendance/manual", {
        user_id: selected.id,
        check_in_iso: iso,
        reason,
      });
      showToast(t("saved"), "success");
      setReason("");
      setSelected(null);
    } catch (e: any) {
      showToast(e?.message || t("error"), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="back-button">
          <Ionicons name="arrow-back" size={22} color={colors.primary} />
        </TouchableOpacity>
        <H2>{t("manual_attendance")}</H2>
        <View style={{ width: 22 }} />
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Card style={{ gap: spacing.md }}>
            <H3>{t("user")}</H3>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              {users.map((u) => (
                <TouchableOpacity
                  key={u.id}
                  onPress={() => setSelected(u)}
                  style={[styles.chip, selected?.id === u.id && styles.chipActive]}
                  testID={`user-chip-${u.id}`}
                >
                  <Body
                    style={{
                      color: selected?.id === u.id ? "#fff" : colors.primary,
                      fontWeight: "600",
                      fontSize: 12,
                    }}
                  >
                    {u.name}
                  </Body>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {selected && (
              <Muted>
                {selected.position} • {selected.division}
              </Muted>
            )}
            <Input
              label="Check-in datetime (YYYY-MM-DDTHH:MM)"
              value={checkInIso}
              onChangeText={setCheckInIso}
              testID="manual-datetime"
            />
            <Input
              label={t("reason")}
              value={reason}
              onChangeText={setReason}
              testID="manual-reason"
            />
            <Button
              title={t("approve_manual")}
              size="lg"
              onPress={submit}
              loading={saving}
              testID="submit-manual-button"
            />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
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
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  chipsRow: { gap: 8, paddingRight: 8 },
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
});
