import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { loadCore, useLoad } from "./data/load";
import { t } from "./i18n";
import { type AppState, type View, parseHash, toHash } from "./lib/url";
import { applyScenario, clearScenario, loadStoredScenario, storeScenario } from "./lib/scenario";
import { nextYear, shortYear } from "./lib/format";
import type { ScenarioResult } from "../engine/types";
import Anticipate from "./views/Anticipate";
import Method from "./views/Method";
import Understand from "./views/Understand";

// La carte (MapLibre, ~250 Ko compressés) n'est chargée qu'à l'ouverture de la vue Explorer.
const Explore = lazy(() => import("./views/Explore"));
// La vue de mise à jour embarque le moteur de validation : elle n'est chargée qu'à l'ouverture.
const Update = lazy(() => import("./views/Update"));

const VIEWS: View[] = ["comprendre", "explorer", "anticiper", "methode", "maj"];
type Theme = "light" | "dark";

function initialTheme(): Theme {
  const saved = typeof localStorage !== "undefined" ? localStorage.getItem("theme") : null;
  if (saved === "light" || saved === "dark") return saved;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function App() {
  const core = useLoad(loadCore);
  const [state, setState] = useState<AppState>(() => parseHash(location.hash));
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [scenario, setScenario] = useState<ScenarioResult | null>(loadStoredScenario);

  // Version mise à jour : un scénario enregistré n'est appliqué que s'il correspond à la référence chargée.
  const baseCore = core.status === "ready" ? core.data : null;
  const valid = baseCore && scenario && [baseCore.meta.derniere_annee, nextYear(baseCore.meta.derniere_annee)].includes(scenario.annee) ? scenario : null;
  const effective = useMemo(() => (baseCore && valid ? applyScenario(baseCore, valid) : baseCore), [baseCore, valid]);
  const apply = useCallback((res: ScenarioResult, jobId: string | null) => { storeScenario(res, jobId); setScenario(res); }, []);
  const reset = useCallback(() => { clearScenario(); setScenario(null); }, []);

  useEffect(() => {
    const onHash = () => setState(parseHash(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  const set = useCallback((patch: Partial<AppState>) => {
    setState((s) => {
      const next = { ...s, ...patch };
      const hash = toHash(next);
      if (hash !== location.hash) {
        if (patch.view && patch.view !== s.view) history.pushState(null, "", hash);
        else history.replaceState(null, "", hash);
      }
      return next;
    });
    if (patch.view) window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    document.title = `${t(`nav.${state.view}`)} · ${t("app.title")}`;
  }, [state.view]);

  return (
    <div className={`app view-${state.view}${valid ? " has-scenario" : ""}`}>
      <a className="skip" href="#main">
        {t("app.skip")}
      </a>
      <header className="topbar">
        <a className="brand" href="#/comprendre" onClick={(e) => (e.preventDefault(), set({ view: "comprendre" }))}>
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-text">
            <strong>{t("app.title")}</strong>
            <span>{t("app.subtitle")}</span>
          </span>
        </a>
        <nav aria-label={t("nav.label")}>
          <ul>
            {VIEWS.map((v, i) => (
              <li key={v}>
                <a
                  href={`#/${v}`}
                  aria-current={state.view === v ? "page" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    set({ view: v });
                  }}
                >
                  <span className="nav-num" aria-hidden="true">{i + 1}</span>
                  <span className="nav-full">{t(`nav.${v}`)}</span>
                  <span className="nav-short" aria-hidden="true">{t(`nav.short.${v}`)}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <button
          type="button"
          className="icon-btn theme-btn"
          aria-label={theme === "dark" ? t("app.light") : t("app.dark")}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? (
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.2" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 9.8A5.8 5.8 0 0 1 6.2 2.5a5.8 5.8 0 1 0 7.3 7.3z" /></svg>
          )}
        </button>
      </header>

      {valid && (
        <aside className="scenario-banner" role="status">
          <strong>{t("update.bannerTitle")}</strong>
          <span>{t("update.bannerText", { year: shortYear(valid.annee), cible: shortYear(valid.cible) })}</span>
          <button type="button" className="link-btn" onClick={() => set({ view: "maj" })}>{t("update.bannerOpen")}</button>
          <button type="button" className="link-btn" onClick={reset}>{t("update.bannerReset")}</button>
        </aside>
      )}

      <main id="main" tabIndex={-1}>
        {core.status === "loading" && <p className="status" role="status">{t("app.loading")}</p>}
        {core.status === "error" && <p className="status status--error" role="alert">{t("app.error", { e: core.error })}</p>}
        {core.status === "ready" && effective && (
          <>
            {state.view === "comprendre" && <Understand core={effective} go={set} />}
            {state.view === "explorer" && (
              <Suspense fallback={<p className="status" role="status">{t("app.loadingMap")}</p>}>
                <Explore core={effective} state={state} set={set} theme={theme} />
              </Suspense>
            )}
            {state.view === "anticiper" && <Anticipate core={effective} state={state} go={set} />}
            {state.view === "methode" && <Method core={effective} />}
            {state.view === "maj" && (
              <Suspense fallback={<p className="status" role="status">{t("app.loading")}</p>}>
                <Update baseCore={core.data} scenario={valid} onApply={apply} onClear={reset} go={set} />
              </Suspense>
            )}
          </>
        )}
      </main>

      {state.view !== "explorer" && core.status === "ready" && effective && (
        <footer className="footer">
          <p>{t("footer.sources")}</p>
          <p>{t("footer.generated", { date: effective.meta.genere_le })}</p>
        </footer>
      )}
    </div>
  );
}
