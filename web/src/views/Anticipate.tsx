import { useMemo, useState } from "react";
import { GroupedBars, IntervalBar, Scatter } from "../components/charts";
import { ScaleToggle } from "../components/Controls";
import { loadModel, useLoad } from "../data/load";
import type { Core, ModelMetric, Scale } from "../data/types";
import { t } from "../i18n";
import { fmt, shortYear } from "../lib/format";
import { PALETTES } from "../lib/palettes";
import type { AppState } from "../lib/url";

const MODEL_COLORS: Record<string, string> = {
  persistance: "#C9C1B4",
  moyenne_historique: "#9A9284",
  ridge: "#7FA7BA",
  huber: "#457D98",
  gbr: "#1C4C68",
  mediane: "#B4462C",
};
const FOLD_COLORS = ["#7FA7BA", "#457D98", "#DC8B58", "#7D2B1C"];

function metric(list: ModelMetric[], name: string, key: keyof ModelMetric): number | null {
  const m = list.find((x) => x.modele === name && x[key] !== null && x[key] !== undefined);
  return (m?.[key] as number | undefined) ?? null;
}

export default function Anticipate({ core, state, go }: { core: Core; state: AppState; go: (p: Partial<AppState>) => void }) {
  const model = useLoad(loadModel);
  const [scale, setScale] = useState<Scale>(state.scale);
  const [showAll, setShowAll] = useState(false);
  const horizon = core.meta.horizon;
  const total = Object.keys(core.meta.unites[scale]).length;
  const seuil = core.meta.chiffres_cles.seuil_alerte;

  const rows = useMemo(() => {
    return Object.entries(core.risk[scale])
      .map(([code, r]) => ({ code, p: r.prediction[horizon], idx: r.indice[core.meta.derniere_annee], reco: core.risk.recommandations[scale][code] }))
      .filter((r) => r.p)
      .sort((a, b) => b.p.valeur - a.p.valeur);
  }, [core, scale, horizon]);
  const shown = showAll ? rows : rows.slice(0, 12);
  const name = (code: string) => (scale === "prov" ? core.meta.unites.prov[code].nom : core.meta.unites.reg[code].nom);

  const groups = useMemo(() => {
    const g: Record<string, { titre: string; actions: string[]; units: string[] }> = {};
    for (const [code, r] of Object.entries(core.risk.recommandations.prov)) {
      if (r.priorite > 2) continue;
      for (const ty of r.types) {
        g[ty.type] ??= { titre: ty.titre, actions: ty.actions, units: [] };
        g[ty.type].units.push(code);
      }
    }
    return Object.entries(g).sort((a, b) => b[1].units.length - a[1].units.length);
  }, [core]);

  return (
    <div className="page anticipate">
      <header className="page-head">
        <p className="eyebrow">{t("anticipate.kicker")}</p>
        <h1 className="page-title">{t("anticipate.title", { horizon: shortYear(horizon) })}</h1>
        <p className="lede">{t("anticipate.lede", { seuil: fmt(seuil, 0), last: shortYear(core.meta.derniere_annee), horizon: shortYear(horizon) })}</p>
      </header>

      <section aria-labelledby="forecast-title">
        <div className="section-head">
          <h2 id="forecast-title" className="section-title">
            {t("anticipate.rankingTitle")}
          </h2>
          <ScaleToggle value={scale} onChange={setScale} />
        </div>
        <div className="table-scroll">
          <table className="forecast">
            <caption className="sr-only">{t("anticipate.rankingCaption", { horizon })}</caption>
            <thead>
              <tr>
                <th scope="col" className="num">#</th>
                <th scope="col">{t(`scale.${scale}One`)}</th>
                <th scope="col" className="num">{t("anticipate.colValue")}</th>
                <th scope="col" className="interval-col">{t("anticipate.colInterval")}</th>
                <th scope="col" className="num">{t("anticipate.colProba")}</th>
                <th scope="col">{t("anticipate.colFactors")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.code}>
                  <td className="num">{i + 1}</td>
                  <th scope="row">
                    <button type="button" className="row-btn" onClick={() => go({ view: "explorer", layer: "prediction", scale, sel: r.code, year: horizon })}>
                      {name(r.code)}
                    </button>
                    {scale === "prov" && <small className="muted"> {core.meta.unites.prov[r.code].reg_nom}</small>}
                  </th>
                  <td className="num">{fmt(r.p.valeur, 1, "%")}</td>
                  <td className="interval-col">
                    <IntervalBar value={r.p.valeur} lo={r.p.ic80[0]} hi={r.p.ic80[1]} max={40} color={PALETTES.seq_risk[3]} mark={seuil} />
                    <span className="sr-only">{t("anticipate.intervalSr", { lo: fmt(r.p.ic80[0], 1), hi: fmt(r.p.ic80[1], 1) })}</span>
                  </td>
                  <td className={`num${r.p.p_alerte >= 0.5 ? " is-worse" : ""}`}>{fmt(r.p.p_alerte * 100, 0, "%")}</td>
                  <td className="factors">{r.idx?.facteurs || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="control-row">
          <button type="button" className="link-btn" onClick={() => setShowAll(!showAll)}>
            {showAll ? t("anticipate.showLess") : t("anticipate.showAll", { n: total })}
          </button>
        </div>
        <p className="note">{t("anticipate.rankingNote")}</p>
      </section>

      {model.status === "ready" && (() => {
        const m = model.data;
        const chosen = m.resume.selection.retenu;
        const mt = m.metriques_temporelles;
        const ms = m.metriques_spatiales;
        const naive = Math.min(metric(mt, "persistance", "MAE") ?? Infinity, metric(mt, "moyenne_historique", "MAE") ?? Infinity);
        const gain = (1 - (metric(mt, chosen, "MAE") ?? naive) / naive) * 100;
        const names = ["persistance", "moyenne_historique", "ridge", "gbr", chosen];
        const folds = m.plis.map((p) => String(p.pli));
        const maxImp = Math.max(...m.importance.map((x) => Math.abs(x.permutation ?? 0)), 0.01);
        return (
          <>
            <section aria-labelledby="validation-title">
              <h2 id="validation-title" className="section-title">
                {t("anticipate.validationTitle")}
              </h2>
              <p className="prose">
                {t("anticipate.validationText", {
                  n: m.resume.n_observations,
                  prov: m.resume.n_provinces,
                  chosen: t(`model.${chosen}`),
                  gain: fmt(gain, 0),
                  mae: fmt(metric(mt, chosen, "MAE"), 1),
                  naive: fmt(naive, 1),
                  auc: fmt(metric(mt, "logistique", "AUC"), 2),
                  aucp: fmt(metric(mt, "persistance", "AUC"), 2),
                })}
              </p>
              <div className="chart-row chart-row--2">
                <GroupedBars
                  title={t("anticipate.maeTitle")}
                  yLabel={t("anticipate.maeY")}
                  groups={folds.map((f) => `${shortYear(f)} → +1`)}
                  series={names.map((n) => ({ label: t(`model.${n}`), values: m.plis.map((p) => (p[`MAE_${n}`] as number | null) ?? null), color: MODEL_COLORS[n] }))}
                />
                <Scatter
                  title={t("anticipate.scatterTitle")}
                  xLabel={t("anticipate.observed")}
                  yLabel={t("anticipate.predicted")}
                  points={m.validation_points.map(([y, p, , f]) => ({ x: y, y: p, color: FOLD_COLORS[folds.indexOf(f)] ?? "#888" }))}
                />
              </div>
              <div className="table-scroll">
                <table className="metrics">
                  <caption>{t("anticipate.metricsCaption")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("anticipate.model")}</th>
                      <th scope="col" className="num">{t("anticipate.maeT")}</th>
                      <th scope="col" className="num">{t("anticipate.rhoT")}</th>
                      <th scope="col" className="num">{t("anticipate.maeS")}</th>
                      <th scope="col" className="num">{t("anticipate.rhoS")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {["persistance", "moyenne_historique", "ridge", "huber", "mediane", "gbr"].map((n) => (
                      <tr key={n} className={n === chosen ? "is-selected" : ""}>
                        <th scope="row">{t(`model.${n}`)}{n === chosen ? ` · ${t("anticipate.retained")}` : ""}</th>
                        <td className="num">{fmt(metric(mt, n, "MAE"), 2)}</td>
                        <td className="num">{fmt(metric(mt, n, "Spearman"), 2)}</td>
                        <td className="num">{fmt(metric(ms, n, "MAE"), 2)}</td>
                        <td className="num">{fmt(metric(ms, n, "Spearman"), 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <table className="metrics">
                  <caption>{t("anticipate.alertCaption", { seuil: fmt(seuil, 0) })}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("anticipate.model")}</th>
                      <th scope="col" className="num">AUC ({t("anticipate.temporal")})</th>
                      <th scope="col" className="num">Brier</th>
                      <th scope="col" className="num">AUC ({t("anticipate.spatial")})</th>
                      <th scope="col" className="num">Brier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {["persistance", "logistique", "gbc"].map((n) => (
                      <tr key={n}>
                        <th scope="row">{t(`model.${n}`)}</th>
                        <td className="num">{fmt(metric(mt, n, "AUC"), 2)}</td>
                        <td className="num">{fmt(metric(mt, n, "Brier"), 3)}</td>
                        <td className="num">{fmt(metric(ms, n, "AUC"), 2)}</td>
                        <td className="num">{fmt(metric(ms, n, "Brier"), 3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="note">{m.resume.selection.regle}</p>
            </section>

            <section aria-labelledby="uncertainty-title">
              <h2 id="uncertainty-title" className="section-title">
                {t("anticipate.uncertaintyTitle")}
              </h2>
              <div className="chart-row chart-row--2">
                <div>
                  <p className="prose">{t("anticipate.uncertaintyText")}</p>
                  <table className="mini">
                    <thead>
                      <tr>
                        <th scope="col">{t("anticipate.fold")}</th>
                        <th scope="col" className="num">80 %</th>
                        <th scope="col" className="num">90 %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...new Set(m.resume.conformal.couverture.map((c) => c.pli))].map((pli) => (
                        <tr key={pli}>
                          <th scope="row">{shortYear(pli)} → +1</th>
                          {[0.8, 0.9].map((lvl) => {
                            const c = m.resume.conformal.couverture.find((x) => x.pli === pli && x.niveau === lvl);
                            return (
                              <td key={lvl} className="num">
                                {fmt((c?.couverture ?? NaN) * 100, 0, "%")}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Scatter
                  title={t("anticipate.calibrationTitle")}
                  xLabel={t("anticipate.probaPred")}
                  yLabel={t("anticipate.freqObs")}
                  max={1}
                  points={m.calibration.map((c) => ({ x: c.proba_moyenne, y: c.frequence_observee, color: "#B4462C" }))}
                />
              </div>
            </section>

            <section aria-labelledby="importance-title">
              <h2 id="importance-title" className="section-title">
                {t("anticipate.importanceTitle")}
              </h2>
              <p className="prose">{t("anticipate.importanceText", { chosen: t(`model.${chosen}`) })}</p>
              <ul className="importance">
                {m.importance.map((x) => (
                  <li key={x.variable}>
                    <span>{x.libelle}</span>
                    <span className="dim-bar" aria-hidden="true">
                      <i style={{ width: `${(Math.max(0, x.permutation ?? 0) / maxImp) * 100}%` }} />
                    </span>
                    <span className="num">{fmt(x.permutation, 2)}</span>
                    <span className="num muted">{x.coef === null || x.coef === 0 ? "—" : x.coef > 0 ? "↑" : "↓"}</span>
                  </li>
                ))}
              </ul>
              <p className="note">{t("anticipate.importanceNote")}</p>
            </section>
          </>
        );
      })()}

      <section aria-labelledby="actions-title">
        <h2 id="actions-title" className="section-title">
          {t("anticipate.actionsTitle")}
        </h2>
        <p className="prose">{t("anticipate.actionsText")}</p>
        <div className="cards">
          {groups.map(([type, g]) => (
            <article key={type} className="card">
              <p className="eyebrow">{t("anticipate.provinces", { n: g.units.length })}</p>
              <h3>{g.titre}</h3>
              <p className="card-units">
                {g.units
                  .map((c) => core.meta.unites.prov[c].nom)
                  .sort((a, b) => a.localeCompare(b, "fr"))
                  .join(", ")}
              </p>
              <ul>
                {g.actions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="limits-title">
        <h2 id="limits-title" className="section-title">
          {t("anticipate.limitsTitle")}
        </h2>
        <ul className="prose-list">
          {[1, 2, 3, 4, 5].map((i) => (
            <li key={i}>{t(`anticipate.limit${i}`)}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
