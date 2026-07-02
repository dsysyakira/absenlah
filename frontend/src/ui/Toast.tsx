import React, { useEffect } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { colors, radii, spacing } from "./theme";

type ToastState = { message: string; kind: "success" | "error" | "info" } | null;

let setToast: ((v: ToastState) => void) | null = null;

export function showToast(message: string, kind: "success" | "error" | "info" = "info") {
  if (setToast) setToast({ message, kind });
}

export const ToastHost: React.FC = () => {
  const [state, set] = React.useState<ToastState>(null);
  const opacity = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setToast = set;
    return () => {
      setToast = null;
    };
  }, []);

  useEffect(() => {
    if (state) {
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      const t = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
          set(null);
        });
      }, 2400);
      return () => clearTimeout(t);
    }
  }, [state, opacity]);

  if (!state) return null;
  const bg =
    state.kind === "success"
      ? colors.success
      : state.kind === "error"
        ? colors.danger
        : colors.primary;
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, { opacity, backgroundColor: bg }]}
      testID="toast-host"
    >
      <Text style={styles.text} testID="toast-message">
        {state.message}
      </Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 50,
    left: spacing.lg,
    right: spacing.lg,
    padding: spacing.md,
    borderRadius: radii.md,
    zIndex: 9999,
  },
  text: { color: "#fff", fontWeight: "600", textAlign: "center" },
});

export default ToastHost;
