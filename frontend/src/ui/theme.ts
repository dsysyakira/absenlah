export const colors = {
  bg: "#F8F9FA",
  surface: "#FFFFFF",
  primary: "#0F172A",
  accent: "#0052FF",
  textPrimary: "#0F172A",
  textSecondary: "#64748B",
  border: "#E2E8F0",
  success: "#10B981",
  danger: "#EF4444",
  warning: "#F59E0B",
  info: "#3B82F6",
  muted: "#F1F5F9",
};

export const radii = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const shadow = {
  card: {
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
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
