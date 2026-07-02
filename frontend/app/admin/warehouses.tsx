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
import { colors, radii, spacing } from "@/src/ui/theme";
import { showToast } from "@/src/ui/Toast";

export default function WarehousesAdmin() {
  const { t } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const w = await api.get<any[]>("/warehouses");
      setItems(w);
    } catch (e: any) {
      showToast(e?.message || "Load failed", "error");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const openAdd = () => {
    setEditing(null);
    setForm({ radius_m: 100 });
    setModal(true);
  };
  const openEdit = (w: any) => {
    setEditing(w);
    setForm({ ...w });
    setModal(true);
  };

  const submit = async () => {
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        address: form.address || "",
        latitude: parseFloat(String(form.latitude)),
        longitude: parseFloat(String(form.longitude)),
        radius_m: parseInt(String(form.radius_m || 100), 10),
      };
      if (isNaN(payload.latitude) || isNaN(payload.longitude)) {
        showToast("Latitude/longitude invalid", "error");
        setSaving(false);
        return;
      }
      if (editing) await api.put(`/warehouses/${editing.id}`, payload);
      else await api.post("/warehouses", payload);
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
      await api.del(`/warehouses/${id}`);
      await load();
    } catch (e: any) {
      showToast(e?.message || t("error"), "error");
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="back-button">
          <Ionicons name="arrow-back" size={22} color={colors.primary} />
        </TouchableOpacity>
        <H2>{t("manage_warehouses")}</H2>
        <TouchableOpacity onPress={openAdd} testID="add-warehouse-button" style={styles.addBtn}>
          <Ionicons name="add" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {items.map((w) => (
          <Card key={w.id} style={{ gap: 6 }} testID={`warehouse-item-${w.id}`}>
            <H3>{w.name}</H3>
            <Muted>{w.address}</Muted>
            <Muted>
              {t("latitude")}: {w.latitude} • {t("longitude")}: {w.longitude}
            </Muted>
            <Muted>
              {t("radius_meters")}: {w.radius_m}
            </Muted>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
              <Button
                title={t("edit")}
                variant="outline"
                size="sm"
                onPress={() => openEdit(w)}
                style={{ flex: 1 }}
                testID={`edit-warehouse-${w.id}`}
              />
              <Button
                title={t("delete")}
                variant="danger"
                size="sm"
                onPress={() => doDelete(w.id)}
                style={{ flex: 1 }}
                testID={`delete-warehouse-${w.id}`}
              />
            </View>
          </Card>
        ))}
      </ScrollView>

      <Modal
        visible={modal}
        transparent
        animationType="slide"
        onRequestClose={() => setModal(false)}
      >
        <View style={styles.overlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.sheet}
          >
            <ScrollView contentContainerStyle={{ gap: spacing.md }}>
              <View style={styles.row}>
                <H3>{editing ? t("edit") : t("add_warehouse")}</H3>
                <TouchableOpacity onPress={() => setModal(false)}>
                  <Ionicons name="close" size={22} />
                </TouchableOpacity>
              </View>
              <Input
                label={t("name")}
                value={form.name || ""}
                onChangeText={(v) => setForm({ ...form, name: v })}
                testID="warehouse-form-name"
              />
              <Input
                label={t("address")}
                value={form.address || ""}
                onChangeText={(v) => setForm({ ...form, address: v })}
                testID="warehouse-form-address"
              />
              <Input
                label={t("latitude")}
                value={String(form.latitude ?? "")}
                onChangeText={(v) => setForm({ ...form, latitude: v })}
                keyboardType="numeric"
                testID="warehouse-form-lat"
              />
              <Input
                label={t("longitude")}
                value={String(form.longitude ?? "")}
                onChangeText={(v) => setForm({ ...form, longitude: v })}
                keyboardType="numeric"
                testID="warehouse-form-lng"
              />
              <Input
                label={t("radius_meters")}
                value={String(form.radius_m ?? "")}
                onChangeText={(v) => setForm({ ...form, radius_m: v })}
                keyboardType="numeric"
                testID="warehouse-form-radius"
              />
              <Button
                title={t("save")}
                size="lg"
                onPress={submit}
                loading={saving}
                testID="save-warehouse-button"
              />
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
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
  addBtn: {
    backgroundColor: colors.primary,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  overlay: { flex: 1, backgroundColor: "rgba(15,23,42,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    maxHeight: "85%",
  },
});
