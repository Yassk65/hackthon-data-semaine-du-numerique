"""Figures de la note technique et de validation (outputs/figures, PNG 200 dpi).

Même charte que l'application : fond papier, encre presque noire, accent latérite, palettes
séquentielles lisibles par les personnes daltoniennes, hachures pour les données fragiles.
"""

from __future__ import annotations

import json

import geopandas as gpd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib.patches import Patch  # noqa: E402

from pipeline.config import OUTPUTS_DIR  # noqa: E402
from pipeline.geo import dissolve, new_provinces  # noqa: E402

FIG = OUTPUTS_DIR / "figures"
TABLES = OUTPUTS_DIR / "tables"
MDIR = OUTPUTS_DIR / "model"

PAPER, INK, MUTED, ACCENT = "#FBF8F2", "#1F1C17", "#6F685D", "#B4462C"
RISK = ["#F4E6CF", "#EBBF8E", "#DC8B58", "#BC5532", "#7D2B1C"]
GOOD = ["#E9EFF1", "#B9CFD8", "#7FA7BA", "#457D98", "#1C4C68"]
DIV = ["#A6611A", "#DFC27D", "#F2EDE4", "#80CDC1", "#018571"]

plt.rcParams.update({
    "font.family": ["Segoe UI", "DejaVu Sans"], "font.size": 9, "axes.edgecolor": MUTED,
    "axes.labelcolor": INK, "xtick.color": MUTED, "ytick.color": MUTED, "text.color": INK,
    "figure.facecolor": PAPER, "axes.facecolor": PAPER, "savefig.facecolor": PAPER,
    "axes.spines.top": False, "axes.spines.right": False, "axes.titleweight": "bold",
    "axes.titlesize": 10, "axes.titlelocation": "left", "hatch.color": MUTED, "hatch.linewidth": 0.5,
})


def _save(fig, name: str):
    FIG.mkdir(parents=True, exist_ok=True)
    fig.savefig(FIG / name, dpi=200, bbox_inches="tight")
    plt.close(fig)


def _classify(v: pd.Series, breaks: list[float]) -> pd.Series:
    return pd.cut(v, [-np.inf, *breaks, np.inf], labels=False)


def choropleth(ax, gdf, col, breaks, colors, title, fmt="{:.0f}", unit="%", fragile=None, legend_title=None):
    reg = dissolve("reg")
    cls = _classify(gdf[col], breaks)
    gdf = gdf.assign(_c=cls)
    for k, color in enumerate(colors):
        part = gdf[gdf._c == k]
        if len(part):
            part.plot(ax=ax, color=color, edgecolor="white", linewidth=0.35)
    missing = gdf[gdf._c.isna()]
    if len(missing):
        missing.plot(ax=ax, facecolor=PAPER, edgecolor=MUTED, linewidth=0.35, hatch="////")
    if fragile is not None and fragile.any():
        gdf[fragile.to_numpy()].plot(ax=ax, facecolor="none", edgecolor=INK, linewidth=0.0, hatch="....")
    reg.boundary.plot(ax=ax, color=INK, linewidth=0.8)
    ax.set_axis_off()
    ax.set_title(title, loc="left")
    def f(v):  # notation française : virgule décimale, signe moins typographique
        return fmt.format(v).replace(".", ",").replace("-", "\u2212")
    labels = [f"< {f(breaks[0])}"] + [f"{f(a)} à {f(b)}" for a, b in zip(breaks, breaks[1:])] + [f"≥ {f(breaks[-1])}"]
    handles = [Patch(facecolor=c, edgecolor="none", label=f"{lab} {unit}".strip()) for c, lab in zip(colors, labels)]
    if len(missing):
        handles.append(Patch(facecolor=PAPER, edgecolor=MUTED, hatch="////", label="donnée manquante"))
    # Le quart sud-est du cadre est vide (hors frontière) : la légende s'y place sans masquer la carte.
    ax.legend(handles=handles, loc="lower right", frameon=False, fontsize=7, title=legend_title,
              title_fontsize=7, bbox_to_anchor=(1.04, -0.04), alignment="left")


def provinces_frame(year: str, extra: pd.DataFrame | None = None) -> gpd.GeoDataFrame:
    g = dissolve("prov")
    ind = pd.read_csv(TABLES / "indicateurs_prov.csv", sep=";")
    ind = ind[ind.annee_scolaire == year].rename(columns={"code": "prov_code"})
    g = g.merge(ind, on="prov_code", how="left")
    if extra is not None:
        g = g.merge(extra, on="prov_code", how="left")
    return g


def fig_forecast_map():
    p = pd.read_csv(MDIR / "predictions_provinces_actuelles.csv", sep=";")
    p = p[p.annee_scolaire == "2024-2025"].rename(columns={"code": "prov_code"})
    g = provinces_frame("2024-2025", p[["prov_code", "prediction", "p_alerte"]])
    fig, axes = plt.subplots(1, 2, figsize=(9.2, 4.4))
    choropleth(axes[0], g, "prediction", [8, 10, 12, 15], RISK, "Déperdition anticipée 2024-25 → 2025-26")
    choropleth(axes[1], g, "p_alerte", [0.2, 0.4, 0.6, 0.8], RISK, "Probabilité de dépasser 15 %",
               fmt="{:.1f}", unit="")
    _save(fig, "carte_prevision.png")


def fig_context_maps():
    g = provinces_frame("2024-2025")
    frag = g.qualite_niveau.eq("fragile")
    fig, axes = plt.subplots(2, 2, figsize=(9.2, 8.2))
    choropleth(axes[0, 0], g, "tap", [25, 40, 55, 70], GOOD, "Taux d'achèvement 2024-25", fragile=frag)
    choropleth(axes[0, 1], g, "deperdition_prec", [5, 10, 15, 25], RISK,
               "Déperdition observée 2023-24 → 2024-25", fragile=frag)
    choropleth(axes[1, 0], g, "baisse_ecoles_pic", [-50, -25, -10, -2], DIV,
               "Écoles en activité par rapport au maximum", fragile=frag)
    choropleth(axes[1, 1], g, "pauvrete", [20, 35, 50, 65], RISK, "Pauvreté monétaire (2019)")
    _save(fig, "cartes_contexte.png")


def fig_national():
    n = pd.read_csv(TABLES / "indicateurs_national.csv", sep=";")
    n["an"] = n.annee_scolaire.str[:4].astype(int) + 1
    fig, axes = plt.subplots(1, 3, figsize=(9.2, 2.6))
    ax = axes[0]
    ax.plot(n.an, n.effectif / 1e6, color=INK, lw=1.6)
    ax.set_title("Élèves inscrits (millions)")
    ax2 = axes[1]
    e = n.dropna(subset=["ecoles"])
    ax2.plot(e.an, e.ecoles / 1e3, color=INK, lw=1.6)
    ax2.set_title("Écoles en activité (milliers)")
    ax3 = axes[2]
    d = n.dropna(subset=["deperdition_prec"])
    ax3.bar(d.an, d.deperdition_prec, color=[ACCENT if v >= 15 else "#D9B9A6" for v in d.deperdition_prec], width=0.7)
    ax3.axhline(15, color=MUTED, lw=0.8, ls="--")
    ax3.set_title("Déperdition observée (%)")
    for a in axes:
        a.axvspan(2019.5, 2023.5, color="#EFE6D6", zorder=0)
        a.set_xticks([2015, 2018, 2021, 2024])
        a.set_xticklabels(["14-15", "17-18", "20-21", "23-24"])
    _save(fig, "series_nationales.png")


def fig_validation():
    folds = pd.read_csv(MDIR / "metriques_par_pli_temporel.csv", sep=";")
    s = json.loads((MDIR / "resume_modele.json").read_text(encoding="utf-8"))
    chosen = s["selection"]["retenu"]
    names = [("persistance", "Persistance", "#C9C1B4"), ("moyenne_historique", "Moyenne historique", "#9A9284"),
             ("ridge", "Ridge", "#7FA7BA"), ("gbr", "Gradient boosting", "#457D98"),
             (chosen, "Régression médiane (retenue)", ACCENT)]
    fig, axes = plt.subplots(1, 2, figsize=(9.2, 3.0), gridspec_kw={"width_ratios": [1.6, 1]})
    x = np.arange(len(folds))
    w = 0.16
    for k, (col, lab, c) in enumerate(names):
        axes[0].bar(x + (k - 2) * w, folds[f"MAE_{col}"], w, color=c, label=lab)
    axes[0].set_xticks(x)
    axes[0].set_xticklabels([f"{f[:4]}-{f[7:]} → +1" for f in folds.pli])
    axes[0].set_ylabel("Erreur absolue moyenne (points)")
    axes[0].set_title("Validation temporelle (fenêtre croissante)", pad=34)
    axes[0].legend(frameon=False, fontsize=7, ncol=3, loc="lower left", bbox_to_anchor=(0, 1.0))
    cal = pd.read_csv(MDIR / "calibration_logistique.csv", sep=";")
    axes[1].plot([0, 1], [0, 1], color=MUTED, lw=0.8, ls="--")
    axes[1].plot(cal.proba_moyenne, cal.frequence_observee, "o-", color=ACCENT)
    axes[1].set_xlabel("Probabilité prédite d'alerte")
    axes[1].set_ylabel("Fréquence observée")
    axes[1].set_title("Calibration de l'alerte (hors échantillon)")
    axes[1].set_xlim(0, 1)
    axes[1].set_ylim(0, 1)
    _save(fig, "validation.png")


def fig_reconstruction():
    c = pd.read_csv(TABLES / "comparaison_taux_publies_reconstitues.csv", sep=";")
    fig, axes = plt.subplots(1, 2, figsize=(9.2, 3.2))
    for ax, ind, title in [(axes[0], "taux_redoublement", "Redoublement"), (axes[1], "taux_abandon", "Abandon")]:
        d = c[c.indicateur == ind]
        ax.scatter(d.publie, d.reconstitue.clip(-30, 60), s=5, alpha=0.45, color=INK, linewidths=0)
        lim = (0, 40) if ind == "taux_redoublement" else (-30, 60)
        ax.plot([0, 60], [0, 60], color=ACCENT, lw=0.8)
        ax.axhline(0, color=MUTED, lw=0.5)
        ax.set_xlim(lim[0] if lim[0] >= 0 else -2, lim[1])
        ax.set_ylim(*lim)
        ok = (d.ecart.abs() < 0.15).mean()
        ax.set_title(f"{title} : publié contre reconstitué ({ok:.0%} à ± 0,15 pt)")
        ax.set_xlabel("Taux publié (annuaire, %)")
        ax.set_ylabel("Taux reconstitué (%)")
    _save(fig, "reconstruction.png")


def fig_reform():
    old = dissolve("old_reg")
    new = dissolve("reg")
    prov = dissolve("prov")
    fig, ax = plt.subplots(figsize=(5.2, 4.2))
    prov.plot(ax=ax, color="#EFE6D6", edgecolor="white", linewidth=0.4)
    split = prov[prov.prov_code.isin(["BF5901", "BF5902", "BF6001", "BF6002"])]
    split.plot(ax=ax, color="#EBBF8E", edgecolor="white", linewidth=0.4)
    new.boundary.plot(ax=ax, color=INK, linewidth=0.9)
    old.boundary.plot(ax=ax, color=ACCENT, linewidth=0.9, linestyle=(0, (2, 1.5)))
    for _, r in new.iterrows():
        pt = r.geometry.representative_point()
        ax.annotate(r.reg_name, (pt.x, pt.y), fontsize=6.5, ha="center", color=INK)
    ax.set_axis_off()
    ax.legend(handles=[Patch(facecolor="none", edgecolor=INK, label="17 régions actuelles"),
                       Patch(facecolor="none", edgecolor=ACCENT, linestyle="--", label="13 anciennes régions"),
                       Patch(facecolor="#EBBF8E", label="provinces issues d'une scission")],
              loc="lower left", frameon=False, fontsize=7)
    ax.set_title("Découpage de 2025 et anciennes limites")
    _ = new_provinces
    _save(fig, "reforme.png")


def run():
    fig_forecast_map()
    fig_context_maps()
    fig_national()
    fig_validation()
    fig_reconstruction()
    fig_reform()


if __name__ == "__main__":
    run()
