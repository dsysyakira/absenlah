import React, { useState } from "react";
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth/AuthContext";
import { useI18n, setLang } from "@/src/i18n";
import { Button, Card, H1, H3, Input, Muted, Body } from "@/src/ui/kit";
import { colors, spacing } from "@/src/ui/theme";
import { showToast } from "@/src/ui/Toast";

export default function LoginScreen() {
  const { t, lang } = useI18n();
  const { login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!username || !password) {
      showToast(t("login_failed"), "error");
      return;
    }
    setLoading(true);
    try {
      const res = await login(username.trim(), password);
      if (res.must_change_password) {
        router.replace("/change-password");
      } else {
        router.replace("/(tabs)");
      }
    } catch (e: any) {
      showToast(e?.message || t("login_failed"), "error");
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
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <View style={styles.logo} testID="app-logo">
              <Body style={{ color: "#fff", fontWeight: "800", fontSize: 20 }}>A</Body>
            </View>
            <H1 style={{ marginTop: spacing.lg }}>Absenlah</H1>
            <Muted style={{ marginTop: 4 }}>
              {lang === "id"
                ? "Sistem Absensi Enterprise"
                : "Enterprise Attendance System"}
            </Muted>
          </View>

          <Card style={{ gap: spacing.md }}>
            <H3>{t("login")}</H3>
            <Input
              label={t("username")}
              placeholder="administrator"
              autoCapitalize="none"
              value={username}
              onChangeText={setUsername}
              testID="login-username-input"
            />
            <Input
              label={t("password")}
              placeholder="********"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              testID="login-password-input"
            />
            <Button
              title={t("login")}
              onPress={submit}
              loading={loading}
              size="lg"
              testID="login-submit-button"
            />
            <Muted style={{ textAlign: "center", marginTop: 4 }}>
              {t("default_admin_hint")}
            </Muted>
          </Card>

          <View style={styles.langRow}>
            <TouchableOpacity
              onPress={() => setLang("id")}
              testID="lang-id-button"
              style={[styles.langChip, lang === "id" && styles.langActive]}
            >
              <Body style={{ fontWeight: "600", color: lang === "id" ? "#fff" : colors.primary }}>
                ID
              </Body>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setLang("en")}
              testID="lang-en-button"
              style={[styles.langChip, lang === "en" && styles.langActive]}
            >
              <Body style={{ fontWeight: "600", color: lang === "en" ? "#fff" : colors.primary }}>
                EN
              </Body>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.xl, flexGrow: 1, justifyContent: "center" },
  header: { alignItems: "center", marginBottom: spacing.xl },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  langRow: { flexDirection: "row", gap: spacing.md, justifyContent: "center" },
  langChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  langActive: { backgroundColor: colors.primary, borderColor: colors.primary },
});
