export const darkTheme = {
  bg: "#08090A", // Obsidian black
  surface: "#111418", // Deep space gray
  primary: "#FFFFFF",
  accent: "#00E5FF", // Futuristic neon cyan
  textPrimary: "#F0F6FC",
  textSecondary: "#90A4AE",
  border: "#1F2937",
  success: "#00C853",
  danger: "#FF1744",
  warning: "#FFEA00",
  info: "#2979FF",
  muted: "#1A1D23",
};

export const lightTheme = {
  bg: "#F0F2F5", // Clean high-end white
  surface: "#FFFFFF",
  primary: "#0F172A",
  accent: "#007BFF", // Deep royal blue
  textPrimary: "#1E293B",
  textSecondary: "#64748B",
  border: "#E2E8F0",
  success: "#10B981",
  danger: "#EF4444",
  warning: "#F59E0B",
  info: "#3B82F6",
  muted: "#F8FAFC",
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
