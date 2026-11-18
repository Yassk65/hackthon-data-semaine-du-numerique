import { useMemo, useState } from "react";
import type { Core, Scale } from "../data/types";
import { t } from "../i18n";
import { downloadCSV } from "../lib/exporters";
import { fmt, fmtDelta, shortYear } from "../lib/format";
import { type LayerDef, type LayerResult, computeLayer, layerLabel, qualityOf, riskOrder } from "../lib/layers";

type SortKey = "rang" | "nom" | "region" | "valeur" | "delta" | "qualite";

interface Row {
  code: string;
  nom: string;
  region: string;
  regionCode: string;
  valeur: number | null;
  display: string;
  delta: number | null;
  qualite: number | null;
  color: string | null;
  rang: number | null;
}

export default function RankingTable({
  core,
  def,
  result,
  scale,
  year,
  prevYear,
  selected,
  onSelect,
  onHover,
}: {
  core: Core;
  def: LayerDef;
  result: LayerResult;
  scale: Scale;
  year: string;
  prevYear: string | null;
  selected: string | null;
  onSelect: (code: string) => void;
  onHover: (code: string | null) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "rang", dir: 1 });
  const [region, setRegion] = useState("");
  const [query, setQuery] = useState("");
  const order = riskOrder(def, core);

  const rows = useMemo<Row[]>(() => {
    const prev = prevYear && !result.diff ? computeLayer(def, core, scale, prevYear, null) : null;
    const units = core.meta.unites[scale];
    const list: Row[] = Object.keys(units).map((code) => {
      const cell = result.cells[code];
      const regionCode = scale === "prov" ? core.meta.unites.prov[code].reg : code;
      const p = prev?.cells[code]?.value ?? null;
      return {
        code,
        nom: units[code].nom,
        region: scale === "prov" ? core.meta.unites.prov[code].reg_nom : "",
        regionCode,
        valeur: cell?.value ?? null,
        display: cell?.display ?? "—",
        delta: cell?.value !== null && cell?.value !== undefined && p !== null ? cell.value - p : null,
        qualite: qualityOf(core, scale, code, year).score,
        color: cell?.color ?? null,
        rang: null,
      };
    });
    const ranked = list.filter((r) => r.valeur !== null).sort((a, b) => order * ((b.valeur as number) - (a.valeur as number)));
    ranked.forEach((r, i) => (r.rang = i + 1));
    return list;
  }, [core, def, result, scale, year, prevYear, order]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const f = rows.filter((r) => (!region || r.regionCode === region) && (!q || r.nom.toLowerCase().includes(q) || r.region.toLowerCase().includes(q)));
    const val = (r: Row): number | string => {
      switch (sort.key) {
        case "nom":
          return r.nom;
        case "region":
          return r.region;
        case "valeur":
          return r.valeur ?? -Infinity;
        case "delta":
          return r.delta ?? -Infinity;
        case "qualite":
          return r.qualite ?? -Infinity;
        default:
          return r.rang ?? Infinity;
      }
    };
    return [...f].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const c = typeof va === "string" ? va.localeCompare(vb as string, "fr") : (va as number) - (vb as number);
      return sort.dir * c;
    });
  }, [rows, region, query, sort]);

  const header = (key: SortKey, label: string, numeric = false) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={numeric ? "num" : ""}>
      <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "valeur" || key === "delta" ? -1 : 1 }))}>
        {label}
        <span className="sort-ind" aria-hidden="true">{sort.key === key ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );

  const exportCsv = () => {
    const title = layerLabel(def, core);
    downloadCSV(`classement_${def.id}_${scale}_${year}.csv`, [
      [t("table.rank"), t("table.code"), t(`scale.${scale}One`), ...(scale === "prov" ? [t("table.region")] : []), `${title} (${year})`, t("table.delta"), t("table.quality")],
      ...visible.map((r) => [r.rang, r.code, r.nom, ...(scale === "prov" ? [r.region] : []), r.valeur, r.delta, r.qualite]),
      [],
      [t("table.csvSource")],
    ]);
  };

  return (
    <section className="ranking" aria-labelledby="ranking-title">
      <div className="ranking-head">
        <h2 id="ranking-title" className="eyebrow">
          {t("table.title", { year: shortYear(year) })}
        </h2>
        <button type="button" className="link-btn" onClick={exportCsv}>
          {t("table.csv")}
        </button>
      </div>
      <div className="ranking-filters">
        <input type="search" placeholder={t("table.filter")} aria-label={t("table.filter")} value={query} onChange={(e) => setQuery(e.target.value)} />
        {scale === "prov" && (
          <select aria-label={t("table.regionFilter")} value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">{t("table.allRegions")}</option>
            {Object.entries(core.meta.unites.reg)
              .sort((a, b) => a[1].nom.localeCompare(b[1].nom, "fr"))
              .map(([c, r]) => (
                <option key={c} value={c}>
                  {r.nom}
                </option>
              ))}
          </select>
        )}
      </div>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">{t("table.caption", { layer: layerLabel(def, core), year })}</caption>
          <thead>
            <tr>
              {header("rang", "#", true)}
              {header("nom", t(`scale.${scale}One`))}
              {scale === "prov" && header("region", t("table.region"))}
              {header("valeur", result.diff ? t("table.change") : t("table.value"), true)}
              {!result.diff && header("delta", t("table.deltaShort"), true)}
              {header("qualite", t("table.qualityShort"), true)}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={r.code}
                className={r.code === selected ? "is-selected" : ""}
                onMouseEnter={() => onHover(r.code)}
                onMouseLeave={() => onHover(null)}
              >
                <td className="num">{r.rang ?? "—"}</td>
                <th scope="row">
                  <button type="button" className="row-btn" onClick={() => onSelect(r.code)} onFocus={() => onHover(r.code)} onBlur={() => onHover(null)}>
                    <i className="dot" style={{ background: r.color ?? "transparent" }} />
                    {r.nom}
                  </button>
                </th>
                {scale === "prov" && <td className="muted">{r.region}</td>}
                <td className="num">{r.display}</td>
                {!result.diff && <td className={`num delta ${r.delta === null ? "" : r.delta * order > 0 ? "is-worse" : r.delta * order < 0 ? "is-better" : ""}`}>{r.delta === null ? "—" : fmtDelta(r.delta, result.decimals, result.unit === "%" ? "pt" : "")}</td>}
                <td className={`num ${r.qualite !== null && r.qualite < 60 ? "is-fragile" : ""}`}>{fmt(r.qualite, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
