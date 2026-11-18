"""Génère la note technique (docs/note_technique.md, .html, .pdf) et docs/recommandations.md.

Tous les chiffres sont lus dans les sorties du pipeline (outputs/, web/public/data) : le
gabarit docs/note_technique.tpl.md ne contient aucune valeur codée en dur. Le PDF est
produit par Chrome ou Edge sans interface ; la note doit tenir en 15 pages au plus.

Usage : python -m docs.build_note
"""

from __future__ import annotations

import datetime as dt
import json
import os
import shutil
import subprocess
from collections import Counter
from pathlib import Path

import markdown
import pandas as pd
import pymupdf

from pipeline.config import OUTPUTS_DIR, ROOT
from pipeline.geo import new_provinces, new_regions

DOCS = ROOT / "docs"
FIG = OUTPUTS_DIR / "figures"
MDIR = OUTPUTS_DIR / "model"
TABLES = OUTPUTS_DIR / "tables"
QDIR = OUTPUTS_DIR / "quality"
WEB = ROOT / "web" / "public" / "data"
MAX_PAGES = 15
FIGDIR = DOCS / "figures"
# Figures de la note : produites par pipeline/figures.py et par web/scripts/check.mjs (capture de
# l'application), copiées dans docs/figures pour que la note versionnée reste lisible.
FIGURES = {"reforme": "reforme.png", "reconstruction": "reconstruction.png", "national": "series_nationales.png",
           "contexte": "cartes_contexte.png", "validation": "validation.png", "prevision": "carte_prevision.png",
           "app": "application_explorer.png"}
FIG_SOURCES = {"application_explorer.png": OUTPUTS_DIR / "screens" / "explorer_fiche.png"}


def collect_figures() -> None:
    FIGDIR.mkdir(parents=True, exist_ok=True)
    for name in FIGURES.values():
        src = FIG_SOURCES.get(name, FIG / name)
        if src.exists():
            shutil.copyfile(src, FIGDIR / name)
        elif not (FIGDIR / name).exists():
            raise SystemExit(f"figure manquante : {src} (lancer python -m pipeline figures et npm --prefix web run check)")
MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre",
          "novembre", "décembre"]
MODEL_NAMES = {"persistance": "Persistance (an passé)", "moyenne_historique": "Moyenne historique de la province",
               "ridge": "Régression ridge", "huber": "Régression de Huber", "mediane": "Régression médiane",
               "gbr": "Gradient boosting"}


def n(x, d=0) -> str:
    """Nombre au format français (espace fine insécable, virgule décimale)."""
    if x is None or (isinstance(x, float) and pd.isna(x)):
        return "—"
    s = f"{x:,.{d}f}".replace(",", "\u202f").replace(".", ",")
    return s.replace("-", "\u2212")


def year_short(y: str) -> str:
    return f"{y[:4]}-{y[7:9]}"


def metric(rows: list[dict], name: str, key: str):
    for r in rows:
        if r["modele"] == name and r.get(key) is not None and not pd.isna(r.get(key)):
            return r[key]
    return None


def context() -> dict:
    meta = json.loads((WEB / "meta.json").read_text(encoding="utf-8"))
    risk = json.loads((WEB / "risk.json").read_text(encoding="utf-8"))
    q = json.loads((QDIR / "rapport_qualite.json").read_text(encoding="utf-8"))
    s = json.loads((MDIR / "resume_modele.json").read_text(encoding="utf-8"))
    im = json.loads((MDIR / "indice_meta.json").read_text(encoding="utf-8"))["prov"]
    log = pd.read_csv(TABLES / "journal_extraction.csv", sep=";")
    k = meta["chiffres_cles"]
    prov = new_provinces().set_index("prov_code")
    reg = new_regions().set_index("reg_code").reg_name
    horizon, last = meta["horizon"], meta["derniere_annee"]
    mt, ms = s["metriques_temporelles"], s["metriques_spatiales"]
    chosen = s["selection"]["retenu"]

    # Tableau des métriques.
    rows = []
    for name in ["persistance", "moyenne_historique", "ridge", "huber", "mediane", "gbr"]:
        label = MODEL_NAMES[name] + (" **(retenu)**" if name == chosen else "")
        rows.append(f"| {label} | {n(metric(mt, name, 'MAE'), 2)} | {n(metric(mt, name, 'Spearman'), 2)} | "
                    f"{n(metric(ms, name, 'MAE'), 2)} | {n(metric(ms, name, 'Spearman'), 2)} |")
    naive_t = min(metric(mt, "persistance", "MAE"), metric(mt, "moyenne_historique", "MAE"))
    naive_s = min(metric(ms, "persistance", "MAE"), metric(ms, "moyenne_historique", "MAE"))
    gain = (1 - metric(mt, chosen, "MAE") / naive_t) * 100
    g_t, g_s = metric(mt, "gbr", "MAE"), metric(ms, "gbr", "MAE")
    if s["selection"]["arbres_retenus"]:
        trees = "Le gradient boosting est retenu : il bat nettement les autres modèles dans les deux validations."
    else:
        best_lin_t = metric(mt, chosen, "MAE")
        trees = (f"Le gradient boosting n'est pas retenu : en validation temporelle, sa MAE ({n(g_t, 2)}) ne fait pas "
                 f"5 % mieux que la meilleure référence ({n(naive_t, 2)}) et que le modèle retenu ({n(best_lin_t, 2)})"
                 + (f", bien qu'il soit le meilleur en validation spatiale ({n(g_s, 2)} contre {n(naive_s, 2)} pour la "
                    "meilleure référence)." if g_s < metric(ms, chosen, "MAE") else "."))

    # Prévisions 2025-26 (provinces actuelles).
    p = pd.read_csv(MDIR / "predictions_provinces_actuelles.csv", sep=";")
    p = p[p.annee_scolaire == last].copy()
    idx = pd.read_csv(MDIR / "indice_prov.csv", sep=";")
    idx = idx[idx.annee_scolaire == last].set_index("code")
    p["nom"] = p.code.map(prov.prov_name)
    p["reg"] = p.code.map(prov.reg_name)
    p = p.sort_values("prediction", ascending=False)
    top = []
    for i, r in enumerate(p.head(12).itertuples(), 1):
        f = idx.facteurs.get(r.code)
        top.append(f"| {i} | {r.nom} | {r.reg} | {n(r.prediction, 1)} % | {n(r.ic80_bas, 0)} à {n(r.ic80_haut, 0)} % | "
                   f"{n(r.p_alerte * 100, 0)} % | {f if isinstance(f, str) else '—'} |")
    alert = p[p.p_alerte >= 0.5]
    regs_alert = Counter(alert.reg)
    regions_alerte = ", ".join(f"{r} ({c})" for r, c in sorted(regs_alert.items(), key=lambda x: (-x[1], x[0]))[:5])
    p["largeur"] = p.ic80_haut - p.ic80_bas
    wide = ", ".join(p.nlargest(3, "largeur").nom)

    # Diagnostic régional.
    ir = pd.read_csv(TABLES / "indicateurs_reg.csv", sep=";")
    ir = ir[ir.annee_scolaire == last].copy()
    ir["nom"] = ir.code.map(reg)
    low = ir.nsmallest(3, "tap")
    low_tap = ", ".join(f"{r.nom} ({n(r.tap, 1)} %)" for r in low.itertuples())
    lost = ir[ir.baisse_ecoles_pic <= -50].sort_values("baisse_ecoles_pic")
    lost_txt = ", ".join(f"{r.nom} {n(r.baisse_ecoles_pic, 0)} %" for r in lost.itertuples()) or "aucune au-delà de 50 %"
    over = ", ".join(ir[ir.tbs > 100].sort_values("tbs", ascending=False).nom) or "—"

    # Recommandations.
    rec = risk["recommandations"]["prov"]
    groups: dict[str, dict] = {}
    for code, r in rec.items():
        if r["priorite"] > 2:
            continue
        for t in r["types"]:
            g = groups.setdefault(t["type"], {"titre": t["titre"], "actions": t["actions"], "units": []})
            g["units"].append(prov.prov_name.get(code, code))
    reco_rows = [f"| {g['titre']} | {', '.join(sorted(g['units']))} | {' ; '.join(g['actions'])} |"
                 for g in sorted(groups.values(), key=lambda g: -len(g["units"]))]

    cov80 = ", ".join(f"{n(c['couverture'] * 100, 0)} % ({year_short(c['pli'])})"
                      for c in s["conformal"]["couverture"] if c["niveau"] == 0.8)
    today = dt.date.fromisoformat(meta["genere_le"])
    flags = q["flags"]
    rv = q["reconstitution_vs_publie"]
    return {
        "date": f"{today.day} {MONTHS[today.month - 1]} {today.year}",
        "baisse_effectif": n(abs(k["baisse_effectif"])), "ecoles_max": n(k["ecoles_max"]),
        "annee_ecoles_max": year_short(k["annee_ecoles_max"]), "ecoles_min": n(k["ecoles_min"]),
        "annee_ecoles_min": year_short(k["annee_ecoles_min"]), "annee": year_short(k["annee"]),
        "tap_min": n(k["tap_min"]["valeur"], 1), "tap_min_nom": k["tap_min"]["nom"],
        "tap_max": n(k["tap_max"]["valeur"], 1), "tap_max_nom": k["tap_max"]["nom"],
        "n_values": n(q["valeurs_extraites"]), "controls_ok": q["valeurs_controle"]["ok"],
        "controls_total": q["valeurs_controle"]["total"],
        "n_alerte": int((p.p_alerte >= 0.5).sum()), "seuil": n(s["seuil_alerte"], 0), "regions_alerte": regions_alerte,
        "journal": int((log.message != "doublon ignoré").sum()), "fusion": n(flags.get("fusion_resolue", 0)),
        "reetiq": n(flags.get("annee_reetiquetee", 0)),
        "sums_pct": n(q["sommes"]["taux_ok"] * 100, 1), "sums_n": n(q["sommes"]["testees"]),
        "rates_pct": n(q["taux"]["taux_ok"] * 100, 1), "rates_n": n(q["taux"]["testes"]),
        "flux_pct": n(q["flux_somme_100"]["taux_ok"] * 100, 1), "flux_n": n(q["flux_somme_100"]["testes"]),
        "editions_pct": n(q["historiques_entre_editions"]["taux_identiques"] * 100, 1),
        "editions_n": n(q["historiques_entre_editions"]["comparaisons"]),
        "abandon_nul": n(q["abandon_publie_nul"]["n"]),
        "abandon_nul_k": n(q["abandon_publie_nul"]["dont_reconstitue_negatif_ou_nul"]),
        "recon_red": n(rv["taux_redoublement"]["part_ecart_inf_0_15_pt"] * 100, 0),
        "recon_ab": n(rv["taux_abandon"]["part_ecart_inf_0_15_pt"] * 100, 0),
        "rho_acp": n(im["spearman_variantes"]["acp"], 2), "rho_ent": n(im["spearman_variantes"]["entropie"], 2),
        "rank_width": n(im["rang_moyen_largeur_p05_p95"], 0),
        "n_obs": s["n_observations"], "n_prov": s["n_provinces"], "metrics_rows": "\n".join(rows),
        "chosen": MODEL_NAMES[chosen].lower(),
        "eligible": ", ".join(MODEL_NAMES[e].lower() for e in s["selection"]["lineaires_eligibles"]) or "aucun",
        "gain": n(gain, 0), "trees_sentence": trees, "rho_chosen": n(metric(mt, chosen, "Spearman"), 2),
        "auc_t": n(metric(mt, "logistique", "AUC"), 2), "auc_s": n(metric(ms, "logistique", "AUC"), 2),
        "auc_p": n(metric(mt, "persistance", "AUC"), 2), "coverage80": cov80, "wide_intervals": wide,
        "top_rows": "\n".join(top), "reco_rows": "\n".join(reco_rows),
        "low_tap_regions": low_tap, "lost_schools_regions": lost_txt, "tbs_over100": over,
        "horizon": year_short(horizon),
        **{f"fig_{k}": f"figures/{v}" for k, v in FIGURES.items()},
        "_groups": groups, "_p": p,
    }


def font_face() -> str:
    base = ROOT / "web" / "node_modules" / "@fontsource"
    faces = []
    for fam, folder, weights in [("Source Serif 4", "source-serif-4", (400, 600)), ("Inter", "inter", (400, 500, 600))]:
        for w in weights:
            f = base / folder / "files" / f"{folder}-latin-{w}-normal.woff2"
            if f.exists():
                # Chemin relatif à docs/ : pas de chemin absolu propre à la machine dans le HTML versionné.
                rel = os.path.relpath(f, DOCS).replace("\\", "/")
                faces.append(f"@font-face{{font-family:'{fam}';font-weight:{w};src:url('{rel}') format('woff2');}}")
    return "\n".join(faces)


CSS = """
@page { size: A4; margin: 15mm 16mm 16mm; @bottom-right { content: counter(page); } }
:root { --ink:#1F1C17; --muted:#6B6458; --rule:#E3DCCF; --accent:#B4462C; --paper:#FBF8F2; }
html { font: 9.6pt/1.5 'Inter', 'Segoe UI', sans-serif; color: var(--ink); }
body { margin: 0; }
h1 { font: 600 23pt/1.12 'Source Serif 4', Georgia, serif; margin: 0 0 4pt; letter-spacing: -0.01em; }
.subtitle { color: var(--muted); font-size: 9pt; margin: 0 0 14pt; padding-bottom: 10pt; border-bottom: 2px solid var(--ink); }
h2 { font: 600 13.5pt/1.25 'Source Serif 4', Georgia, serif; margin: 15pt 0 5pt; padding-top: 8pt;
     background: linear-gradient(var(--accent), var(--accent)) left top / 24pt 2pt no-repeat;
     break-after: avoid; break-inside: avoid; }
p { margin: 0 0 6pt; text-align: justify; hyphens: auto; }
ul { margin: 0 0 6pt; padding-left: 14pt; }
li { margin-bottom: 2pt; }
strong { font-weight: 600; }
code { font: 8.5pt Consolas, monospace; background: #F1ECE2; padding: 0 2pt; border-radius: 2px; }
table { width: 100%; border-collapse: collapse; margin: 4pt 0 9pt; font-size: 8.2pt; break-inside: avoid; }
th { text-align: left; font-weight: 600; font-size: 7.4pt; text-transform: uppercase; letter-spacing: .05em;
     color: var(--muted); border-bottom: 1px solid var(--ink); padding: 3pt 4pt; }
td { border-bottom: 1px solid var(--rule); padding: 3pt 4pt; vertical-align: top; }
figure { margin: 6pt 0 10pt; break-inside: avoid; }
figure img { width: 100%; display: block; }
figure.right { float: right; width: 44%; margin: 2pt 0 6pt 12pt; }
figcaption { font-size: 7.8pt; color: var(--muted); margin-top: 3pt; }
.formula { text-align: center; font: 9pt 'Source Serif 4', serif; background: #F6F1E7; padding: 6pt; border-radius: 3px; }
.sources { margin-top: 14pt; padding-top: 6pt; border-top: 1px solid var(--rule); font-size: 7.6pt; color: var(--muted); }
"""


def chrome() -> str | None:
    for c in [os.environ.get("CHROME_PATH"), "C:/Program Files/Google/Chrome/Application/chrome.exe",
              "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", shutil.which("google-chrome"),
              shutil.which("chromium"), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]:
        if c and Path(c).exists():
            return c
    return None


def recommendations_md(ctx: dict) -> str:
    p = ctx["_p"]
    lines = ["# Recommandations d'actions ciblées", "",
             f"Généré le {ctx['date']} à partir des sorties du pipeline (indice composite {ctx['annee']}, "
             f"prévision {ctx['horizon']}). Découpage de 2025.", "",
             "Provinces prioritaires : indice composite « élevé » ou « très élevé », ou probabilité d'au moins 50 % "
             f"de dépasser {ctx['seuil']} % de déperdition. Les pistes sont déduites des dimensions dominantes de "
             "l'indice (score ≥ 60/100) et de l'écart filles-garçons ; elles sont à confronter au terrain.", ""]
    for g in sorted(ctx["_groups"].values(), key=lambda g: -len(g["units"])):
        lines += [f"## {g['titre']} ({len(g['units'])} provinces)", "", f"**Provinces :** {', '.join(sorted(g['units']))}.",
                  "", *[f"- {a}" for a in g["actions"]], ""]
    lines += ["## Classement anticipé (12 premières provinces)", "",
              "| # | Province | Région | Prévision | Intervalle à 80 % | P(alerte) |", "|---|---|---|---|---|---|"]
    for i, r in enumerate(p.head(12).itertuples(), 1):
        lines.append(f"| {i} | {r.nom} | {r.reg} | {n(r.prediction, 1)} % | {n(r.ic80_bas, 0)} à {n(r.ic80_haut, 0)} % | "
                     f"{n(r.p_alerte * 100, 0)} % |")
    return "\n".join(lines) + "\n"


def run() -> dict:
    collect_figures()
    ctx = context()
    tpl = (DOCS / "note_technique.tpl.md").read_text(encoding="utf-8")
    md_text = tpl.format_map({k: v for k, v in ctx.items() if not k.startswith("_")})
    (DOCS / "note_technique.md").write_text(md_text, encoding="utf-8")
    (DOCS / "recommandations.md").write_text(recommendations_md(ctx), encoding="utf-8")
    body = markdown.markdown(md_text, extensions=["tables"])
    # Le HTML est écrit dans docs/ : les chemins relatifs figures/... restent valides.
    html = f"<!doctype html><html lang='fr'><head><meta charset='utf-8'><title>Note technique</title>" \
           f"<style>{font_face()}{CSS}</style></head><body>{body}</body></html>"
    html_path = DOCS / "note_technique.html"
    html_path.write_text(html, encoding="utf-8")
    pdf = DOCS / "note_technique.pdf"
    exe = chrome()
    pages = None
    if exe:
        subprocess.run([exe, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--allow-file-access-from-files",
                        f"--print-to-pdf={pdf}", html_path.as_uri()], check=True, capture_output=True, timeout=180)
        pages = pymupdf.open(pdf).page_count
        if pages > MAX_PAGES:
            raise SystemExit(f"note technique trop longue : {pages} pages (maximum {MAX_PAGES})")
    return {"pages": pages, "pdf": str(pdf) if exe else None}


if __name__ == "__main__":
    print(run())
