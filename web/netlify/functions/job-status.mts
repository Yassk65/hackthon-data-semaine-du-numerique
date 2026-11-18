import type { Config, Context } from "@netlify/functions";
import { handleGetJob } from "../lib/handlers";
import { liveDeps } from "../lib/deps";

export default async (req: Request, context: Context): Promise<Response> =>
  handleGetJob(context.params.id ?? "", new URL(req.url), liveDeps(req, context));

export const config: Config = { path: "/api/jobs/:id", method: "GET" };
