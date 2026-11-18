import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { parseCsv, parseNumber, toCsv } from "../../engine/csv";
import { INPUT_COLUMNS } from "../../engine/types";
import type { InputColumn, Issue, Num, ScenarioResult, ValidationContext } from "../../engine/types";
import { REQUIRED, validateUpload } from "../../engine/validate";
import { IntervalBar } from "../components/charts";
import type { Core } from "../data/types";
import { t } from "../i18n";
import { fetchStatus, getJob, requestReport, startJob, waitForJob } from "../lib/api";
import type { ApiStatus, Job, Report } from "../lib/api";
import { download } from "../lib/exporters";
import { fmt, fmtDelta, nextYear, shortYear } from "../lib/format";
import { PALETTES } from "../lib/palettes";
import { loadStoredJobId } from "../lib/scenario";
import type { AppState } from "../lib/url";

interface Props {
  /** Données de référence : la validation se fait toujours contre elles, même quand un scénario est affiché. */
  baseCore: Core;
  scenario: ScenarioResult | null;
  onApply: (res: ScenarioResult, jobId: string | null) => void;
  onClear: () => void;
  go: (patch: Partial<AppState>) => void;
}

const LEVELS = ["Très faible", "Faible", "Modéré", "Élevé", "Très élevé"];
const STRUCTURAL: InputColumn[] = ["part_rurale", "part_prive", "pauvrete"];

// ---------------------------------------------------------------------------- petits composants

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|_[^_]+_)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.length > 2 && part.startsWith("_") && part.endsWith("_")) return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** Rendu minimal du Markdown produit par le gabarit et par l'IA : titres, listes, gras, italique (aucun HTML brut). */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`u${blocks.length}`}>{list.map((x, i) => <li key={i}>{inline(x)}</li>)}</ul>);
    list = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) { list.push(li[1]); continue; }
    flush();
    if (h) blocks.push(h[1].length === 1 ? <h3 key={blocks.length}>{inline(h[2])}</h3> : <h4 key={blocks.length}>{inline(h[2])}</h4>);
    else if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="md">{blocks}</div>;
}

function IssueList({ issues, kind, max = 10 }: { issues: Issue[]; kind: "erreur" | "avertissement"; max?: number }) {
  const list = issues.filter((i) => i.niveau === kind);
  if (!list.length) return null;
  return (
    <div className={`issues issues--${kind}`}>
      <h4>{kind === "erreur" ? t("update.valErrors") : t("update.valWarnings")}</h4>
      <ul>
        {list.slice(0, max).map((i, k) => (
          <li key={k}>
            {i.ligne ? <span className="muted">{t("update.line", { n: i.ligne })} · </span> : null}
            {i.message}
          </li>
        ))}
        {list.length > max && <li className="muted">{t("update.moreIssues", { n: list.length - max })}</li>}
      </ul>
    </div>
  );
}

function stepIndex(job: Job | null, sent: boolean): number {
  if (!sent) return -1;
  if (!job) return 0;
  if (job.statut === "termine") return 3;
  if (/Calcul/.test(job.etape)) return 2;
  if (/Validation/.test(job.etape)) return 1;
  return 0;
}

function textBlob(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  download(name, url);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------------------- vue

export default function Update({ baseCore, scenario, onApply, onClear, go }: Props) {
  const meta = baseCore.meta;
  const last = meta.derniere_annee;
  const base = import.meta.env.BASE_URL;

  const [status, setStatus] = useState<ApiStatus | null | "loading">("loading");
  const [fallback, setFallback] = useState<NonNullable<ValidationContext["fallback"]>>({});
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [over, setOver] = useState(false);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "failed">(scenario ? "done" : "idle");
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScenarioResult | null>(scenario);
  const [jobId, setJobId] = useState<string | null>(scenario ? loadStoredJobId() : null);
  const [report, setReport] = useState<Report | null>(null);
  const [writing, setWriting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    fetchStatus(ctl.signal).then((s) => setStatus(s));
    fetch(`${base}data/modele_mise_a_jour.csv`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.text() : ""))
      .then((text) => {
        const csv = parseCsv(text);
        const col = (c: string) => csv.header.indexOf(c);
        const map: NonNullable<ValidationContext["fallback"]> = {};
        for (const row of csv.rows) {
          const code = row[col("code")];
          if (!code) continue;
          map[code] = Object.fromEntries(STRUCTURAL.map((c) => [c, col(c) >= 0 ? (parseNumber(row[col(c)] ?? "") as Num) : null]));
        }
        setFallback(map);
      })
      .catch(() => undefined);
    return () => ctl.abort();
  }, [base]);

  // Une version mise à jour déjà affichée : on retrouve son rapport sur le serveur (conservé 2 jours).
  useEffect(() => {
    if (!scenario || !jobId || report) return;
    let alive = true;
    getJob(jobId).then((j) => alive && j?.rapport && setReport(j.rapport)).catch(() => undefined);
    return () => { alive = false; };
  }, [scenario, jobId, report]);

  const ctx = useMemo<ValidationContext>(() => ({ codes: Object.keys(meta.unites.prov), lastYear: last, fallback }), [meta, last, fallback]);
  const validation = useMemo(() => (file ? validateUpload(file.text, ctx) : null), [file, ctx]);
  const names = meta.unites.prov;
  const serviceUp = status !== "loading" && status !== null;

  const readFile = useCallback(async (f: File | undefined | null) => {
    if (!f) return;
    setFile({ name: f.name, text: await f.text() });
    setPhase("idle");
    setError(null);
  }, []);

  const run = useCallback(async () => {
    if (!file || !validation?.ok) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setPhase("running");
    setError(null);
    setJob(null);
    setReport(null);
    setReportError(null);
    try {
      const id = await startJob(file.text);
      setJobId(id);
      const j = await waitForJob(id, { signal: ctl.signal, onUpdate: setJob });
      setJob(j);
      if (j.statut === "termine" && j.resultat) {
        setResult(j.resultat);
        setReport(j.rapport ?? null);
        setPhase("done");
      } else {
        setPhase("failed");
        setError(j.statut === "refuse" ? t("update.refused", { msg: j.message ?? "" }) : t("update.failed", { msg: j.message ?? "" }));
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setPhase("failed");
      setError(t("update.failed", { msg: (e as Error).message }));
    }
  }, [file, validation]);

  useEffect(() => () => abort.current?.abort(), []);

  const writeReport = useCallback(async () => {
    if (!jobId) return;
    setWriting(true);
    setReportError(null);
    try {
      const r = await requestReport(jobId);
      if (r) setReport(r);
    } catch (e) {
      setReportError((e as Error).message);
    } finally {
      setWriting(false);
    }
  }, [jobId]);

  const rows = useMemo(() => {
    if (!result) return [];
    return Object.entries(result.provinces).sort((a, b) => b[1].prediction.valeur - a[1].prediction.valeur);
  }, [result]);

  const downloadResults = () => {
    if (!result) return;
    const head = ["code", "province", "region", "situation", "anticipation", "indice", "niveau", "rang_indice", "rang_indice_reference",
      "deperdition_anticipee_pct", "ic80_bas", "ic80_haut", "proba_alerte", "rang_prevision", "priorite", "facteurs_indice", "facteurs_modele"];
    const body = rows.map(([code, r]) => [code, names[code]?.nom ?? code, names[code]?.reg_nom ?? "", result.annee, result.cible, r.indice.score,
      LEVELS[r.indice.classe - 1], r.indice.rang, r.reference.indice?.rang ?? null, r.prediction.valeur, r.prediction.ic80[0], r.prediction.ic80[1],
      r.prediction.p_alerte, r.prediction.rang, r.reco.priorite, r.indice.facteurs, r.prediction.facteurs]);
    textBlob(`recalcul_${result.annee}.csv`, `\uFEFF${toCsv(head, body)}`, "text/csv;charset=utf-8");
  };

  const copyReport = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.texte);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setReportError("Copie impossible : sélectionnez le texte à la main.");
    }
  };

  const sent = phase === "running" || phase === "done" || phase === "failed";
  const current = stepIndex(job, sent);
  const steps = [t("update.stepSent"), t("update.stepValid"), t("update.stepCalc"), t("update.stepDone")];
  const active = scenario !== null && result?.empreinte === scenario.empreinte;
  const colsHelp: { name: string; text: string; req: boolean }[] = [
    { name: "code", text: t("update.colCode"), req: true },
    { name: "annee_scolaire", text: t("update.colYear"), req: true },
    ...INPUT_COLUMNS.map((c) => ({ name: c, text: t(`update.col_${c}`), req: REQUIRED.includes(c) })),
  ];

  return (
    <div className="page update">
      <header className="page-head">
        <p className="eyebrow">{t("update.kicker")}</p>
        <h1 className="page-title">{t("update.title")}</h1>
        <p className="lede">{t("update.lede")}</p>
        <ul className="service-row" aria-label={t("update.service")}>
          <li>
            <span className={`dot ${serviceUp ? "dot--on" : status === "loading" ? "" : "dot--off"}`} aria-hidden="true" />
            <strong>{t("update.service")}</strong> : {status === "loading" ? t("update.checking") : serviceUp ? t("update.serviceOn") : t("update.serviceOff")}
          </li>
          <li>
            <span className={`dot ${serviceUp && status.llm.actif ? "dot--on" : "dot--off"}`} aria-hidden="true" />
            <strong>{t("update.llm")}</strong> : {status === "loading" ? t("update.checking") : serviceUp && status.llm.actif ? t("update.llmOn", { modele: status.llm.modele }) : t("update.llmOff")}
          </li>
        </ul>
      </header>

      <section aria-labelledby="up-s1">
        <h2 id="up-s1" className="section-title">{t("update.s1Title")}</h2>
        <p className="prose">{t("update.s1Text", { year: shortYear(last), next: shortYear(nextYear(last)) })}</p>
        <p>
          <a className="btn btn--ghost" href={`${base}data/modele_mise_a_jour.csv`} download="modele_mise_a_jour.csv">{t("update.s1Link")}</a>
          {" "}
          <a className="link-btn" href={`${base}data/exemple_fictif_${nextYear(last)}.csv`} download>{t("update.s1Demo", { year: shortYear(nextYear(last)) })}</a>
        </p>
        <details className="cols">
          <summary>{t("update.colsTitle")}</summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th scope="col">{t("update.colName")}</th><th scope="col">{t("update.colMeaning")}</th><th scope="col">{t("update.colRequired")}</th></tr>
              </thead>
              <tbody>
                {colsHelp.map((c) => (
                  <tr key={c.name}>
                    <th scope="row"><code>{c.name}</code></th>
                    <td>{c.text}</td>
                    <td>{c.req ? t("update.yes") : t("update.no")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section aria-labelledby="up-s2">
        <h2 id="up-s2" className="section-title">{t("update.s2Title")}</h2>
        <p className="prose">{t("update.s2Text")}</p>
        <div
          className={`dropzone${over ? " is-over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); void readFile(e.dataTransfer.files[0]); }}
        >
          <label className="btn">
            {t("update.choose")}
            <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => void readFile(e.target.files?.[0])} />
          </label>
          <span className="muted"> {t("update.dropHere")}</span>
          {file && <p className="muted file-name">{t("update.fileName", { name: file.name })}</p>}
        </div>
        {validation && (
          <div aria-live="polite">
            {validation.ok && validation.annee && (
              <p className="valid-line">
                {t("update.valOk", { n: validation.rows.length, year: shortYear(validation.annee), kind: validation.type === "correction" ? t("update.kindCorrection") : t("update.kindNew") })}
              </p>
            )}
            <IssueList issues={validation.issues} kind="erreur" />
            <IssueList issues={validation.issues} kind="avertissement" />
          </div>
        )}
      </section>

      <section aria-labelledby="up-s3">
        <h2 id="up-s3" className="section-title">{t("update.s3Title")}</h2>
        <p>
          <button type="button" className="btn" disabled={!validation?.ok || !serviceUp || phase === "running"} onClick={() => void run()}>
            {phase === "running" ? t("update.running") : t("update.run")}
          </button>
        </p>
        {!serviceUp && status !== "loading" && <p className="note">{t("update.offlineHint")}</p>}
        {sent && (
          <ol className="progress" aria-live="polite">
            {steps.map((s, i) => (
              <li key={s} className={i < current || (phase === "done" && i <= current) ? "is-done" : i === current ? "is-current" : ""}>
                <span aria-hidden="true">{i < current || (phase === "done" && i <= current) ? "✓" : i === current ? "…" : "·"}</span> {s}
              </li>
            ))}
          </ol>
        )}
        {error && (
          <div role="alert" className="issues issues--erreur">
            <p>{error}</p>
            {job?.erreurs && <IssueList issues={job.erreurs} kind="erreur" />}
          </div>
        )}
      </section>

      {result && (
        <section aria-labelledby="up-s4">
          <h2 id="up-s4" className="section-title">{t("update.s4Title")}</h2>
          <div className="cards cards--compact">
            <div className="card">
              <p className="eyebrow">{t("update.sumAlert", { cible: shortYear(result.cible) })}</p>
              <p className="big">{result.resume.n_alerte} <small>/ {result.resume.n_provinces}</small></p>
              <p className="note">{result.resume.n_alerte_reference === null ? t("update.sumRefNone") : t("update.sumRef", { n: result.resume.n_alerte_reference })}</p>
            </div>
            <div className="card">
              <p className="eyebrow">{t("update.sumMean")}</p>
              <p className="big">{fmt(result.resume.prediction_moyenne, 1, "%")}</p>
              <p className="note">{result.resume.prediction_moyenne_reference === null ? t("update.sumRefNone") : t("update.sumMeanRef", { v: fmt(result.resume.prediction_moyenne_reference, 1) })}</p>
            </div>
            {result.verification && (
              <div className="card">
                <p className="eyebrow">{t("update.backTitle")}</p>
                <p className="note">
                  {t("update.backText", {
                    year: shortYear(result.annee), n: result.verification.n, mae: fmt(result.verification.mae, 1), biais: fmtDelta(result.verification.biais, 1, "pt"),
                    rho: fmt(result.verification.spearman, 2), tp: result.verification.alertes.vrai_positif, fp: result.verification.alertes.faux_positif, fn: result.verification.alertes.faux_negatif,
                  })}
                </p>
              </div>
            )}
          </div>

          <IssueList issues={result.avertissements} kind="avertissement" max={6} />

          <h3 className="sub-title">{t("update.tableTitle")}</h3>
          <div className="table-scroll">
            <table className="forecast">
              <caption className="sr-only">{t("update.tableTitle")}</caption>
              <thead>
                <tr>
                  <th scope="col" className="num">#</th>
                  <th scope="col">{t("update.colProvince")}</th>
                  <th scope="col" className="num">{t("update.colValue", { cible: shortYear(result.cible) })}</th>
                  <th scope="col" className="interval-col">{t("update.colInterval")}</th>
                  <th scope="col" className="num">{t("update.colProba")}</th>
                  <th scope="col">{t("update.colLevel")}</th>
                  <th scope="col" className="num">{t("update.colRank")}</th>
                  <th scope="col">{t("update.colFactors")}</th>
                </tr>
              </thead>
              <tbody>
                {(showAll ? rows : rows.slice(0, 10)).map(([code, r], i) => (
                  <tr key={code}>
                    <td className="num">{i + 1}</td>
                    <th scope="row">{names[code]?.nom ?? code}<small className="muted"> {names[code]?.reg_nom}</small></th>
                    <td className="num">{fmt(r.prediction.valeur, 1, "%")}</td>
                    <td className="interval-col">
                      <IntervalBar value={r.prediction.valeur} lo={r.prediction.ic80[0]} hi={r.prediction.ic80[1]} max={40} color={PALETTES.seq_risk[3]} mark={result.moteur.alerte} />
                    </td>
                    <td className={`num${r.prediction.p_alerte >= 0.5 ? " is-worse" : ""}`}>{fmt(r.prediction.p_alerte * 100, 0, "%")}</td>
                    <td>{LEVELS[r.indice.classe - 1]}</td>
                    <td className="num">{r.reference.indice ? t("update.rankFrom", { from: r.reference.indice.rang, to: r.indice.rang }) : r.indice.rang}</td>
                    <td className="factors">{r.prediction.facteurs || r.indice.facteurs || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="control-row">
            <button type="button" className="link-btn" onClick={() => setShowAll(!showAll)}>{showAll ? t("update.showLess") : t("update.showAll")}</button>
          </div>

          <div className="actions">
            <button type="button" className="btn" onClick={() => { onApply(result, jobId); go({ view: "explorer", layer: "prediction", scale: "prov", year: result.cible, sel: null }); }}>
              {t("update.applyBtn")}
            </button>
            <button type="button" className="btn btn--ghost" onClick={downloadResults}>{t("update.csvBtn")}</button>
            {scenario && <button type="button" className="btn btn--ghost" onClick={() => { onClear(); setResult(null); setReport(null); setPhase("idle"); setJobId(null); }}>{t("update.resetBtn")}</button>}
          </div>
          {active && <p className="note">{t("update.applied")}</p>}
        </section>
      )}

      {result && (
        <section aria-labelledby="up-s5">
          <h2 id="up-s5" className="section-title">{t("update.s5Title")}</h2>
          {report ? (
            <>
              <p className="note" aria-live="polite">
                {report.source === "llm" ? t("update.reportLlm", { modele: report.modele ?? "" }) : t("update.reportGabarit")}
                {report.source === "llm" && report.verification && (report.verification.ok ? ` ${t("update.reportChecked")}` : ` ${t("update.reportUnchecked", { list: report.verification.inconnus.join(", ") })}`)}
              </p>
              {report.message && report.source !== "llm" && <p className="note">{report.message}</p>}
              <article className="report"><Markdown text={report.texte} /></article>
              <div className="actions">
                <button type="button" className="btn btn--ghost" onClick={() => void copyReport()}>{copied ? t("update.reportCopied") : t("update.reportCopy")}</button>
                <button type="button" className="btn btn--ghost" onClick={() => textBlob(`rapport_${result.annee}.md`, report.texte, "text/markdown;charset=utf-8")}>{t("update.reportDownload")}</button>
              </div>
            </>
          ) : (
            <p className="note">{t("update.reportGabarit")}</p>
          )}
          <p>
            <button type="button" className="btn" disabled={!jobId || !serviceUp || !status.llm.actif || writing} onClick={() => void writeReport()}>
              {writing ? t("update.reportWriting") : t("update.reportWrite")}
            </button>
            {serviceUp && !status.llm.actif && <span className="note"> {t("update.reportNoLlm")}</span>}
          </p>
          {reportError && <p role="alert" className="note is-worse">{reportError}</p>}
        </section>
      )}

      <section aria-labelledby="up-notes">
        <h2 id="up-notes" className="section-title">{t("update.notesTitle")}</h2>
        <ul className="prose">
          {["note1", "note2", "note3", "note4"].map((k) => <li key={k}>{t(`update.${k}`)}</li>)}
        </ul>
      </section>
    </div>
  );
}
