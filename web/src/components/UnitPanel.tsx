import type { Core, Scale } from "../data/types";
import { t } from "../i18n";
import { fmt, fmtDelta, previousYear, shortYear } from "../lib/format";
import { qualityOf, valueOf } from "../lib/layers";
import { PALETTES } from "../lib/palettes";
import { IntervalBar, LineChart } from "./charts";

const C = { ink: "var(--ink)", accent: "var(--accent)", f: "#B4462C", g: "#1C4C68", muted: "var(--muted)" };

export const levelOf = (code: string): Scale => (code.length === 6 ? "prov" : "reg");

function lastWith(core: Core, scale: Scale, code: string, ind: string, upTo: string): { year: string; value: number } | null {
  const ys = core.meta.annees.filter((y) => y <= upTo).reverse();
  for (const y of ys) {
    const v = valueOf(core, scale, code, ind, y);
    if (v !== null) return { year: y, value: v };
  }
  return null;
}

function nameOf(core: Core, code: string): string {
  const s = levelOf(code);
  return s === "prov" ? core.meta.unites.prov[code]?.nom : core.meta.unites.reg[code]?.nom;
}

const KEY_FIGURES: { ind: string; label?: string }[] = [
  { ind: "effectif" },
  { ind: "ecoles" },
  { ind: "ratio_eleves_maitre" },
  { ind: "tbs" },
  { ind: "tap" },
  { ind: "deperdition_obs" },
  { ind: "pauvrete" },
  { ind: "pdi_pct_pop" },
];

function Figure({ core, scale, code, ind, year }: { core: Core; scale: Scale; code: string; ind: string; year: string }) {
  const im = core.meta.indicateurs[ind];
  const v = lastWith(core, scale, code, ind, year);
  return (
    <div className="kf">
      <dt>{im.label}</dt>
      <dd>
        {fmt(v?.value, im.decimales, im.unite)}
        {v && v.year !== year && <small> ({shortYear(v.year)})</small>}
      </dd>
    </div>
  );
}

export function UnitSheet({ core, code, year, onClose, onCompare, onPrint, compareOptions }: {
  core: Core;
  code: string;
  year: string;
  onClose: () => void;
  onCompare: (code: string | null) => void;
  onPrint: () => void;
  compareOptions: { code: string; nom: string }[];
}) {
  const scale = levelOf(code);
  const name = nameOf(core, code);
  const isProv = scale === "prov";
  const pm = isProv ? core.meta.unites.prov[code] : null;
  const rm = !isProv ? core.meta.unites.reg[code] : null;
  const risk = core.risk[scale][code];
  const horizon = core.meta.horizon;
  const last = core.meta.derniere_annee;
  const idxYear = core.meta.annees_indice.includes(year) ? year : last;
  const idx = risk?.indice[idxYear];
  const pred = risk?.prediction[horizon];
  const total = Object.keys(core.meta.unites[scale]).length;
  const q = qualityOf(core, scale, code, year);
  const reco = core.risk.recommandations[scale][code];
  const years = core.meta.annees.slice(0, -1);
  const s = (ind: string) => core.values[scale][code]?.[ind]?.slice(0, -1) ?? [];
  const gap = (f: string, g: string) => {
    const vf = valueOf(core, scale, code, f, year);
    const vg = valueOf(core, scale, code, g, year);
    return { vf, vg, d: vf !== null && vg !== null ? vf - vg : null };
  };
  const rural = valueOf(core, scale, code, "part_rurale", year);
  const prive = valueOf(core, scale, code, "part_prive", year);

  return (
    <article className="sheet" aria-labelledby="sheet-title">
      <header className="sheet-head">
        <p className="eyebrow">{isProv ? t("sheet.province", { region: pm!.reg_nom }) : t("sheet.region", { n: rm!.provinces.length })}</p>
        <h2 id="sheet-title">{name}</h2>
        <p className="sheet-sub">
          {isProv
            ? t(pm!.scindee ? "sheet.oldSplit" : "sheet.old", { prov: pm!.ancienne_province, reg: pm!.ancienne_region })
            : t("sheet.oldRegion", { reg: rm!.ancienne_region })}
        </p>
        <button type="button" className="icon-btn sheet-close no-print" aria-label={t("sheet.close")} onClick={onClose}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </header>

      {pred && (
        <section className="sheet-risk">
          <h3 className="eyebrow">{t("sheet.forecast", { year: shortYear(horizon) })}</h3>
          <p className="big-number">
            {fmt(pred.valeur, 1, "%")}
            <span className="big-sub">{t("sheet.rank", { rank: pred.rang, total })}</span>
          </p>
          <IntervalBar value={pred.valeur} lo={pred.ic80[0]} hi={pred.ic80[1]} max={40} color={PALETTES.seq_risk[3]} mark={core.meta.chiffres_cles.seuil_alerte} />
          <p className="note">
            {t("sheet.interval", { lo: fmt(pred.ic80[0], 0), hi: fmt(pred.ic80[1], 0), p: fmt(pred.p_alerte * 100, 0), seuil: fmt(core.meta.chiffres_cles.seuil_alerte, 0) })}
          </p>
          {pred.facteurs && <p className="note">{t("sheet.modelFactors", { f: pred.facteurs })}</p>}
        </section>
      )}

      {idx && (
        <section className="sheet-index">
          <h3 className="eyebrow">{t("sheet.index", { year: shortYear(idxYear) })}</h3>
          <div className="index-row">
            <span className={`class-chip class-${idx.classe}`}>{t(`class.${idx.classe}`)}</span>
            <span>
              {t("sheet.indexScore", { score: fmt(idx.score, 0), rank: idx.rang, total, lo: idx.rang_p05, hi: idx.rang_p95 })}
            </span>
          </div>
          <ul className="dims">
            {Object.entries(idx.dims).map(([d, v]) => (
              <li key={d}>
                <span>{t(`dim.${d}`)}</span>
                <span className="dim-bar" aria-hidden="true">
                  <i style={{ width: `${v ?? 0}%` }} />
                </span>
                <span className="num">{fmt(v, 0)}</span>
              </li>
            ))}
          </ul>
          {idx.facteurs && <p className="note">{t("sheet.factors", { f: idx.facteurs })}</p>}
        </section>
      )}

      <section>
        <h3 className="eyebrow">{t("sheet.keyFigures", { year: shortYear(year) })}</h3>
        <dl className="kf-grid">
          {KEY_FIGURES.map((k) => (
            <Figure key={k.ind} core={core} scale={scale} code={code} ind={k.ind} year={year} />
          ))}
        </dl>
      </section>

      <section className="sheet-charts">
        <LineChart title={t("sheet.chartEnrolment")} years={years} series={[{ label: t("sheet.pupils"), values: s("effectif"), color: C.ink }]} mark={year} />
        <LineChart
          title={t("sheet.chartCompletion")}
          years={years}
          unit="%"
          series={[
            { label: t("sheet.girls"), values: s("tap_f"), color: C.f },
            { label: t("sheet.boys"), values: s("tap_g"), color: C.g, dash: true },
          ]}
          mark={year}
        />
        <LineChart
          title={t("sheet.chartDropout")}
          years={years}
          decimals={1}
          unit="%"
          refLine={{ value: core.meta.chiffres_cles.seuil_alerte, label: t("sheet.threshold") }}
          series={[
            { label: t("sheet.girls"), values: s("deperdition_obs_f"), color: C.f },
            { label: t("sheet.boys"), values: s("deperdition_obs_g"), color: C.g, dash: true },
          ]}
          mark={year}
        />
        <LineChart title={t("sheet.chartSchools")} years={years} series={[{ label: t("sheet.schools"), values: s("ecoles"), color: C.ink }]} mark={year} />
      </section>

      <section>
        <h3 className="eyebrow">{t("sheet.gender")}</h3>
        <table className="mini">
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col" className="num">{t("sheet.girls")}</th>
              <th scope="col" className="num">{t("sheet.boys")}</th>
              <th scope="col" className="num">{t("sheet.gap")}</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["tbs_f", "tbs_g", "TBS"],
              ["tap_f", "tap_g", t("sheet.completion")],
              ["deperdition_obs_f", "deperdition_obs_g", t("sheet.dropout")],
            ].map(([f, g, label]) => {
              const x = gap(f, g);
              return (
                <tr key={f}>
                  <th scope="row">{label}</th>
                  <td className="num">{fmt(x.vf, 1)}</td>
                  <td className="num">{fmt(x.vg, 1)}</td>
                  <td className="num">{fmtDelta(x.d, 1, "pt")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="note">{t("sheet.milieu", { rural: fmt(rural, 0, "%"), prive: fmt(prive, 0, "%") })}</p>
      </section>

      {reco && reco.types.length > 0 && (
        <section>
          <h3 className="eyebrow">{t("sheet.actions")}</h3>
          {reco.types.map((ty) => (
            <div key={ty.type} className="action">
              <p className="action-title">{ty.titre}</p>
              <ul>
                {ty.actions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          ))}
          <p className="note">{t("sheet.actionsNote")}</p>
        </section>
      )}

      <section>
        <h3 className="eyebrow">{t("sheet.quality")}</h3>
        <p>
          <strong>{fmt(q.score, 0)}/100</strong> {q.score !== null && q.score < 60 ? t("sheet.qualityFragile") : ""}
        </p>
        {q.reasons ? (
          <ul className="reasons">
            {q.reasons.split(" ; ").map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : (
          <p className="note">{t("sheet.qualityOk")}</p>
        )}
        <p className="note">{t("sheet.sources")}</p>
      </section>

      <footer className="sheet-actions no-print">
        <label>
          <span className="eyebrow">{t("sheet.compareWith")}</span>
          <select onChange={(e) => onCompare(e.target.value || null)} defaultValue="">
            <option value="">—</option>
            {compareOptions
              .filter((o) => o.code !== code)
              .map((o) => (
                <option key={o.code} value={o.code}>
                  {o.nom}
                </option>
              ))}
          </select>
        </label>
        <button type="button" className="btn" onClick={onPrint}>
          {t("sheet.print")}
        </button>
      </footer>
    </article>
  );
}

const COMPARE_ROWS = ["effectif", "ecoles", "ratio_eleves_maitre", "tbs", "tap", "tap_f", "tap_g", "ips_tbs", "deperdition_obs", "baisse_ecoles_pic", "pauvrete", "pdi_pct_pop", "qualite_score"];

export function CompareSheet({ core, a, b, year, onClose, onSwap }: { core: Core; a: string; b: string; year: string; onClose: () => void; onSwap: () => void }) {
  const horizon = core.meta.horizon;
  const units = [a, b];
  const years = core.meta.annees.slice(0, -1);
  const colors = ["var(--accent)", "var(--ink)"];
  const idxYear = core.meta.annees_indice.includes(year) ? year : core.meta.derniere_annee;
  return (
    <article className="sheet" aria-labelledby="cmp-title">
      <header className="sheet-head">
        <p className="eyebrow">{t("compare.title")}</p>
        <h2 id="cmp-title">
          {nameOf(core, a)} <span className="vs">/</span> {nameOf(core, b)}
        </h2>
        <button type="button" className="icon-btn sheet-close no-print" aria-label={t("compare.close")} onClick={onClose}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </header>
      <table className="mini compare">
        <thead>
          <tr>
            <th scope="col">{shortYear(year)}</th>
            {units.map((u, i) => (
              <th key={u} scope="col" className="num" style={{ color: colors[i] }}>
                {nameOf(core, u)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">{t("compare.forecast", { year: shortYear(horizon) })}</th>
            {units.map((u) => {
              const p = core.risk[levelOf(u)][u]?.prediction[horizon];
              return (
                <td key={u} className="num">
                  {p ? `${fmt(p.valeur, 1, "%")} [${fmt(p.ic80[0], 0)}–${fmt(p.ic80[1], 0)}]` : "—"}
                </td>
              );
            })}
          </tr>
          <tr>
            <th scope="row">{t("compare.index", { year: shortYear(idxYear) })}</th>
            {units.map((u) => {
              const r = core.risk[levelOf(u)][u]?.indice[idxYear];
              return (
                <td key={u} className="num">
                  {r ? `${fmt(r.score, 0)} · ${t(`class.${r.classe}`)}` : "—"}
                </td>
              );
            })}
          </tr>
          {COMPARE_ROWS.map((ind) => {
            const im = core.meta.indicateurs[ind];
            return (
              <tr key={ind}>
                <th scope="row">{im.label}</th>
                {units.map((u) => (
                  <td key={u} className="num">
                    {fmt(valueOf(core, levelOf(u), u, ind, year), im.decimales, im.unite)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <section className="sheet-charts">
        {[
          ["effectif", t("sheet.chartEnrolment"), 0],
          ["tap", t("sheet.chartCompletionAll"), 1],
          ["deperdition_obs", t("sheet.chartDropoutAll"), 1],
          ["ecoles", t("sheet.chartSchools"), 0],
        ].map(([ind, title, d]) => (
          <LineChart
            key={ind as string}
            title={title as string}
            years={years}
            decimals={d as number}
            mark={year}
            series={units.map((u, i) => ({ label: nameOf(core, u), values: core.values[levelOf(u)][u]?.[ind as string]?.slice(0, -1) ?? [], color: colors[i], dash: i === 1 }))}
          />
        ))}
      </section>
      <footer className="sheet-actions no-print">
        <button type="button" className="btn btn--ghost" onClick={onSwap}>
          {t("compare.swap")}
        </button>
        <button type="button" className="btn" onClick={() => window.print()}>
          {t("sheet.print")}
        </button>
      </footer>
      <p className="note">{t("compare.note", { prev: shortYear(previousYear(year)) })}</p>
    </article>
  );
}
