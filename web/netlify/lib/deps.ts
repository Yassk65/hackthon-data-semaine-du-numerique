/** Dépendances réelles des fonctions : Netlify Blobs, variables d'environnement, données du moteur. */
import type { Context } from "@netlify/functions";
import baseline from "../../engine/data/engine_baseline.json";
import model from "../../engine/data/engine_model.json";
import type { EngineBaseline, EngineModel } from "../../engine/types";
import type { Deps } from "./handlers";
import { blobKV, memoryKV } from "./kv";

// Hors Netlify (serveur local de scripts/dev-api.mjs), les jobs sont gardés en mémoire.
const local = process.env.DCB_STORE === "memory" ? { jobs: memoryKV(), quota: memoryKV(), reports: memoryKV() } : null;

export function liveDeps(req: Request, context: Context): Deps {
  return {
    jobs: local?.jobs ?? blobKV("jobs"),
    quota: local?.quota ?? blobKV("quota"),
    reports: local?.reports ?? blobKV("reports"),
    env: (k) => process.env[k],
    fetch,
    now: () => new Date(),
    base: baseline as unknown as EngineBaseline,
    model: model as unknown as EngineModel,
    ip: context.ip ?? "inconnue",
    origin: new URL(req.url).origin,
  };
}
