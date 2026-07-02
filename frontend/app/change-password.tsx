import React, { useState } from "react";
import { View, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth/AuthContext";
import { useI18n } from "@/src/i18n";
import { Button, Card, H2, Input, Muted } from "@/src/ui/kit";
import { colors, spacing } from "@/src/ui/theme";
import { showToast } from "@/src/ui/Toast";

export default function ChangePasswordScreen() {
  const { t } = useI18n();
  const { user, changePassword, logout } = useAuth();
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (next.length < 6) {
      showToast(t("passwords_mismatch"), "error");
      return;
    }
    if (next !== confirm) {
      showToast(t("passwords_mismatch"), "error");
      return;
    }
    setLoading(true);
    try {
      await changePassword(current, next);
      showToast(t("saved"), "success");
      router.replace("/(tabs)");
    } catch (e: any) {
      showToast(e?.message || t("error"), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <H2>{t("change_password")}</H2>
          {user?.must_change_password ? (
            <Muted style={{ color: colors.warning }}>{t("force_change_notice")}</Muted>
          ) : null}
          <Card style={{ gap: spacing.md }}>
            <Input
              label={t("current_password")}
              secureTextEntry
              value={current}
              onChangeText={setCurrent}
              testID="current-password-input"
            />
            <Input
              label={t("new_password")}
              secureTextEntry
              value={next}
              onChangeText={setNext}
              testID="new-password-input"
            />
            <Input
              label={t("confirm_password")}
              secureTextEntry
              value={confirm}
              onChangeText={setConfirm}
              testID="confirm-password-input"
            />
            <Button
              title={t("save")}
              onPress={submit}
              loading={loading}
              size="lg"
              testID="change-password-submit-button"
            />
            <Button
              title={t("logout")}
              variant="ghost"
              onPress={async () => {
                await logout();
                router.replace("/login");
              }}
              testID="change-password-logout-button"
            />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.lg, flexGrow: 1, justifyContent: "center" },
});
