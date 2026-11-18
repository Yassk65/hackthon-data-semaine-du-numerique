import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import baseline from "./data/engine_baseline.json";
import model from "./data/engine_model.json";
import { runEngine } from "./run";
import type { EngineBaseline, EngineModel } from "./types";
import { validateUpload } from "./validate";
import { validationContext } from "../netlify/lib/handlers";

const base = baseline as unknown as EngineBaseline;
const ROOT = resolve(__dirname, "..");
const fixture = resolve(ROOT, "scripts/fixtures/scenario_demo.json");

/** Résultat du recalcul sur le fichier d'exemple fictif : sert de scénario aux contrôles de rendu (scripts/check.mjs). */
function demoScenario(): string {
  const csv = readFileSync(resolve(ROOT, "public/data/exemple_fictif_2025-2026.csv"), "utf8");
  const v = validateUpload(csv, validationContext(base));
  expect(v.issues.filter((i) => i.niveau === "erreur")).toEqual([]);
  const res = runEngine(v, base, model as unknown as EngineModel, { now: () => new Date("2026-11-18T12:00:00Z") });
  return JSON.stringify(res);
}

describe("scénario de démonstration", () => {
  it("est à jour (UPDATE_FIXTURES=1 pour le régénérer)", () => {
    const fresh = demoScenario();
    if (process.env.UPDATE_FIXTURES) writeFileSync(fixture, fresh, "utf8");
    expect(readFileSync(fixture, "utf8")).toBe(fresh);
  });

  it("couvre les 47 provinces et 17 régions, avec une vérification de la prévision précédente", () => {
    const res = JSON.parse(demoScenario());
    expect(Object.keys(res.provinces)).toHaveLength(47);
    expect(Object.keys(res.regions)).toHaveLength(17);
    expect(res.type).toBe("nouvelle_annee");
    expect(res.verification.n).toBeGreaterThan(40);
  });
});