import { LineChart } from "../components/charts";
import type { Core } from "../data/types";
import { t } from "../i18n";
import { fmt, shortYear } from "../lib/format";
import type { AppState } from "../lib/url";

export default function Understand({ core, go }: { core: Core; go: (patch: Partial<AppState>) => void }) {
  const k = core.meta.chiffres_cles;
  const nat = core.values.national;
  const years = core.meta.annees.slice(0, -1);
  const nProv = Object.keys(core.meta.unites.prov).length;
  // Régions qui comptent le plus de provinces en alerte à l'horizon de prévision.
  const byReg: Record<string, number> = {};
  for (const [code, r] of Object.entries(core.risk.prov)) {
    if ((r.prediction[core.meta.horizon]?.p_alerte ?? 0) >= 0.5) {
      const reg = core.meta.unites.prov[code].reg_nom;
      byReg[reg] = (byReg[reg] ?? 0) + 1;
    }
  }
  const regs = Object.entries(byReg)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr"))
    .slice(0, 5)
    .map(([r, n]) => `${r} (${n})`)
    .join(", ");
  const yi = (y: string) => core.meta.annees.indexOf(y);
  const preCrisis = Math.max(...nat.effectif.filter((v, i): v is number => v !== null && i <= yi("2021-2022")));
  return (
    <div className="page understand">
      <section className="hero">
        <p className="eyebrow">{t("understand.kicker", { year: shortYear(k.annee) })}</p>
        <h1 className="hero-title">
          {t("understand.heroA", { max: k.tap_max.nom, vmax: fmt(k.tap_max.valeur, 1, "%") })}
          <br />
          <span className="accent">{t("understand.heroB", { min: k.tap_min.nom, vmin: fmt(k.tap_min.valeur, 1, "%") })}</span>
        </h1>
        <p className="lede">{t("understand.lede", { ratio: fmt(k.ecart_tap, 0), max: k.tap_max.nom, min: k.tap_min.nom })}</p>
        <div className="hero-actions">
          <button type="button" className="btn" onClick={() => go({ view: "explorer", layer: "prediction" })}>
            {t("understand.ctaMap")}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => go({ view: "anticiper" })}>
            {t("understand.ctaForecast")}
          </button>
        </div>
      </section>

      <section className="messages" aria-labelledby="messages-title">
        <h2 id="messages-title" className="section-title">
          {t("understand.messagesTitle")}
        </h2>
        <ol className="message-list">
          <li>
            <p className="message-figure">{fmt(Math.abs(k.baisse_effectif), 0)}</p>
            <h3>{t("understand.m1Title")}</h3>
            <p>
              {t("understand.m1", {
                y1: shortYear("2021-2022"),
                y2: shortYear("2022-2023"),
                e1: fmt(k.effectif_2021, 0),
                e2: fmt(k.effectif_2022, 0),
                emax: fmt(k.ecoles_max, 0),
                ymax: shortYear(k.annee_ecoles_max),
                emin: fmt(k.ecoles_min, 0),
                ymin: shortYear(k.annee_ecoles_min),
              })}
            </p>
          </li>
          <li>
            <p className="message-figure">
              {fmt(k.tap_nat_2017, 1)} → {fmt(k.tap_nat_last, 1)}
              <small>%</small>
            </p>
            <h3>{t("understand.m2Title")}</h3>
            <p>{t(k.effectif_last >= preCrisis ? "understand.m2a" : "understand.m2b", { y0: shortYear("2017-2018"), y1: shortYear(k.annee), last: fmt(k.effectif_last, 0) })}</p>
          </li>
          <li>
            <p className="message-figure">
              {k.provinces_alerte}
              <small>/{nProv}</small>
            </p>
            <h3>{t("understand.m3Title")}</h3>
            <p>{t("understand.m3", { n: k.provinces_alerte, total: nProv, seuil: fmt(k.seuil_alerte, 0), horizon: shortYear(core.meta.horizon), regs })}</p>
          </li>
        </ol>
      </section>

      <section className="national" aria-labelledby="national-title">
        <h2 id="national-title" className="section-title">
          {t("understand.nationalTitle")}
        </h2>
        <div className="chart-row">
          <LineChart title={t("understand.chartPupils")} years={years} series={[{ label: t("sheet.pupils"), values: nat.effectif.slice(0, -1), color: "var(--ink)" }]} width={300} height={130} />
          <LineChart title={t("understand.chartSchools")} years={years} series={[{ label: t("sheet.schools"), values: nat.ecoles.slice(0, -1), color: "var(--ink)" }]} width={300} height={130} />
          <LineChart
            title={t("understand.chartCompletion")}
            years={years}
            unit="%"
            decimals={1}
            series={[
              { label: t("sheet.girls"), values: nat.tap_f.slice(0, -1), color: "#B4462C" },
              { label: t("sheet.boys"), values: nat.tap_g.slice(0, -1), color: "#1C4C68", dash: true },
            ]}
            width={300}
            height={130}
          />
          <LineChart
            title={t("understand.chartDropout")}
            years={years}
            unit="%"
            decimals={1}
            refLine={{ value: k.seuil_alerte, label: t("sheet.threshold") }}
            series={[{ label: t("sheet.dropout"), values: nat.deperdition_obs.slice(0, -1), color: "var(--accent)" }]}
            width={300}
            height={130}
          />
        </div>
        <p className="note">{t("understand.nationalNote")}</p>
      </section>

      <section className="howto" aria-labelledby="howto-title">
        <h2 id="howto-title" className="section-title">
          {t("understand.howtoTitle")}
        </h2>
        <ol className="howto-list">
          {[1, 2, 3, 4].map((i) => (
            <li key={i}>
              <h3>{t(`understand.how${i}Title`)}</h3>
              <p>{t(`understand.how${i}`)}</p>
            </li>
          ))}
        </ol>
        <p className="note">{t("understand.reform")}</p>
      </section>
    </div>
  );
}
