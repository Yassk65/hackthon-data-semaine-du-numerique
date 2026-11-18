import { useEffect, useState } from "react";
import type { Core, GeoBundle, GeoCollection, ModelData, QualityData, Schools } from "./types";

const base = import.meta.env.BASE_URL;
const cache = new Map<string, Promise<unknown>>();

export function fetchJSON<T>(name: string): Promise<T> {
  if (!cache.has(name)) {
    cache.set(
      name,
      fetch(`${base}data/${name}`).then((r) => {
        if (!r.ok) throw new Error(`${name} : HTTP ${r.status}`);
        return r.json();
      }),
    );
  }
  return cache.get(name) as Promise<T>;
}

export const loadCore = (): Promise<Core> =>
  Promise.all([fetchJSON<Core["meta"]>("meta.json"), fetchJSON<Core["values"]>("values.json"), fetchJSON<Core["risk"]>("risk.json")]).then(
    ([meta, values, risk]) => ({ meta, values, risk }),
  );

export const loadGeo = (): Promise<GeoBundle> =>
  Promise.all([
    fetchJSON<GeoCollection>("geo_prov.json"),
    fetchJSON<GeoCollection>("geo_reg.json"),
    fetchJSON<Record<string, [number, number]>>("labels_prov.json"),
    fetchJSON<Record<string, [number, number]>>("labels_reg.json"),
    fetchJSON<[number, number, number, number]>("bounds.json"),
  ]).then(([prov, reg, lp, lr, bounds]) => ({ prov, reg, labels: { prov: lp, reg: lr }, bounds }));

export const loadModel = () => fetchJSON<ModelData>("model.json");
export const loadQuality = () => fetchJSON<QualityData>("quality.json");
export const loadSchools = () => fetchJSON<Schools>("ecoles_osm.json");
export const loadOldRegions = () => fetchJSON<GeoCollection>("geo_old_reg.json");

export type Loadable<T> = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: T };

export function useLoad<T>(loader: () => Promise<T>, enabled = true): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loader()
      .then((data) => alive && setState({ status: "ready", data }))
      .catch((e: unknown) => alive && setState({ status: "error", error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [loader, enabled]);
  return state;
}
