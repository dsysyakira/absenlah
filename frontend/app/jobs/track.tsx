import React, { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { WebView } from "react-native-webview";
import { useI18n } from "@/src/i18n";
import { api } from "@/src/api/client";
import { Body, Button, Card, H2, H3, Muted } from "@/src/ui/kit";
import { colors, radii, spacing } from "@/src/ui/theme";
import { showToast } from "@/src/ui/Toast";

export default function JobTrackingScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const [jobs, setJobs] = useState<any[]>([]);
  const [coords, setCoords] = useState<any>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<any[]>("/jobs/me");
      setJobs(res);
      const pos = await Location.getCurrentPositionAsync({});
      setCoords(pos.coords);
    } catch (e: any) {
      showToast(e.message, "error");
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(async () => {
        const pos = await Location.getCurrentPositionAsync({});
        api.post("/users/me/location", { latitude: pos.coords.latitude, longitude: pos.coords.longitude }).catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, [load]);

  const updateStatus = async (id: string, status: "started" | "completed") => {
    const res = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.5 });
    if (res.canceled || !res.assets[0].base64) return;

    setBusyId(id);
    try {
      await api.put(`/jobs/${id}`, {
        status,
        proof_base64: res.assets[0].base64,
        latitude: coords?.latitude || 0,
        longitude: coords?.longitude || 0,
      });
      showToast(t("saved"), "success");
      await load();
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setBusyId(null);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Stack.Screen options={{ title: "Job Tracking", headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="back-button">
          <Ionicons name="arrow-back" size={22} color={colors.primary} />
        </TouchableOpacity>
        <H2>Job Tracking</H2>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {coords && (
          <Card style={styles.mapCard}>
            <WebView
              originWhitelist={["*"]}
              source={{
                html: `
                <html>
                  <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
                    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
                    <style>body { margin: 0; } #map { height: 100vh; }</style>
                  </head>
                  <body>
                    <div id="map"></div>
                    <script>
                      var map = L.map('map').setView([${coords.latitude}, ${coords.longitude}], 15);
                      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
                      L.marker([${coords.latitude}, ${coords.longitude}]).addTo(map);
                    </script>
                  </body>
                </html>
              `,
              }}
              style={{ flex: 1 }}
            />
          </Card>
        )}

        <H3 style={{ marginTop: spacing.md }}>Tugas Pengiriman</H3>
        {jobs.map((job) => (
          <Card key={job.id} style={{ gap: 8 }}>
            <View style={styles.rowSpace}>
              <H3>{job.title}</H3>
              <Badge status={job.status} />
            </View>
            <Body>{job.description}</Body>
            {job.status === "pending" && (
              <Button title="Mulai Kirim (Bukti Foto)" onPress={() => updateStatus(job.id, "started")} loading={busyId === job.id} />
            )}
            {job.status === "started" && (
              <Button title="Selesaikan (Bukti Foto)" variant="success" onPress={() => updateStatus(job.id, "completed")} loading={busyId === job.id} />
            )}
          </Card>
        ))}
        {jobs.length === 0 && <Muted>Tidak ada tugas aktif</Muted>}
      </ScrollView>
    </SafeAreaView>
  );
}

const Badge = ({ status }: any) => {
    const color = status === "completed" ? colors.success : status === "started" ? colors.warning : colors.textSecondary;
    return (
        <View style={[styles.badge, { backgroundColor: color + "20", borderColor: color }]}>
            <Body style={{ fontSize: 10, fontWeight: "800", color }}>{status.toUpperCase()}</Body>
        </View>
    );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, paddingBottom: spacing.sm },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  mapCard: { height: 180, padding: 0, overflow: "hidden" },
  rowSpace: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
});
