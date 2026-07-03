export const colors = {
  bg: "#0A0C10", // Deep dark background
  surface: "#161B22", // Premium card surface
  primary: "#FFFFFF",
  accent: "#2F81F7", // GitHub-like premium blue
  textPrimary: "#F0F6FC",
  textSecondary: "#8B949E",
  border: "#30363D",
  success: "#3FB950",
  danger: "#F85149",
  warning: "#D29922",
  info: "#388BFD",
  muted: "#21262D",
};

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
