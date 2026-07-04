export const darkTheme = {
  bg: "#040506", // Absolute Obsidian
  surface: "#12141D", // Cyber surface
  primary: "#FFFFFF",
  accent: "#00F5FF", // Cyber Neon Cyan
  textPrimary: "#E0E6ED",
  textSecondary: "#94A3B8",
  border: "#1E293B",
  success: "#10B981",
  danger: "#EF4444",
  warning: "#F59E0B",
  info: "#3B82F6",
  muted: "#0F172A",
  glass: "rgba(30, 41, 59, 0.5)",
};

export const lightTheme = {
  bg: "#F8FAFC", // Clean Pearl
  surface: "#FFFFFF",
  primary: "#0F172A",
  accent: "#2563EB", // Royal Blue
  textPrimary: "#1E293B",
  textSecondary: "#64748B",
  border: "#E2E8F0",
  success: "#059669",
  danger: "#DC2626",
  warning: "#D97706",
  info: "#2563EB",
  muted: "#F1F5F9",
  glass: "rgba(255, 255, 255, 0.7)",
};

export let colors = darkTheme; // Default

export const radii = { sm: 8, md: 14, lg: 20, xl: 28, pill: 999 };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const shadow = {
  card: {
    shadowColor: "#000000",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
};

export function formatRupiah(n: number): string {
  const abs = Math.abs(Math.round(n || 0));
  const s = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (n < 0 ? "-Rp" : "Rp") + s;
}

export function formatDate(iso: string, lang: "id" | "en" = "id"): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const opts: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
  };
  return d.toLocaleDateString(lang === "id" ? "id-ID" : "en-US", opts);
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}
