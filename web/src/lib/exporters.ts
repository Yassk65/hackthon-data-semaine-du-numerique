import type maplibregl from "maplibre-gl";
import type { LegendItem } from "./layers";

export function download(filename: string, href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** CSV au format attendu par un tableur français : séparateur « ; », BOM UTF-8. */
export function toCSV(rows: (string | number | null)[][]): string {
  const esc = (v: string | number | null) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "\uFEFF" + rows.map((r) => r.map(esc).join(";")).join("\r\n");
}

export function downloadCSV(filename: string, rows: (string | number | null)[][]) {
  const blob = new Blob([toCSV(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  download(filename, url);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

interface PngOptions {
  title: string;
  subtitle: string;
  legendTitle: string;
  legend: LegendItem[];
  bivariate?: { colors: string[]; axes: [string, string] };
  source: string;
  labels: { text: string; lngLat: [number, number] }[];
  dark: boolean;
}

/** Image PNG de la carte : canevas MapLibre + titre, étiquettes, légende et sources. */
export function exportMapPng(map: maplibregl.Map, o: PngOptions, filename: string) {
  const src = map.getCanvas();
  const dpr = src.width / src.clientWidth || 1;
  const w = src.width;
  const head = 84 * dpr;
  const foot = (o.bivariate ? 150 : 96) * dpr;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = src.height + head + foot;
  const ctx = out.getContext("2d")!;
  const paper = o.dark ? "#16140F" : "#FBF8F2";
  const ink = o.dark ? "#EEE9DF" : "#1F1C17";
  const muted = o.dark ? "#A39B8D" : "#6F685D";
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, head);
  const serif = `"Source Serif 4", Georgia, serif`;
  const sans = `Inter, "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = ink;
  ctx.font = `600 ${24 * dpr}px ${serif}`;
  ctx.fillText(o.title, 24 * dpr, 38 * dpr);
  ctx.fillStyle = muted;
  ctx.font = `${13 * dpr}px ${sans}`;
  ctx.fillText(o.subtitle, 24 * dpr, 62 * dpr);
  // Étiquettes visibles à l'écran.
  ctx.font = `500 ${11 * dpr}px ${sans}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const l of o.labels) {
    const p = map.project(l.lngLat);
    const x = p.x * dpr;
    const y = p.y * dpr + head;
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = paper;
    ctx.strokeText(l.text, x, y);
    ctx.fillStyle = ink;
    ctx.fillText(l.text, x, y);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let y = src.height + head + 26 * dpr;
  ctx.fillStyle = ink;
  ctx.font = `600 ${12 * dpr}px ${sans}`;
  ctx.fillText(o.legendTitle, 24 * dpr, y);
  y += 12 * dpr;
  ctx.font = `${11 * dpr}px ${sans}`;
  if (o.bivariate) {
    const s = 22 * dpr;
    o.bivariate.colors.forEach((c, i) => {
      const r = Math.floor(i / 3);
      const k = i % 3;
      ctx.fillStyle = c;
      ctx.fillRect(24 * dpr + k * s, y + (2 - r) * s, s - 2, s - 2);
    });
    ctx.fillStyle = muted;
    ctx.fillText(`→ ${o.bivariate.axes[1]}`, 24 * dpr, y + 3 * s + 14 * dpr);
    ctx.fillText(`↑ ${o.bivariate.axes[0]}`, 24 * dpr + 3 * s + 10 * dpr, y + 12 * dpr);
  } else {
    let x = 24 * dpr;
    for (const it of o.legend) {
      ctx.fillStyle = it.color;
      ctx.fillRect(x, y, 16 * dpr, 12 * dpr);
      ctx.fillStyle = ink;
      ctx.fillText(it.label, x + 22 * dpr, y + 10 * dpr);
      x += (30 + ctx.measureText(it.label).width / dpr) * dpr;
    }
  }
  ctx.fillStyle = muted;
  ctx.font = `${10 * dpr}px ${sans}`;
  ctx.fillText(o.source, 24 * dpr, out.height - 16 * dpr);
  download(filename, out.toDataURL("image/png"));
}
