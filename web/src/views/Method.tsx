import { useState } from "react";
import { loadModel, loadQuality, useLoad } from "../data/load";
import type { Core } from "../data/types";
import { t } from "../i18n";
import { fmt } from "../lib/format";

export default function Method({ core }: { core: Core }) {
  const quality = useLoad(loadQuality);
  const model = useLoad(loadModel);
  const [showMap, setShowMap] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const inds = ["deperdition_obs", "survie_cm2", "tap", "tbs", "ips_tbs", "ratio_eleves_maitre", "ratio_eleves_salle", "baisse_ecoles_pic", "pdi_pct_pop", "pauvrete"];

  return (
    <div className="page method">
      <header className="page-head">
        <p className="eyebrow">{t("method.kicker")}</p>
        <h1 className="page-title">{t("method.title")}</h1>
        <p className="lede">{t("method.lede")}</p>
      </header>

      <section aria-labelledby="src-title">
        <h2 id="src-title" className="section-title">{t("method.sourcesTitle")}</h2>
        <div className="table-scroll">
          <table className="sources">
            <thead>
              <tr>
                <th scope="col">{t("method.source")}</th>
                <th scope="col">{t("method.producer")}</th>
                <th scope="col">{t("method.usage")}</th>
                <th scope="col">{t("method.licence")}</th>
              </tr>
            </thead>
            <tbody>
              {core.meta.sources.map((s) => (
                <tr key={s.id}>
                  <th scope="row">
                    <a href={s.lien} target="_blank" rel="noreferrer">{s.titre}</a>
                  </th>
                  <td>{s.producteur}</td>
                  <td>{s.usage}</td>
                  <td>{s.licence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">{t("method.acled")}</p>
      </section>

      <section aria-labelledby="def-title">
        <h2 id="def-title" className="section-title">{t("method.definitionsTitle")}</h2>
        <dl className="definitions">
          {inds.map((k) => (
            <div key={k}>
              <dt>{core.meta.indicateurs[k].label}</dt>
              <dd>{core.meta.indicateurs[k].description || "—"}</dd>
            </div>
          ))}
        </dl>
        <p className="prose">{t("method.dropoutDef")}</p>
      </section>

      <section aria-labelledby="terr-title">
        <h2 id="terr-title" className="section-title">{t("method.territoryTitle")}</h2>
        <p className="prose">{t("method.territory")}</p>
        <button type="button" className="link-btn" aria-expanded={showMap} onClick={() => setShowMap(!showMap)}>
          {showMap ? t("method.hideTable") : t("method.showTable", { n: core.meta.correspondance.length })}
        </button>
        {showMap && (
          <div className="table-scroll">
            <table className="mini">
              <thead>
                <tr>
                  <th scope="col">{t("method.oldProv")}</th>
                  <th scope="col">{t("method.oldReg")}</th>
                  <th scope="col">{t("method.newProv")}</th>
                  <th scope="col">{t("method.newReg")}</th>
                  <th scope="col" className="num">{t("method.communes")}</th>
                </tr>
              </thead>
              <tbody>
                {core.meta.correspondance.map((r) => (
                  <tr key={`${r.ancienne_province}-${r.province}`}>
                    <td>{r.ancienne_province}</td>
                    <td>{r.ancienne_region}</td>
                    <td>{r.province}</td>
                    <td>{r.region}</td>
                    <td className="num">{r.communes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {model.status === "ready" && (
        <section aria-labelledby="index-title">
          <h2 id="index-title" className="section-title">{t("method.indexTitle")}</h2>
          <p className="prose">{t("method.index")}</p>
          <div className="cards cards--compact">
            {Object.entries(model.data.indice.dimensions).map(([k, d]) => (
              <article key={k} className="card">
                <p className="eyebrow">{t("method.weight", { w: fmt(model.data.indice.meta.poids_dimensions[k] * 100, 0) })}</p>
                <h3>{d.label}</h3>
                <ul>
                  {d.indicateurs.map((i) => (
                    <li key={i.col}>{i.label}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <p className="prose">
            {t("method.indexRobust", {
              acp: fmt(model.data.indice.meta.spearman_variantes.acp, 2),
              ent: fmt(model.data.indice.meta.spearman_variantes.entropie, 2),
              width: fmt(model.data.indice.meta.rang_moyen_largeur_p05_p95, 0),
            })}
          </p>
          <h2 className="section-title">{t("method.modelTitle")}</h2>
          <p className="prose">{t("method.model")}</p>
        </section>
      )}

      {quality.status === "ready" && (() => {
        const q = quality.data.rapport;
        return (
          <section aria-labelledby="quality-title">
            <h2 id="quality-title" className="section-title">{t("method.qualityTitle")}</h2>
            <dl className="kf-grid kf-grid--wide">
              <div className="kf"><dt>{t("method.qControls")}</dt><dd>{q.valeurs_controle.ok}/{q.valeurs_controle.total}</dd></div>
              <div className="kf"><dt>{t("method.qValues")}</dt><dd>{fmt(q.valeurs_extraites, 0)}</dd></div>
              <div className="kf"><dt>{t("method.qSums")}</dt><dd>{fmt(q.sommes.taux_ok * 100, 1, "%")}</dd></div>
              <div className="kf"><dt>{t("method.qRates")}</dt><dd>{fmt(q.taux.taux_ok * 100, 1, "%")}</dd></div>
              <div className="kf"><dt>{t("method.qFlux")}</dt><dd>{fmt(q.flux_somme_100.taux_ok * 100, 1, "%")}</dd></div>
              <div className="kf"><dt>{t("method.qEditions")}</dt><dd>{fmt(q.historiques_entre_editions.taux_identiques * 100, 1, "%")}</dd></div>
            </dl>
            <p className="prose">
              {t("method.qAbandon", {
                n: q.abandon_publie_nul.n,
                k: q.abandon_publie_nul.dont_reconstitue_negatif_ou_nul,
                red: fmt(q.reconstitution_vs_publie.taux_redoublement.part_ecart_inf_0_15_pt * 100, 0),
                ab: fmt(q.reconstitution_vs_publie.taux_abandon.part_ecart_inf_0_15_pt * 100, 0),
              })}
            </p>
            <div className="table-scroll">
              <table className="mini">
                <caption>{t("method.controlsCaption")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("method.control")}</th>
                    <th scope="col" className="num">{t("method.expected")}</th>
                    <th scope="col" className="num">{t("method.obtained")}</th>
                    <th scope="col" className="num">{t("method.page")}</th>
                  </tr>
                </thead>
                <tbody>
                  {quality.data.controles.map((c) => (
                    <tr key={c.controle}>
                      <th scope="row">{c.ok ? "✓ " : "✗ "}{c.controle}</th>
                      <td className="num">{fmt(c.attendu, c.attendu % 1 ? 1 : 0)}</td>
                      <td className="num">{fmt(c.obtenu, c.attendu % 1 ? 1 : 0)}</td>
                      <td className="num">{c.page}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="link-btn" aria-expanded={showLog} onClick={() => setShowLog(!showLog)}>
              {showLog ? t("method.hideLog") : t("method.showLog", { n: quality.data.journal.length })}
            </button>
            {showLog && (
              <div className="table-scroll">
                <table className="mini">
                  <thead>
                    <tr>
                      <th scope="col">{t("method.edition")}</th>
                      <th scope="col">{t("method.table")}</th>
                      <th scope="col" className="num">{t("method.page")}</th>
                      <th scope="col">{t("method.message")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quality.data.journal.map((j, i) => (
                      <tr key={i}>
                        <td>{j.edition}</td>
                        <td>{j.table}</td>
                        <td className="num">{j.page ?? "—"}</td>
                        <td>{j.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })()}

      <section aria-labelledby="limits2-title">
        <h2 id="limits2-title" className="section-title">{t("method.limitsTitle")}</h2>
        <ul className="prose-list">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <li key={i}>{t(`method.limit${i}`)}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
