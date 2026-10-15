import { CONFIG } from "./config.js";

export class QuotaError extends Error {}

// Day key in Indian Standard Time
export function istDay(d = new Date()) {
  return new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
}

export async function usageToday(env, day = istDay()) {
  const r = await env.DB.prepare("SELECT calls FROM usage WHERE day=?").bind(day).first();
  return r ? r.calls : 0;
}

async function bump(env) {
  await env.DB.prepare(
    "INSERT INTO usage(day,calls) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET calls=calls+1"
  ).bind(istDay()).run();
}

export function parseJson(text) {
  let t = String(text || "").trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("Model did not return valid JSON");
  }
}

// role = key of CONFIG.gemini.models. Every HTTP attempt counts against the daily cap.
export async function callGemini(env, role, prompt, opts = {}) {
  const cfg = CONFIG.gemini;
  const models = cfg.models[role];
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY secret is not set");
  let lastErr = null;

  for (const model of models) {
    if ((await usageToday(env)) >= cfg.dailyCallCap) {
      throw new QuotaError("Daily call cap reached");
    }
    await bump(env);

    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: opts.temperature ?? 0.7,
        maxOutputTokens: opts.maxTokens ?? 8192,
      },
    };
    if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
    if (opts.json) body.generationConfig.responseMimeType = "application/json";
    if (opts.grounded) body.tools = [{ google_search: {} }];

    let res;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify(body),
        }
      );
    } catch (e) {
      lastErr = new Error(`${model} network error: ${e.message}`);
      continue;
    }

    if (res.status === 429 || res.status === 500 || res.status === 503) {
      lastErr = new QuotaError(`${model} returned ${res.status}`);
      continue;
    }
    if (!res.ok) {
      const t = (await res.text()).slice(0, 300);
      throw new Error(`${model} error ${res.status}: ${t}`);
    }

    const data = await res.json();
    const cand = data.candidates && data.candidates[0];
    const text = ((cand && cand.content && cand.content.parts) || [])
      .map((p) => p.text || "")
      .join("")
      .trim();
    if (!text) {
      lastErr = new Error(`${model} returned an empty response`);
      continue;
    }
    const chunks = (cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
    const sources = chunks
      .filter((c) => c.web && c.web.uri)
      .map((c) => ({ title: c.web.title || "", url: c.web.uri }));
    return { text, sources, model };
  }
  throw lastErr || new Error("No Gemini model available");
}
