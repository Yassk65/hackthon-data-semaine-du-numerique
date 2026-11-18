import type { Config, Context } from "@netlify/functions";
import { handleStatus } from "../lib/handlers";
import { liveDeps } from "../lib/deps";

export default async (req: Request, context: Context): Promise<Response> => handleStatus(liveDeps(req, context));

export const config: Config = { path: "/api/status", method: "GET" };
