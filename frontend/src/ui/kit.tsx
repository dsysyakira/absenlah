import React from "react";
import {
  Text,
  TextProps,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  TouchableOpacityProps,
  View,
  ViewProps,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { radii, spacing, shadow } from "./theme";
import { useTheme } from "./ThemeContext";

export const H1: React.FC<TextProps> = ({ style, ...p }) => {
  const { colors } = useTheme();
  return <Text {...p} style={[styles.h1, { color: colors.textPrimary }, style]} />;
};
export const H2: React.FC<TextProps> = ({ style, ...p }) => {
  const { colors } = useTheme();
  return <Text {...p} style={[styles.h2, { color: colors.textPrimary }, style]} />;
};
export const H3: React.FC<TextProps> = ({ style, ...p }) => {
  const { colors } = useTheme();
  return <Text {...p} style={[styles.h3, { color: colors.textPrimary }, style]} />;
};
export const Body: React.FC<TextProps> = ({ style, ...p }) => {
  const { colors } = useTheme();
  return <Text {...p} style={[styles.body, { color: colors.textPrimary }, style]} />;
};
export const Muted: React.FC<TextProps> = ({ style, ...p }) => {
  const { colors } = useTheme();
  return <Text {...p} style={[styles.muted, { color: colors.textSecondary }, style]} />;
};
export const Label: React.FC<TextProps> = ({ style, ...p }) => {
  const { colors } = useTheme();
  return <Text {...p} style={[styles.label, { color: colors.textSecondary }, style]} />;
};

export const Card: React.FC<ViewProps> = ({ style, ...p }) => {
  const { colors } = useTheme();
  return <View {...p} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]} />;
};

type BtnProps = TouchableOpacityProps & {
  title: string;
  variant?: "primary" | "outline" | "danger" | "success" | "ghost";
  loading?: boolean;
  size?: "sm" | "md" | "lg";
};

export const Button: React.FC<BtnProps> = ({
  title,
  variant = "primary",
  loading,
  size = "md",
  style,
  disabled,
  ...rest
}) => {
  const { colors } = useTheme();
  const isOutline = variant === "outline";
  const bg =
    variant === "primary"
      ? colors.accent
      : variant === "danger"
        ? colors.danger
        : variant === "success"
          ? colors.success
          : "transparent";
  const border = isOutline ? colors.accent : "transparent";
  const color = isOutline ? colors.accent : "#fff";
  const height = size === "sm" ? 36 : size === "lg" ? 56 : 48;
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      {...rest}
      disabled={disabled || loading}
      style={[
        {
          backgroundColor: bg,
          borderColor: border,
          borderWidth: variant === "outline" ? 1 : 0,
          borderRadius: radii.md,
          height,
          paddingHorizontal: spacing.lg,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled || loading ? 0.6 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <Text style={{ color, fontWeight: "700", fontSize: size === "lg" ? 17 : 15 }}>{title}</Text>
      )}
    </TouchableOpacity>
  );
};

type InputProps = TextInputProps & { label?: string };
export const Input: React.FC<InputProps> = ({ label, style, ...rest }) => {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        placeholderTextColor={colors.textSecondary}
        {...rest}
        style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textPrimary }, style]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  h1: { fontSize: 30, fontWeight: "800", letterSpacing: -0.5 },
  h2: { fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  h3: { fontSize: 17, fontWeight: "700" },
  body: { fontSize: 15, lineHeight: 21 },
  muted: { fontSize: 13 },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.lg,
    // Modern premium feel
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 48,
  },
});
