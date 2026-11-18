import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CompareYear, LayerPicker, ScaleToggle, YearSlider } from "../components/Controls";
import Legend from "../components/Legend";
import MapView, { type MapHandle } from "../components/MapView";
import RankingTable from "../components/RankingTable";
import Search from "../components/Search";
import { CompareSheet, UnitSheet, levelOf } from "../components/UnitPanel";
import { loadGeo, useLoad } from "../data/load";
import type { Core, Scale } from "../data/types";
import { t } from "../i18n";
import { exportMapPng } from "../lib/exporters";
import { fmt, shortYear } from "../lib/format";
import { computeLayer, getLayer, layerLabel, layerYears, qualityOf, riskOrder } from "../lib/layers";
import type { AppState } from "../lib/url";

interface Props {
  core: Core;
  state: AppState;
  set: (patch: Partial<AppState>) => void;
  theme: "light" | "dark";
}

export default function Explore({ core, state, set, theme }: Props) {
  const geo = useLoad(loadGeo);
  const def = getLayer(state.layer);
  const scale = state.scale;
  const years = useMemo(() => layerYears(def, core, scale), [def, core, scale]);
  const year = years.includes(state.year) ? state.year : years[years.length - 1];
  const ref = state.ref && years.includes(state.ref) && state.ref < year ? state.ref : null;
  const result = useMemo(() => computeLayer(def, core, scale, year, ref), [def, core, scale, year, ref]);
  const [hover, setHover] = useState<{ code: string | null; x: number; y: number; extra?: string }>({ code: null, x: 0, y: 0 });
  const [highlight, setHighlight] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ code: string; n: number } | null>(null);
  const handle = useRef<MapHandle | null>(null);

  const names = useMemo(() => {
    const n: Record<string, string> = {};
    for (const [c, p] of Object.entries(core.meta.unites.prov)) n[c] = p.nom;
    for (const [c, r] of Object.entries(core.meta.unites.reg)) n[c] = r.nom;
    return n;
  }, [core]);
  const priority = useMemo(() => {
    const p: Record<string, number> = {};
    for (const [c, u] of Object.entries(core.meta.unites.prov)) p[c] = u.superficie_km2;
    for (const [c, u] of Object.entries(core.meta.unites.reg)) p[c] = u.superficie_km2;
    return p;
  }, [core]);

  const order = riskOrder(def, core);
  const ranks = useMemo(() => {
    const r: Record<string, number> = {};
    Object.values(result.cells)
      .filter((c) => c.value !== null)
      .sort((a, b) => order * ((b.value as number) - (a.value as number)))
      .forEach((c, i) => (r[c.code] = i + 1));
    return r;
  }, [result, order]);
  const total = Object.keys(core.meta.unites[scale]).length;

  const ariaMap = useMemo(() => {
    const vals = Object.values(result.cells).filter((c) => c.value !== null).sort((a, b) => (b.value as number) - (a.value as number));
    const hi = vals[0];
    const lo = vals[vals.length - 1];
    return t("map.aria", {
      layer: layerLabel(def, core),
      year: shortYear(year),
      scale: t(`scale.${scale}`).toLowerCase(),
      hi: hi ? `${names[hi.code]} (${hi.display})` : "—",
      lo: lo ? `${names[lo.code]} (${lo.display})` : "—",
    });
  }, [result, def, core, year, scale, names]);

  const select = useCallback(
    (code: string | null) => {
      set({ sel: code, cmp: code ? state.cmp : null });
    },
    [set, state.cmp],
  );
  const pickFromList = (code: string) => {
    const s: Scale = levelOf(code);
    set({ sel: code, scale: s, cmp: null });
    setFocus({ code, n: Date.now() });
  };

  // Échap ferme la fiche.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && state.sel && set({ sel: null, cmp: null });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.sel, set]);

  const exportPng = () => {
    const h = handle.current;
    if (!h) return;
    const title = `${layerLabel(def, core)}${result.diff ? ` : ${t("legend.change")} ${shortYear(ref!)} → ${shortYear(year)}` : ""}`;
    exportMapPng(
      h.map,
      {
        title,
        subtitle: t("export.subtitle", { year: shortYear(year), scale: t(`scale.${scale}`).toLowerCase() }),
        legendTitle: result.legend.title,
        legend: result.legend.items,
        bivariate: result.legend.kind === "bivariate" ? { colors: result.legend.items.map((i) => i.color), axes: result.legend.axes! } : undefined,
        source: t("export.source", { date: core.meta.genere_le }),
        labels: h.labels(),
        dark: theme === "dark",
      },
      `carte_${def.id}_${scale}_${year}.png`,
    );
  };

  const printSheet = () => {
    document.body.classList.add("print-sheet");
    window.print();
    setTimeout(() => document.body.classList.remove("print-sheet"), 500);
  };

  const prevYear = years.indexOf(year) > 0 ? years[years.indexOf(year) - 1] : null;
  const hoverCell = hover.code ? result.cells[hover.code] : null;
  const hoverQ = hover.code ? qualityOf(core, scale, hover.code, year) : null;
  const sheetYear = core.meta.annees.includes(year) && year !== core.meta.horizon ? year : core.meta.derniere_annee;
  const compareOptions = Object.entries(state.sel && levelOf(state.sel) === "reg" ? core.meta.unites.reg : core.meta.unites.prov)
    .map(([code, u]) => ({ code, nom: u.nom }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));

  return (
    <div className={`explore${state.sel ? " has-panel" : ""}`}>
      <aside className="explore-side" aria-label={t("explore.controls")}>
        <Search core={core} onPick={pickFromList} />
        <LayerPicker core={core} value={def.id} onChange={(id) => set({ layer: id, ref: null })} />
        <div className="control-block">
          <p className="eyebrow">{t("controls.scale")}</p>
          <ScaleToggle value={scale} onChange={(s) => set({ scale: s, sel: state.sel && levelOf(state.sel) === s ? state.sel : null, cmp: null })} />
        </div>
        <YearSlider years={years} value={year} onChange={(y) => set({ year: y })} />
        <CompareYear years={years} year={year} value={ref} enabled={result.supportsDiff} onChange={(r) => set({ ref: r })} />
        <label className="check">
          <input type="checkbox" checked={state.osm} onChange={(e) => set({ osm: e.target.checked })} />
          <span>{t("controls.osm")}</span>
        </label>
        {state.osm && <p className="note">{t("osm.note")}</p>}
        <div className="control-row">
          <button type="button" className="btn btn--ghost" onClick={exportPng} disabled={geo.status !== "ready"}>
            {t("controls.exportPng")}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigator.clipboard?.writeText(location.href)}
            title={t("controls.shareHint")}
          >
            {t("controls.share")}
          </button>
        </div>
        <RankingTable
          core={core}
          def={def}
          result={result}
          scale={scale}
          year={year}
          prevYear={prevYear}
          selected={state.sel}
          onSelect={pickFromList}
          onHover={setHighlight}
        />
      </aside>

      <section className="explore-map" aria-label={t("explore.mapSection")}>
        {geo.status === "ready" ? (
          <MapView
            geo={geo.data}
            scale={scale}
            cells={result.cells}
            names={names}
            priority={priority}
            selected={state.sel}
            compare={state.cmp}
            highlight={highlight ?? hover.code}
            focus={focus}
            showOsm={state.osm}
            theme={theme}
            ariaLabel={ariaMap}
            onHover={(code, x, y, extra) => setHover({ code, x, y, extra })}
            onSelect={select}
            onReady={(h) => (handle.current = h)}
          />
        ) : (
          <div className="map map--loading" role="status">
            {geo.status === "error" ? geo.error : t("app.loading")}
          </div>
        )}
        <div className="map-title" aria-hidden="true">
          <p className="eyebrow">{t(`scale.${scale}`)} · {t("explore.reform")}</p>
          <p className="map-title-main">
            {layerLabel(def, core)} <span>{result.diff ? `${shortYear(ref!)} → ${shortYear(year)}` : shortYear(year)}</span>
          </p>
        </div>
        <Legend result={result} year={result.diff ? "" : shortYear(year)} />
        {(hoverCell || hover.extra) && (
          <div className="tooltip" style={{ left: hover.x, top: hover.y }} role="tooltip">
            {hoverCell && hover.code ? (
              <>
                <p className="tooltip-title">{names[hover.code]}</p>
                {scale === "prov" && <p className="tooltip-sub">{core.meta.unites.prov[hover.code]?.reg_nom}</p>}
                <p className="tooltip-value">{hoverCell.display}</p>
                {!result.diff && ranks[hover.code] && <p className="tooltip-sub">{t("tooltip.rank", { rank: ranks[hover.code], total })}</p>}
                {hoverCell.fragile && <p className="tooltip-warn">{t("tooltip.fragile")}</p>}
                {hoverQ?.reasons && hoverCell.fragile && <p className="tooltip-sub">{hoverQ.reasons.split(" ; ")[0]}</p>}
              </>
            ) : (
              <p className="tooltip-title">{hover.extra}</p>
            )}
          </div>
        )}
      </section>

      {state.sel && (
        <aside className="explore-panel" aria-label={t("explore.panel")}>
          {state.cmp ? (
            <CompareSheet core={core} a={state.sel} b={state.cmp} year={sheetYear} onClose={() => set({ cmp: null })} onSwap={() => set({ sel: state.cmp, cmp: state.sel })} />
          ) : (
            <UnitSheet
              core={core}
              code={state.sel}
              year={sheetYear}
              onClose={() => set({ sel: null })}
              onCompare={(c) => set({ cmp: c })}
              onPrint={printSheet}
              compareOptions={compareOptions}
            />
          )}
        </aside>
      )}
      <p className="sr-only" aria-live="polite">
        {state.sel ? t("explore.selected", { name: names[state.sel] ?? "", value: result.cells[state.sel]?.display ?? fmt(null) }) : ""}
      </p>
    </div>
  );
}
