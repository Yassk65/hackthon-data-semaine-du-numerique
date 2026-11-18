import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import RankingTable from "../components/RankingTable";
import { UnitSheet } from "../components/UnitPanel";
import type { Core, Meta, Risk, Values } from "../data/types";
import { fmt, shortYear } from "../lib/format";
import { LAYERS, computeLayer, getLayer, layerYears } from "../lib/layers";
import { classify } from "../lib/palettes";
import { parseHash, toHash } from "../lib/url";
import Anticipate from "../views/Anticipate";
import Method from "../views/Method";
import Understand from "../views/Understand";

// Les tests utilisent les vraies sorties du pipeline (web/public/data).
const dataDir = resolve(__dirname, "../../public/data");
const read = <T,>(f: string): T => JSON.parse(readFileSync(resolve(dataDir, f), "utf-8")) as T;
const core: Core = { meta: read<Meta>("meta.json"), values: read<Values>("values.json"), risk: read<Risk>("risk.json") };

vi.stubGlobal("fetch", (url: string) => {
  const name = String(url).split("/").pop()!;
  return Promise.resolve({ ok: true, json: () => Promise.resolve(read(name)) });
});

afterEach(cleanup);

describe("formatage", () => {
  it("formate à la française", () => {
    expect(fmt(3067940, 0)).toBe("3\u202f067\u202f940");
    expect(fmt(78.2, 1, "%")).toBe("78,2\u202f%");
    expect(fmt(null)).toBe("—");
    expect(shortYear("2024-2025")).toBe("2024-25");
  });

  it("classe les valeurs selon des seuils croissants", () => {
    expect(classify(4, [5, 10, 15, 25])).toBe(0);
    expect(classify(15, [5, 10, 15, 25])).toBe(3);
    expect(classify(null, [5])).toBeNull();
  });
});

describe("état dans l'URL", () => {
  it("fait l'aller-retour", () => {
    const s = parseHash("#/explorer?couche=tap&annee=2023-2024&echelle=reg&sel=BF64&osm=1");
    expect(s).toMatchObject({ view: "explorer", layer: "tap", year: "2023-2024", scale: "reg", sel: "BF64", osm: true });
    expect(parseHash(toHash(s))).toEqual(s);
  });

  it("ignore les valeurs invalides", () => {
    const s = parseHash("#/inconnu?sel=<script>&annee=demain");
    expect(s.view).toBe("comprendre");
    expect(s.sel).toBeNull();
    expect(s.year).toBe("");
  });
});

describe("couches de la carte", () => {
  it("couvre les 47 provinces et les 17 régions actuelles", () => {
    expect(Object.keys(core.meta.unites.prov)).toHaveLength(47);
    expect(Object.keys(core.meta.unites.reg)).toHaveLength(17);
  });

  it.each(LAYERS.filter((l) => l.kind !== "unavailable").map((l) => l.id))("calcule la couche %s", (id) => {
    const def = getLayer(id);
    for (const scale of ["prov", "reg"] as const) {
      const years = layerYears(def, core, scale);
      expect(years.length).toBeGreaterThan(0);
      const r = computeLayer(def, core, scale, years[years.length - 1], null);
      const cells = Object.values(r.cells);
      expect(cells).toHaveLength(scale === "prov" ? 47 : 17);
      expect(cells.filter((c) => c.color).length).toBeGreaterThan(cells.length / 2);
      expect(r.legend.items.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("calcule un écart avant/après", () => {
    const def = getLayer("tap");
    const r = computeLayer(def, core, "prov", "2024-2025", "2017-2018");
    expect(r.diff).toBe(true);
    const kadiogo = r.cells.BF1300;
    const v1 = core.values.prov.BF1300.tap[core.meta.annees.indexOf("2024-2025")]!;
    const v0 = core.values.prov.BF1300.tap[core.meta.annees.indexOf("2017-2018")]!;
    expect(kadiogo.value).toBeCloseTo(v1 - v0, 5);
  });
});

describe("rendu des vues", () => {
  it("affiche la vue Comprendre avec les chiffres du pipeline", () => {
    render(<Understand core={core} go={() => {}} />);
    const k = core.meta.chiffres_cles;
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(k.tap_max.nom);
    expect(document.body.textContent).toContain(fmt(Math.abs(k.baisse_effectif), 0));
  });

  it("trie le classement et sélectionne une unité", () => {
    const def = getLayer("deperdition_obs");
    const result = computeLayer(def, core, "prov", "2024-2025", null);
    const onSelect = vi.fn();
    render(
      <RankingTable core={core} def={def} result={result} scale="prov" year="2024-2025" prevYear="2023-2024" selected={null} onSelect={onSelect} onHover={() => {}} />,
    );
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBe(48);
    fireEvent.click(screen.getAllByRole("button", { name: /Kadiogo/ })[0]);
    expect(onSelect).toHaveBeenCalledWith("BF1300");
  });

  it("affiche une fiche province complète", () => {
    render(<UnitSheet core={core} code="BF6402" year="2024-2025" onClose={() => {}} onCompare={() => {}} onPrint={() => {}} compareOptions={[]} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Séno");
    expect(screen.getAllByRole("img").length).toBeGreaterThanOrEqual(4);
  });

  it("affiche les vues Anticiper et Méthode", async () => {
    render(<Anticipate core={core} state={parseHash("#/anticiper")} go={() => {}} />);
    await waitFor(() => expect(screen.getByText(/fait-il mieux/)).toBeTruthy());
    cleanup();
    render(<Method core={core} />);
    await waitFor(() => expect(screen.getByText(/Journal de qualité/)).toBeTruthy());
  });
});
