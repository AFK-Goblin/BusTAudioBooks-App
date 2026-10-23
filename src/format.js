export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export function formatTime(sec) {
  if (!sec || sec < 0 || !isFinite(sec)) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Compact durations for "time left" labels: "4h 12m", "12m", "45s".
export function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return "0m";
  if (sec < 60) return `${Math.round(sec)}s`;
  const minutes = Math.round(sec / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

// Speeds as people say them: 1×, 1.25×, 1.1× (never 1.2500000001×).
export function formatSpeed(rate) {
  return `${Number((Math.round((rate || 1) * 100) / 100).toFixed(2))}×`;
}

// What someone types to jump to a time: "1:23:45", "23:45", or a plain number
// of minutes ("90"). Seconds, or null if it isn't a time.
export function parseTime(text) {
  const value = String(text || "").trim();
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 60);
  if (!/^\d+(:\d{1,2}){1,2}$/.test(value)) return null;
  const parts = value.split(":").map(Number);
  if (parts.slice(1).some((n) => n >= 60)) return null;
  return parts.reduce((total, n) => total * 60 + n, 0);
}
