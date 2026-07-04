import React, { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { WebView } from "react-native-webview";
import { useI18n } from "@/src/i18n";
import { api } from "@/src/api/client";
import { Body, Button, Card, H2, H3, Muted } from "@/src/ui/kit";
import { colors, radii, spacing } from "@/src/ui/theme";
import { showToast } from "@/src/ui/Toast";

export default function CourierMonitoringScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const [couriers, setCouriers] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<any[]>("/monitoring/couriers");
      setCouriers(res);
    } catch (e: any) {
      showToast(e.message, "error");
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const mapHtml = `
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
          var map = L.map('map', { zoomControl: false }).setView([-6.2088, 106.8456], 12);
          L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            subdomains: 'abcd',
            maxZoom: 20
          }).addTo(map);

          var markers = {};

          function updateMarkers(data) {
            data.forEach(c => {
              if (!c.last_lat) return;
              var pos = [c.last_lat, c.last_lng];
              if (markers[c.id]) {
                markers[c.id].setLatLng(pos);
              } else {
                var color = c.is_available ? "#3FB950" : "#F85149";
                var icon = L.divIcon({
                  html: '<div style="background-color:'+color+';width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 0 10px rgba(0,0,0,0.5);"></div>',
                  className: 'custom-div-icon',
                  iconSize: [12, 12],
                  iconAnchor: [6, 6]
                });
                markers[c.id] = L.marker(pos, { icon: icon }).addTo(map).bindPopup('<b>'+c.name+'</b>');
              }
            });
          }

          var couriers = ${JSON.stringify(couriers)};
          updateMarkers(couriers);
        </script>
      </body>
    </html>
  `;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Stack.Screen options={{ title: "Monitoring", headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="back-button">
          <Ionicons name="arrow-back" size={22} color={colors.primary} />
        </TouchableOpacity>
        <H2>Monitoring Kurir</H2>
        <View style={{ width: 22 }} />
      </View>

      <Card style={styles.mapCard}>
        <WebView originWhitelist={["*"]} source={{ html: mapHtml }} style={{ flex: 1 }} />
      </Card>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <H3>Daftar Kurir</H3>
        {couriers.map((c) => (
          <Card key={c.id} style={styles.courierCard}>
            <View style={{ flex: 1 }}>
              <H3>{c.name}</H3>
              <Muted>{c.is_available ? "✅ Tersedia" : "🚚 Sedang Tugas"}</Muted>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
                <Button
                    title={c.is_available ? "Set Off" : "Set On"}
                    variant="outline"
                    size="sm"
                    onPress={async () => {
                        await api.post(`/monitoring/couriers/${c.id}/status`, { is_available: !c.is_available });
                        load();
                    }}
                />
                <TouchableOpacity onPress={() => load()}>
                    <Ionicons name="refresh-circle" size={32} color={colors.accent} />
                </TouchableOpacity>
            </View>
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, paddingBottom: spacing.sm },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  mapCard: { height: 300, padding: 0, margin: spacing.lg, overflow: "hidden" },
  courierCard: { flexDirection: "row", alignItems: "center", gap: spacing.md },
});
