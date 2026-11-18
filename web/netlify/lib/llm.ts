/** Appel à OpenRouter (API compatible OpenAI). La clé n'est lue que côté serveur, dans l'environnement. */

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_MODELS = ["anthropic/claude-haiku-5.5", "deepseek/deepseek-v4.1-flash"];

export interface LlmResult {
  texte: string;
  modele: string;
  tokens: { entree: number; sortie: number } | null;
}

export class LlmError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
  }
}

interface ChatResponse {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface LlmCall {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  referer?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxTokens?: number;
}

export async function chat(c: LlmCall): Promise<LlmResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), c.timeoutMs ?? 60_000);
  try {
    const res = await (c.fetchImpl ?? fetch)(OPENROUTER_URL, {
      method: "POST",
      signal: ctl.signal,
      headers: {
        Authorization: `Bearer ${c.apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "Decrochage scolaire - Burkina Faso (Data Challenge 2026)",
        ...(c.referer ? { "HTTP-Referer": c.referer } : {}),
      },
      body: JSON.stringify({
        model: c.model,
        messages: [{ role: "system", content: c.system }, { role: "user", content: c.user }],
        max_tokens: c.maxTokens ?? 900,
        temperature: 0.2,
      }),
    });
    if (!res.ok) throw new LlmError(`réponse HTTP ${res.status}`, res.status);
    const data = (await res.json()) as ChatResponse;
    const texte = data.choices?.[0]?.message?.content?.trim();
    if (!texte) throw new LlmError("réponse vide");
    return {
      texte, modele: data.model ?? c.model,
      tokens: data.usage ? { entree: data.usage.prompt_tokens ?? 0, sortie: data.usage.completion_tokens ?? 0 } : null,
    };
  } catch (e) {
    if (e instanceof LlmError) throw e;
    throw new LlmError((e as Error).name === "AbortError" ? "délai dépassé" : "appel impossible");
  } finally {
    clearTimeout(timer);
  }
}

/** Essaie les modèles dans l'ordre ; lève la dernière erreur si tous échouent. */
export async function chatWithFallback(models: string[], call: Omit<LlmCall, "model">): Promise<LlmResult> {
  let last: LlmError = new LlmError("aucun modèle configuré");
  for (const model of models) {
    try {
      return await chat({ ...call, model });
    } catch (e) {
      last = e as LlmError;
      // Clé refusée ou crédit épuisé : inutile d'essayer un autre modèle.
      if (last.status === 401 || last.status === 402 || last.status === 403) break;
    }
  }
  throw last;
}
