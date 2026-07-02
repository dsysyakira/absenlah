import React from "react";
import { View, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useI18n, setLang } from "@/src/i18n";
import { useAuth } from "@/src/auth/AuthContext";
import { Body, Button, Card, H2, H3, Muted } from "@/src/ui/kit";
import { colors, radii, spacing } from "@/src/ui/theme";

export default function ProfileScreen() {
  const { t, lang } = useI18n();
  const { user, logout } = useAuth();
  const router = useRouter();

  const isAdmin = user?.role === "admin";
  const isSupOrAdmin = user?.role === "admin" || user?.role === "supervisor";

  const doLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Body style={{ color: "#fff", fontWeight: "800", fontSize: 24 }}>
              {(user?.name || "?")[0].toUpperCase()}
            </Body>
          </View>
          <H2>{user?.name}</H2>
          <Muted>
            {user?.position} • {user?.division}
          </Muted>
          <View style={styles.roleBadge}>
            <Body style={{ color: "#fff", fontWeight: "700", fontSize: 11 }}>
              {(user?.role || "").toUpperCase()}
            </Body>
          </View>
        </View>

        {/* Language */}
        <Card>
          <H3>{t("language")}</H3>
          <View style={styles.langRow}>
            <TouchableOpacity
              onPress={() => setLang("id")}
              style={[styles.langChip, lang === "id" && styles.langActive]}
              testID="profile-lang-id"
            >
              <Body style={{ color: lang === "id" ? "#fff" : colors.primary, fontWeight: "600" }}>
                {t("indonesian")}
              </Body>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setLang("en")}
              style={[styles.langChip, lang === "en" && styles.langActive]}
              testID="profile-lang-en"
            >
              <Body style={{ color: lang === "en" ? "#fff" : colors.primary, fontWeight: "600" }}>
                {t("english")}
              </Body>
            </TouchableOpacity>
          </View>
        </Card>

        <Card style={{ gap: spacing.sm }}>
          <H3>{t("account")}</H3>
          <MenuItem
            icon="key-outline"
            label={t("change_password")}
            onPress={() => router.push("/change-password")}
            testID="menu-change-password"
          />
          <MenuItem
            icon="document-text-outline"
            label={t("regulations")}
            onPress={() => router.push("/regulations")}
            testID="menu-regulations"
          />
        </Card>

        {isAdmin && (
          <Card style={{ gap: spacing.sm }}>
            <H3>{t("admin_panel")}</H3>
            <MenuItem
              icon="people-outline"
              label={t("manage_users")}
              onPress={() => router.push("/admin/users")}
              testID="menu-manage-users"
            />
            <MenuItem
              icon="business-outline"
              label={t("manage_warehouses")}
              onPress={() => router.push("/admin/warehouses")}
              testID="menu-manage-warehouses"
            />
            <MenuItem
              icon="settings-outline"
              label={t("dynamic_rules")}
              onPress={() => router.push("/admin/rules")}
              testID="menu-dynamic-rules"
            />
            <MenuItem
              icon="reader-outline"
              label={t("regulations") + " (edit)"}
              onPress={() => router.push("/admin/regulations")}
              testID="menu-edit-regulations"
            />
          </Card>
        )}

        {isSupOrAdmin && (
          <Card style={{ gap: spacing.sm }}>
            <H3>{t("supervisor")}</H3>
            <MenuItem
              icon="checkmark-done-outline"
              label={t("manual_attendance")}
              onPress={() => router.push("/supervisor/manual")}
              testID="menu-manual-attendance"
            />
          </Card>
        )}

        <Button
          title={t("logout")}
          variant="danger"
          onPress={doLogout}
          testID="logout-button"
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const MenuItem: React.FC<{
  icon: any;
  label: string;
  onPress: () => void;
  testID?: string;
}> = ({ icon, label, onPress, testID }) => (
  <TouchableOpacity onPress={onPress} style={styles.menu} testID={testID}>
    <Ionicons name={icon} size={20} color={colors.primary} />
    <Body style={{ flex: 1, fontWeight: "600" }}>{label}</Body>
    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  header: { alignItems: "center", gap: 4, marginBottom: spacing.md },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  roleBadge: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  langRow: { flexDirection: "row", gap: spacing.sm, marginTop: 8 },
  langChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flex: 1,
    alignItems: "center",
  },
  langActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  menu: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
