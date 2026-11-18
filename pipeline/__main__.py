"""Point d'entrée unique du pipeline.

    python -m pipeline all        # tout régénérer (équivalent de `make all`)
    python -m pipeline <étape>    # une étape : inventory, geo, extract, context, features,
                                  # quality, index, model, export, figures

Les étapes sont déterministes (graine fixée à 42) et n'écrivent jamais dans le Data Pack.
"""

from __future__ import annotations

import sys
import time

STEPS = ["inventory", "geo", "extract", "context", "features", "quality", "index", "model", "export", "figures"]


def run_step(name: str) -> None:
    if name == "inventory":
        from pipeline import inventory
        inventory.main()
    elif name == "geo":
        from pipeline import geo
        geo.build_geometries()
    elif name == "extract":
        from pipeline import extract_annuaires
        extract_annuaires.run()
    elif name == "context":
        from pipeline import extract_context
        extract_context.run()
    elif name == "features":
        from pipeline import features
        features.run()
    elif name == "quality":
        from pipeline import quality
        rep = quality.build_report()
        cv = rep["valeurs_controle"]
        if cv["ok"] != cv["total"]:
            raise SystemExit(f"valeurs de contrôle en échec : {cv['ok']}/{cv['total']}")
    elif name == "index":
        from pipeline import risk_index
        risk_index.run()
    elif name == "model":
        from pipeline import model
        model.run()
    elif name == "export":
        from pipeline import export
        export.run()
    elif name == "figures":
        from pipeline import figures
        figures.run()
    else:
        raise SystemExit(f"étape inconnue : {name} (choix : all, {', '.join(STEPS)})")


def main(argv: list[str]) -> None:
    targets = STEPS if not argv or argv[0] == "all" else argv
    for name in targets:
        t0 = time.perf_counter()
        run_step(name)
        print(f"[pipeline] {name:<10} ok ({time.perf_counter() - t0:.1f} s)", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
