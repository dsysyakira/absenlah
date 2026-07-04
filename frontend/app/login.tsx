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
import { spacing, colors as staticColors } from "@/src/ui/theme";
import { useTheme } from "@/src/ui/ThemeContext";
import { showToast } from "@/src/ui/Toast";

export default function LoginScreen() {
  const { t, lang } = useI18n();
  const { colors } = useTheme();
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
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <View
              style={[
                styles.logo,
                {
                  backgroundColor: colors.accent,
                  shadowColor: colors.accent,
                },
              ]}
              testID="app-logo"
            >
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
            <View style={{ flexDirection: "row", alignItems: "center", marginVertical: 8 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
              <Muted style={{ marginHorizontal: 10 }}>OR</Muted>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
            </View>
            <Button
              title="Sign in with Google"
              variant="outline"
              onPress={() => showToast("Google Login Coming Soon", "info")}
              testID="google-login-button"
            />
            <Muted style={{ textAlign: "center", marginTop: 4 }}>
              {t("default_admin_hint")}
            </Muted>
          </Card>

          <View style={styles.langRow}>
            <TouchableOpacity
              onPress={() => setLang("id")}
              testID="lang-id-button"
              style={[
                styles.langChip,
                { backgroundColor: colors.surface, borderColor: colors.border },
                lang === "id" && { backgroundColor: colors.primary, borderColor: colors.primary },
              ]}
            >
              <Body style={{ fontWeight: "600", color: lang === "id" ? "#fff" : colors.primary }}>
                ID
              </Body>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setLang("en")}
              testID="lang-en-button"
              style={[
                styles.langChip,
                { backgroundColor: colors.surface, borderColor: colors.border },
                lang === "en" && { backgroundColor: colors.primary, borderColor: colors.primary },
              ]}
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
  safe: { flex: 1 },
  scroll: { padding: spacing.lg, gap: spacing.xl, flexGrow: 1, justifyContent: "center" },
  header: { alignItems: "center", marginBottom: spacing.xl },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 12,
  },
  langRow: { flexDirection: "row", gap: spacing.md, justifyContent: "center" },
  langChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
});
