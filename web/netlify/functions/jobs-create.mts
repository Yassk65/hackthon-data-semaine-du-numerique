import type { Config, Context } from "@netlify/functions";
import { handleCreateJob } from "../lib/handlers";
import { liveDeps } from "../lib/deps";

// Fonction d'arrière-plan : le navigateur reçoit tout de suite un 202 vide, puis interroge GET /api/jobs/:id.
export default async (req: Request, context: Context): Promise<void> => {
  if (req.method !== "POST") return;
  await handleCreateJob(req, liveDeps(req, context));
};

export const config: Config = { path: "/api/jobs", background: true };
