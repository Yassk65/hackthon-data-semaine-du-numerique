import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { loadSchools } from "../data/load";
import type { GeoBundle, GeoCollection, Scale } from "../data/types";
import { t } from "../i18n";
import type { UnitCell } from "../lib/layers";

type Theme = "light" | "dark";

const THEME = {
  light: { paper: "#FBF8F2", empty: "#F1ECE2", ink: "#1F1C17", provLine: "#FFFFFF", muted: "#8A8274", accent: "#B4462C" },
  dark: { paper: "#16140F", empty: "#24211B", ink: "#EEE9DF", provLine: "#16140F", muted: "#8F877A", accent: "#E9835D" },
};

export interface MapHandle {
  map: maplibregl.Map;
  labels: () => { text: string; lngLat: [number, number] }[];
}

interface Props {
  geo: GeoBundle;
  scale: Scale;
  cells: Record<string, UnitCell>;
  names: Record<string, string>;
  priority: Record<string, number>;
  selected: string | null;
  compare: string | null;
  highlight: string | null;
  focus: { code: string; n: number } | null;
  showOsm: boolean;
  theme: Theme;
  ariaLabel: string;
  onHover: (code: string | null, x: number, y: number, extra?: string) => void;
  onSelect: (code: string | null) => void;
  onReady?: (h: MapHandle) => void;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function patternImage(kind: "hatch" | "dots", color: string): { width: number; height: number; data: Uint8Array } {
  const size = 12;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  if (kind === "hatch") {
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-2, size + 2);
    ctx.lineTo(size + 2, -2);
    ctx.moveTo(size - 2, size + 2);
    ctx.lineTo(size + 2, size - 2);
    ctx.moveTo(-2, 2);
    ctx.lineTo(2, -2);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(3, 3, 1.1, 0, Math.PI * 2);
    ctx.arc(9, 9, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  const img = ctx.getImageData(0, 0, size, size);
  return { width: size, height: size, data: new Uint8Array(img.data.buffer) };
}

function bbox(fc: GeoCollection, code: string): [number, number, number, number] | null {
  const f = fc.features.find((x) => x.properties.code === code);
  if (!f) return null;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as number[];
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    } else if (Array.isArray(c)) c.forEach(walk);
  };
  walk((f.geometry as { coordinates: unknown }).coordinates);
  return [x0, y0, x1, y1];
}

function isDark(hex: string | null): boolean {
  if (!hex) return false;
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.18;
}

export default function MapView(props: Props) {
  const { geo, scale, cells, names, selected, compare, highlight, focus, showOsm, theme, ariaLabel } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const labelEls = useRef<{ prov: Map<string, HTMLDivElement>; reg: Map<string, HTMLDivElement> }>({ prov: new Map(), reg: new Map() });
  const scaleRef = useRef(scale);
  const cb = useRef(props);
  const [ready, setReady] = useState(false);
  cb.current = props;
  scaleRef.current = scale;

  // Création de la carte (une seule fois).
  useEffect(() => {
    if (!container.current) return;
    const col = THEME[theme];
    const [x0, y0, x1, y1] = geo.bounds;
    // Marges : titre en haut, légende en bas à droite sur grand écran (sous la carte sur mobile).
    const padding = () => {
      const w = container.current?.clientWidth ?? 800;
      const h = container.current?.clientHeight ?? 600;
      const wide = w > 640;
      return { top: Math.min(96, h * 0.14), bottom: 28, left: 28, right: wide ? Math.min(300, w * 0.3) : 28 };
    };
    const map = new maplibregl.Map({
      container: container.current,
      style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": col.paper } }] },
      bounds: [x0, y0, x1, y1],
      fitBoundsOptions: { padding: padding() },
      maxBounds: [x0 - 6, y0 - 4, x1 + 6, y1 + 4],
      minZoom: 4.5,
      maxZoom: 11,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false,
      canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
      fadeDuration: reducedMotion() ? 0 : 200,
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(
      new maplibregl.AttributionControl({ compact: true, customAttribution: t("map.attribution") }),
      "bottom-left",
    );
    mapRef.current = map;

    map.on("load", () => {
      const c = THEME[theme];
      map.addImage("hatch", patternImage("hatch", c.muted), { pixelRatio: 2 });
      map.addImage("dots", patternImage("dots", c.ink), { pixelRatio: 2 });
      map.addSource("prov", { type: "geojson", data: geo.prov as unknown as GeoJSON.FeatureCollection, promoteId: "code" });
      map.addSource("reg", { type: "geojson", data: geo.reg as unknown as GeoJSON.FeatureCollection, promoteId: "code" });
      const dur = reducedMotion() ? 0 : 350;
      for (const s of ["reg", "prov"] as const) {
        const on = s === scaleRef.current ? 1 : 0;
        map.addLayer({
          id: `${s}-fill`,
          type: "fill",
          source: s,
          paint: {
            "fill-color": ["coalesce", ["feature-state", "fill"], c.empty],
            "fill-opacity": on,
            "fill-opacity-transition": { duration: dur, delay: 0 },
          },
        });
        map.addLayer({
          id: `${s}-hatch`,
          type: "fill",
          source: s,
          paint: { "fill-pattern": "hatch", "fill-opacity": ["case", ["boolean", ["feature-state", "hatch"], false], on, 0] },
        });
        map.addLayer({
          id: `${s}-fragile`,
          type: "fill",
          source: s,
          paint: { "fill-pattern": "dots", "fill-opacity": ["case", ["boolean", ["feature-state", "fragile"], false], on * 0.9, 0] },
        });
      }
      map.addLayer({
        id: "prov-line",
        type: "line",
        source: "prov",
        paint: { "line-color": c.provLine, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.4, 9, 1.2], "line-opacity": scaleRef.current === "prov" ? 0.95 : 0.35 },
      });
      map.addLayer({
        id: "reg-line",
        type: "line",
        source: "reg",
        layout: { "line-join": "round" },
        paint: { "line-color": c.ink, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.8, 9, 2] },
      });
      for (const s of ["prov", "reg"] as const) {
        map.addLayer({ id: `${s}-hover`, type: "line", source: s, filter: ["==", ["get", "code"], ""], paint: { "line-color": c.ink, "line-width": 2.6 } });
        map.addLayer({ id: `${s}-cmp`, type: "line", source: s, filter: ["==", ["get", "code"], ""], paint: { "line-color": c.accent, "line-width": 2.6, "line-dasharray": [2, 1.2] } });
        map.addLayer({ id: `${s}-sel`, type: "line", source: s, filter: ["==", ["get", "code"], ""], paint: { "line-color": c.accent, "line-width": 3.2 } });
      }

      // Étiquettes HTML (pas de dépendance à des polices distantes).
      for (const s of ["prov", "reg"] as const) {
        for (const [code, lngLat] of Object.entries(geo.labels[s])) {
          const el = document.createElement("div");
          el.className = `map-label map-label--${s}`;
          el.textContent = cb.current.names[code] ?? code;
          el.setAttribute("aria-hidden", "true");
          new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(lngLat).addTo(map);
          labelEls.current[s].set(code, el);
        }
      }
      setReady(true);
      cb.current.onReady?.({ map, labels: () => visibleLabels() });
      layoutLabels();
    });

    const visibleLabels = () => {
      const s = scaleRef.current;
      const out: { text: string; lngLat: [number, number] }[] = [];
      labelEls.current[s].forEach((el, code) => {
        if (el.style.visibility !== "hidden") out.push({ text: el.textContent ?? "", lngLat: geo.labels[s][code] });
      });
      return out;
    };

    // Placement des étiquettes : algorithme glouton, les plus grandes unités d'abord.
    let raf = 0;
    const layoutLabels = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const s = scaleRef.current;
        const other = s === "prov" ? "reg" : "prov";
        labelEls.current[other].forEach((el) => (el.style.visibility = "hidden"));
        const zoom = map.getZoom();
        const placed: DOMRect[] = [];
        // Priorité : unité sélectionnée, puis superficie décroissante.
        const pr = cb.current.priority;
        const els = [...labelEls.current[s].entries()].sort((a, b) => {
          const pa = a[0] === cb.current.selected ? 1e9 : (pr[a[0]] ?? 0);
          const pb = b[0] === cb.current.selected ? 1e9 : (pr[b[0]] ?? 0);
          return pb - pa;
        });
        for (const [, el] of els) {
          el.style.visibility = "visible";
          el.classList.toggle("map-label--small", s === "prov" && zoom < 6.6);
          const r = el.getBoundingClientRect();
          const hit = placed.some((p) => r.left < p.right + 3 && r.right > p.left - 3 && r.top < p.bottom + 1 && r.bottom > p.top - 1);
          if (hit) el.style.visibility = "hidden";
          else placed.push(r);
        }
      });
    };
    map.on("moveend", layoutLabels);
    map.on("zoomend", layoutLabels);
    map.on("resize", layoutLabels);
    (map as unknown as { __layout: () => void }).__layout = layoutLabels;

    const pick = (e: maplibregl.MapMouseEvent) => {
      const s = scaleRef.current;
      const layers = [`${s}-fill`];
      if (map.getLayer("osm-cluster")) layers.unshift("osm-cluster", "osm-point");
      return map.queryRenderedFeatures(e.point, { layers });
    };
    map.on("mousemove", (e) => {
      const f = pick(e)[0];
      if (!f) {
        map.getCanvas().style.cursor = "";
        cb.current.onHover(null, 0, 0);
        return;
      }
      if (f.layer.id.startsWith("osm")) {
        map.getCanvas().style.cursor = "default";
        const n = (f.properties?.point_count as number | undefined) ?? 1;
        cb.current.onHover(null, e.point.x, e.point.y, t("osm.tooltip", { n }));
        return;
      }
      map.getCanvas().style.cursor = "pointer";
      cb.current.onHover(String(f.properties?.code), e.point.x, e.point.y);
    });
    map.on("mouseout", () => cb.current.onHover(null, 0, 0));
    map.on("click", (e) => {
      const f = pick(e).find((x) => !x.layer.id.startsWith("osm"));
      cb.current.onSelect(f ? String(f.properties?.code) : null);
    });

    // Tant que l'utilisateur n'a ni déplacé ni zoomé, la carte reste cadrée sur le pays.
    let userMoved = false;
    const markMoved = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) userMoved = true;
    };
    map.on("dragstart", markMoved);
    map.on("zoomstart", markMoved);
    const ro = new ResizeObserver(() => {
      map.resize();
      if (!userMoved) map.fitBounds([x0, y0, x1, y1], { padding: padding(), animate: false });
    });
    ro.observe(container.current);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      map.remove();
      mapRef.current = null;
      labelEls.current = { prov: new Map(), reg: new Map() };
    };
    // La carte est créée une fois ; les mises à jour passent par les effets ci-dessous.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo]);

  // Couleurs et hachures.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const [code, cell] of Object.entries(cells)) {
      map.setFeatureState({ source: scale, id: code }, { fill: cell.color, hatch: cell.hatch, fragile: cell.fragile && !cell.hatch });
      // Couleur d'étiquette selon la luminance de l'aplat (lisible dans les deux thèmes).
      const el = labelEls.current[scale].get(code);
      if (el) {
        el.classList.toggle("map-label--on-dark", Boolean(cell.color) && isDark(cell.color));
        el.classList.toggle("map-label--on-light", Boolean(cell.color) && !isDark(cell.color));
      }
    }
  }, [cells, scale, ready]);

  // Bascule régions / provinces.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const s of ["prov", "reg"] as const) {
      const on = s === scale ? 1 : 0;
      map.setPaintProperty(`${s}-fill`, "fill-opacity", on);
      map.setPaintProperty(`${s}-hatch`, "fill-opacity", ["case", ["boolean", ["feature-state", "hatch"], false], on, 0]);
      map.setPaintProperty(`${s}-fragile`, "fill-opacity", ["case", ["boolean", ["feature-state", "fragile"], false], on * 0.9, 0]);
    }
    map.setPaintProperty("prov-line", "line-opacity", scale === "prov" ? 0.95 : 0.35);
    (map as unknown as { __layout: () => void }).__layout();
  }, [scale, ready]);

  // Survol, sélection, comparaison.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const s of ["prov", "reg"] as const) {
      const f = (code: string | null) => ["==", ["get", "code"], s === scale && code ? code : ""] as maplibregl.FilterSpecification;
      map.setFilter(`${s}-hover`, f(highlight));
      map.setFilter(`${s}-sel`, f(selected));
      map.setFilter(`${s}-cmp`, f(compare));
    }
  }, [highlight, selected, compare, scale, ready]);

  // Thème.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const c = THEME[theme];
    map.setPaintProperty("bg", "background-color", c.paper);
    map.setPaintProperty("prov-fill", "fill-color", ["coalesce", ["feature-state", "fill"], c.empty]);
    map.setPaintProperty("reg-fill", "fill-color", ["coalesce", ["feature-state", "fill"], c.empty]);
    map.setPaintProperty("prov-line", "line-color", c.provLine);
    map.setPaintProperty("reg-line", "line-color", c.ink);
    for (const s of ["prov", "reg"]) {
      map.setPaintProperty(`${s}-hover`, "line-color", c.ink);
      map.setPaintProperty(`${s}-sel`, "line-color", c.accent);
      map.setPaintProperty(`${s}-cmp`, "line-color", c.accent);
    }
    if (map.getLayer("osm-cluster")) {
      map.setPaintProperty("osm-cluster", "circle-color", c.ink);
      map.setPaintProperty("osm-point", "circle-color", c.ink);
    }
  }, [theme, ready]);

  // Noms des étiquettes (si la langue change).
  useEffect(() => {
    for (const s of ["prov", "reg"] as const) labelEls.current[s].forEach((el, code) => (el.textContent = names[code] ?? code));
  }, [names]);

  // Écoles OSM (chargement paresseux).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!showOsm) {
      if (map.getLayer("osm-cluster")) {
        map.setLayoutProperty("osm-cluster", "visibility", "none");
        map.setLayoutProperty("osm-point", "visibility", "none");
      }
      return;
    }
    if (map.getLayer("osm-cluster")) {
      map.setLayoutProperty("osm-cluster", "visibility", "visible");
      map.setLayoutProperty("osm-point", "visibility", "visible");
      return;
    }
    let alive = true;
    loadSchools().then((s) => {
      if (!alive || !mapRef.current || map.getSource("osm")) return;
      const c = THEME[theme];
      map.addSource("osm", {
        type: "geojson",
        cluster: true,
        clusterRadius: 36,
        clusterMaxZoom: 10,
        data: {
          type: "FeatureCollection",
          features: s.points.map(([x, y, k]) => ({ type: "Feature", properties: { k }, geometry: { type: "Point", coordinates: [x, y] } })),
        },
      });
      map.addLayer({
        id: "osm-cluster",
        type: "circle",
        source: "osm",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": c.ink,
          "circle-opacity": 0.5,
          "circle-stroke-color": c.paper,
          "circle-stroke-width": 1,
          "circle-radius": ["step", ["get", "point_count"], 5, 20, 8, 100, 12, 400, 17],
        },
      });
      map.addLayer({
        id: "osm-point",
        type: "circle",
        source: "osm",
        filter: ["!", ["has", "point_count"]],
        paint: { "circle-color": c.ink, "circle-radius": 2.4, "circle-opacity": 0.75 },
      });
    });
    return () => {
      alive = false;
    };
  }, [showOsm, ready, theme]);

  // Centrage demandé (recherche, tableau).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focus) return;
    const b = bbox(scale === "prov" ? geo.prov : geo.reg, focus.code);
    if (b) map.fitBounds(b, { padding: 80, maxZoom: 8.2, duration: reducedMotion() ? 0 : 700 });
  }, [focus, ready, scale, geo]);

  return <div ref={container} className="map" role="region" aria-label={ariaLabel} tabIndex={0} />;
}
