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
import { colors, radii, spacing, shadow } from "./theme";

export const H1: React.FC<TextProps> = ({ style, ...p }) => (
  <Text {...p} style={[styles.h1, style]} />
);
export const H2: React.FC<TextProps> = ({ style, ...p }) => (
  <Text {...p} style={[styles.h2, style]} />
);
export const H3: React.FC<TextProps> = ({ style, ...p }) => (
  <Text {...p} style={[styles.h3, style]} />
);
export const Body: React.FC<TextProps> = ({ style, ...p }) => (
  <Text {...p} style={[styles.body, style]} />
);
export const Muted: React.FC<TextProps> = ({ style, ...p }) => (
  <Text {...p} style={[styles.muted, style]} />
);
export const Label: React.FC<TextProps> = ({ style, ...p }) => (
  <Text {...p} style={[styles.label, style]} />
);

export const Card: React.FC<ViewProps> = ({ style, ...p }) => (
  <View {...p} style={[styles.card, style]} />
);

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
  const bg =
    variant === "primary"
      ? colors.accent
      : variant === "danger"
        ? colors.danger
        : variant === "success"
          ? colors.success
          : "transparent";
  const border = variant === "outline" ? colors.border : "transparent";
  const color = "#fff";
  const height = size === "sm" ? 40 : size === "lg" ? 56 : 48;
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
export const Input: React.FC<InputProps> = ({ label, style, ...rest }) => (
  <View style={{ gap: 6 }}>
    {label ? <Label>{label}</Label> : null}
    <TextInput
      placeholderTextColor={colors.textSecondary}
      {...rest}
      style={[styles.input, style]}
    />
  </View>
);

const styles = StyleSheet.create({
  h1: { fontSize: 30, fontWeight: "800", color: colors.textPrimary, letterSpacing: -0.5 },
  h2: { fontSize: 22, fontWeight: "700", color: colors.textPrimary, letterSpacing: -0.3 },
  h3: { fontSize: 17, fontWeight: "700", color: colors.textPrimary },
  body: { fontSize: 15, color: colors.textPrimary, lineHeight: 21 },
  muted: { fontSize: 13, color: colors.textSecondary },
  label: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    // Deeper premium feel
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    minHeight: 48,
  },
});
