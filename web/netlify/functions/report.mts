import type { Config, Context } from "@netlify/functions";
import { handleReport } from "../lib/handlers";
import { liveDeps } from "../lib/deps";

// Fonction d'arrière-plan : l'appel au modèle de langage peut durer plusieurs dizaines de secondes.
export default async (req: Request, context: Context): Promise<void> => {
  if (req.method !== "POST") return;
  await handleReport(req, liveDeps(req, context));
};

export const config: Config = { path: "/api/report", background: true };
