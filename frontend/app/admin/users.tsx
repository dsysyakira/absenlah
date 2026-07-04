import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { useI18n } from "@/src/i18n";
import { api } from "@/src/api/client";
import { Body, Button, Card, H2, H3, Input, Muted } from "@/src/ui/kit";
import { radii, spacing } from "@/src/ui/theme";
import { useTheme } from "@/src/ui/ThemeContext";
import { showToast } from "@/src/ui/Toast";

export default function UsersAdmin() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [u, w] = await Promise.all([
        api.get<any[]>("/users"),
        api.get<any[]>("/warehouses"),
      ]);
      setUsers(u);
      setWarehouses(w);
    } catch (e: any) {
      showToast(e?.message || "Load failed", "error");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const openAdd = () => {
    setEditing(null);
    setForm({ role: "user" });
    setModal(true);
  };
  const openEdit = (u: any) => {
    setEditing(u);
    setForm({ ...u });
    setModal(true);
  };

  const submit = async () => {
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/users/${editing.id}`, {
          name: form.name,
          role: form.role,
          position: form.position,
          division: form.division,
          warehouse_id: form.warehouse_id,
          active: form.active,
        });
      } else {
        if (!form.username || !form.password || !form.name) {
          showToast("Isi username, name & password", "error");
          setSaving(false);
          return;
        }
        await api.post("/users", form);
      }
      showToast(t("saved"), "success");
      setModal(false);
      await load();
    } catch (e: any) {
      showToast(e?.message || t("error"), "error");
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async (id: string) => {
    try {
      await api.del(`/users/${id}`);
      await load();
      showToast(t("saved"), "success");
    } catch (e: any) {
      showToast(e?.message || t("error"), "error");
    }
  };

  const doReset = async (id: string) => {
    try {
      const r = await api.post<any>(`/users/${id}/reset-password`);
      showToast(`Temp password: ${r.temporary_password}`, "success");
    } catch (e: any) {
      showToast(e?.message || t("error"), "error");
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="back-button">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <H2>{t("manage_users")}</H2>
        <TouchableOpacity
          onPress={openAdd}
          testID="add-user-button"
          style={[styles.addBtn, { backgroundColor: colors.primary }]}
        >
          <Ionicons name="add" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {users.map((u) => (
          <Card key={u.id} style={{ gap: 6 }} testID={`user-item-${u.id}`}>
            <View style={styles.row}>
              <View>
                <H3>{u.name}</H3>
                <Muted>
                  @{u.username} • {u.position} • {u.division}
                </Muted>
              </View>
              <View style={[styles.roleBadge, { backgroundColor: roleColor(u.role, colors) }]}>
                <Body style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>
                  {u.role.toUpperCase()}
                </Body>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
              <Button
                title={t("edit")}
                variant="outline"
                size="sm"
                onPress={() => openEdit(u)}
                style={{ flex: 1 }}
                testID={`edit-user-${u.id}`}
              />
              <Button
                title={t("reset_password")}
                variant="outline"
                size="sm"
                onPress={() => doReset(u.id)}
                style={{ flex: 1 }}
                testID={`reset-user-${u.id}`}
              />
              <Button
                title={t("delete")}
                variant="danger"
                size="sm"
                onPress={() => doDelete(u.id)}
                style={{ flex: 1 }}
                testID={`delete-user-${u.id}`}
              />
            </View>
          </Card>
        ))}
      </ScrollView>

      <Modal visible={modal} transparent animationType="slide" onRequestClose={() => setModal(false)}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={[styles.sheet, { backgroundColor: colors.surface }]}
          >
            <ScrollView contentContainerStyle={{ gap: spacing.md }}>
              <View style={styles.row}>
                <H3>{editing ? t("edit") : t("add_user")}</H3>
                <TouchableOpacity onPress={() => setModal(false)}>
                  <Ionicons name="close" size={22} />
                </TouchableOpacity>
              </View>
              {!editing && (
                <>
                  <Input
                    label={t("username")}
                    value={form.username || ""}
                    onChangeText={(v) => setForm({ ...form, username: v })}
                    autoCapitalize="none"
                    testID="user-form-username"
                  />
                  <Input
                    label={t("password")}
                    value={form.password || ""}
                    onChangeText={(v) => setForm({ ...form, password: v })}
                    testID="user-form-password"
                  />
                </>
              )}
              <Input
                label={t("name")}
                value={form.name || ""}
                onChangeText={(v) => setForm({ ...form, name: v })}
                testID="user-form-name"
              />
              <Input
                label={t("position")}
                value={form.position || ""}
                onChangeText={(v) => setForm({ ...form, position: v })}
                testID="user-form-position"
              />
              <Input
                label={t("division")}
                value={form.division || ""}
                onChangeText={(v) => setForm({ ...form, division: v })}
                testID="user-form-division"
              />
              <Muted style={styles.label}>{t("role")}</Muted>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {(["user", "supervisor", "admin"] as const).map((r) => (
                  <TouchableOpacity
                    key={r}
                    onPress={() => setForm({ ...form, role: r })}
                    style={[
                      styles.chip,
                      { borderColor: colors.border },
                      form.role === r && {
                        backgroundColor: colors.primary,
                        borderColor: colors.primary,
                      },
                    ]}
                    testID={`role-chip-${r}`}
                  >
                    <Body
                      style={{
                        color: form.role === r ? "#fff" : colors.primary,
                        fontWeight: "600",
                        fontSize: 12,
                      }}
                    >
                      {r.toUpperCase()}
                    </Body>
                  </TouchableOpacity>
                ))}
              </View>
              <Muted style={styles.label}>{t("warehouse")}</Muted>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {warehouses.map((w) => (
                  <TouchableOpacity
                    key={w.id}
                    onPress={() => setForm({ ...form, warehouse_id: w.id })}
                    style={[
                      styles.chip,
                      { borderColor: colors.border },
                      form.warehouse_id === w.id && {
                        backgroundColor: colors.primary,
                        borderColor: colors.primary,
                      },
                    ]}
                    testID={`warehouse-chip-${w.id}`}
                  >
                    <Body
                      style={{
                        color: form.warehouse_id === w.id ? "#fff" : colors.primary,
                        fontSize: 12,
                        fontWeight: "600",
                      }}
                    >
                      {w.name}
                    </Body>
                  </TouchableOpacity>
                ))}
              </View>
              <Button
                title={t("save")}
                size="lg"
                onPress={submit}
                loading={saving}
                testID="save-user-button"
              />
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function roleColor(role: string, themeColors: any): string {
  if (role === "admin") return themeColors.danger;
  if (role === "supervisor") return themeColors.warning;
  return themeColors.info;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  roleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  overlay: { flex: 1, backgroundColor: "rgba(15,23,42,0.5)", justifyContent: "flex-end" },
  sheet: {
    padding: spacing.lg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    maxHeight: "85%",
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" },
});
