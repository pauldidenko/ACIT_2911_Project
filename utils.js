// Cloned logic from app.js and catalog.html for unit testing purposes

// From app.js
export function parseSortDir(value) {
  return String(value || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
}

// From app.js
export function calcOffset(page, limit) {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.min(100, Math.max(1, Number(limit) || 10));
  return (p - 1) * l;
}

// From catalog.html
export function formatDate(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString();
}

// From catalog.html
export function toTitleCase(value) {
  if (!value) return "-";
  return value.charAt(0).toUpperCase() + value.slice(1);
}
