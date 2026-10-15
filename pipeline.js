import { CONFIG } from "./config.js";
import { callGemini, parseJson, QuotaError, usageToday, istDay } from "./gemini.js";
import {
  log, getSetting, setSetting, nowIso, slugify, wordCount, titleSimilarity, parseFeed, htmlToText,
} from "./util.js";

const ORDER = [
  "topic", "research", "outline", "draft", "check1", "rewrite",
  "check2", "polish", "seo", "image", "finalize",
];

const UA = "Mozilla/5.0 (compatible; PromptNestBot/1.0)";

async function getText(X, url, ms = 8000) {
  X.sub++;
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  return await res.text();
}

function systemFor(ch) {
  return (
    `You are a senior writer for ${CONFIG.site.name}, a publication for ${ch.audience}. ` +
    `Write as ${ch.voice} ` +
    `Accuracy is more important than sounding impressive. Never invent facts, prices, statistics, quotes or product features.`
  );
}

// ---------- stages: each returns a patch for the job row ----------

const STAGES = {
  async topic(env, job, ch, X) {
    // 1. Gather fresh headlines
    const items = [];
    for (const feed of ch.feeds) {
      if (X.sub >= CONFIG.maxSubrequestsPerTick - 12) break;
      try {
        const xml = await getText(X, feed);
        const cutoff = Date.now() - 10 * 86400000;
        for (const it of parseFeed(xml).slice(0, 8)) {
          const t = Date.parse(it.date);
          if (!t || t >= cutoff) items.push(it);
        }
      } catch {}
    }
    // 2. Avoid anything we already covered
    const rows = await env.DB.prepare(
      "SELECT title FROM posts ORDER BY id DESC LIMIT 100"
    ).all();
    const existing = (rows.results || []).map((r) => r.title);
    const running = await env.DB.prepare(
      "SELECT topic FROM jobs WHERE topic IS NOT NULL ORDER BY id DESC LIMIT 30"
    ).all();
    for (const r of running.results || []) existing.push(r.topic);

    const headlines = items.slice(0, 30).map((i, n) => `${n + 1}. ${i.title} | ${i.link}`).join("\n") || "(no fresh headlines available)";
    const prompt =
      `Choose ONE article topic for ${CONFIG.site.name}. Audience: ${ch.audience}.\n\n` +
      `Good topic types:\n- ${ch.topicHints.join("\n- ")}\n\n` +
      `Fresh AI headlines (may use one as inspiration or a source, or choose an evergreen how-to instead):\n${headlines}\n\n` +
      `Already covered (do NOT repeat or closely overlap):\n${existing.join("\n") || "(none yet)"}\n\n` +
      (job.last_error ? `Your previous pick was rejected: ${job.last_error}. Pick something clearly different.\n\n` : "") +
      `The topic must solve a real problem for the audience and be something a careful writer can verify. Prefer a specific angle over a broad one.\n` +
      `Return JSON: {"topic": "working title", "angle": "what makes this useful and different, one sentence", "reader_problem": "...", "category": one of ${JSON.stringify(ch.categories)}, "keyword": "main search phrase", "source_urls": ["up to 3 URLs from the headlines above if relevant, else []"]}`;
    const r = await callGemini(env, "topic", prompt, { json: true, system: systemFor(ch), temperature: 0.8 });
    const t = parseJson(r.text);
    if (!t.topic) throw new Error("No topic returned");
    for (const e of existing) {
      if (titleSimilarity(t.topic, e) >= 0.7) throw new Error(`"${t.topic}" is too similar to "${e}"`);
    }
    const urls = (t.source_urls || []).filter((u) => /^https?:\/\//.test(u)).slice(0, 3);
    return { topic: t.topic, meta: JSON.stringify(t), source_urls: JSON.stringify(urls), last_error: null };
  },

  async research(env, job, ch, X) {
    const meta = JSON.parse(job.meta || "{}");
    const urls = JSON.parse(job.source_urls || "[]");
    const pages = [];
    for (const u of urls) {
      try {
        const html = await getText(X, u);
        pages.push({ url: u, text: htmlToText(html).slice(0, 5000) });
      } catch {}
    }
    const pageText = pages.map((p) => `SOURCE ${p.url}\n${p.text}`).join("\n\n") || "(no pages fetched)";
    const prompt =
      `Prepare research notes for an article.\nTopic: ${job.topic}\nAngle: ${meta.angle || ""}\nReader problem: ${meta.reader_problem || ""}\n\n` +
      `Use Google Search to check current facts. Provided source text:\n${pageText}\n\n` +
      `Write concise bullet notes: exact current features, limits, plans and pricing (say which currency and that prices change), step-by-step how it works, common beginner mistakes, real alternatives, and any warning a careful teacher would give. ` +
      `Only include facts you are confident are accurate. Mark anything uncertain as UNVERIFIED. Do not write the article.`;
    let r;
    try {
      r = await callGemini(env, "research", prompt, { grounded: true, system: systemFor(ch), temperature: 0.3 });
    } catch (e) {
      if (e instanceof QuotaError) throw e;
      r = await callGemini(env, "research", prompt, { system: systemFor(ch), temperature: 0.3 });
    }
    const fetched = pages.map((p) => `- ${p.url}`).join("\n");
    const other = r.sources.slice(0, 5).map((s) => `- ${s.title}: ${s.url}`).join("\n");
    const notes =
      r.text + `\n\nFETCHED SOURCES:\n${fetched || "(none)"}\n\nSEARCH SOURCES:\n${other || "(none)"}`;
    return { research: notes };
  },

  async outline(env, job, ch) {
    const meta = JSON.parse(job.meta || "{}");
    const prompt =
      `Create an outline for an article titled/about: ${job.topic}\nAngle: ${meta.angle || ""}\nAudience: ${ch.audience}\n\n` +
      `RESEARCH NOTES:\n${job.research}\n\n` +
      `Outline in Markdown: the opening hook idea (a concrete situation, not a cliche), the promise to the reader, 5-8 H2 sections each with the key points and one practical example, a "Who this is for (and who should skip it)" section, a short FAQ with 3 real questions, and a conclusion with one concrete next step. Mention which research facts go in which section. Keep it tight.`;
    const r = await callGemini(env, "writer", prompt, { system: systemFor(ch), temperature: 0.5 });
    return { outline: r.text };
  },

  async draft(env, job, ch) {
    const sources = (job.research.split("FETCHED SOURCES:")[1] || "").trim();
    const prompt =
      `Write the full article in Markdown.\nTopic: ${job.topic}\n\nOUTLINE:\n${job.outline}\n\nRESEARCH NOTES (your only source of facts):\n${job.research}\n\n` +
      `Rules:\n- ${ch.minWords}-${ch.maxWords} words.\n- No H1 title (the page adds it). Use ## and ### headings.\n` +
      `- Use ONLY facts from the research notes. If a detail is not there, leave it out. Do not state anything marked UNVERIFIED as fact.\n` +
      `- No invented prices, numbers, quotes, versions or case studies. Where pricing or limits matter, tell the reader to confirm on the official website because they change.\n` +
      `- Open with a concrete situation the reader recognises, not a cliche. Teach like a master: explain why, then how, with small worked examples and clear numbered steps.\n` +
      `- Short paragraphs. Plain words. No filler, no hype, avoid phrases such as "game-changer", "delve", "unlock the power", "in today's fast-paced world".\n` +
      `- Include a "Who this is for (and who should skip it)" section, an FAQ with 3 questions, and a conclusion with one concrete next step.\n` +
      `- End with a "## Sources" section listing these URLs as Markdown links (skip the section if there are none):\n${sources}`;
    const r = await callGemini(env, "writer", prompt, { system: systemFor(ch), temperature: 0.7, maxTokens: 16384 });
    return { draft: r.text };
  },

  async check1(env, job, ch) {
    return { check1: await factCheck(env, "checker1", job, ch) };
  },

  async rewrite(env, job, ch) {
    const c = JSON.parse(job.check1 || "{}");
    const issues = c.issues || [];
    if (!issues.length) return {}; // nothing to fix, no call spent
    const prompt =
      `Fix the problems below in this article and return the COMPLETE corrected article in Markdown, keeping its structure, length and voice. ` +
      `If a claim cannot be supported by the research notes, remove or soften it.\n\nPROBLEMS:\n${JSON.stringify(issues, null, 1)}\n\nARTICLE:\n${job.draft}\n\nRESEARCH NOTES:\n${job.research}`;
    const r = await callGemini(env, "writer", prompt, { system: systemFor(ch), temperature: 0.4, maxTokens: 16384 });
    return { draft: r.text };
  },

  async check2(env, job, ch) {
    return { check2: await factCheck(env, "checker2", job, ch) };
  },

  async polish(env, job, ch) {
    const c = JSON.parse(job.check2 || "{}");
    const issues = c.issues || [];
    const prompt =
      `Do a final edit of this article and return the COMPLETE article in Markdown.\n` +
      (issues.length ? `First fix these fact problems (remove a claim if it cannot be supported):\n${JSON.stringify(issues, null, 1)}\n\n` : "") +
      `Then polish: make the opening gripping and concrete, tighten every paragraph, cut filler and repetition, make steps unambiguous, keep a calm expert teaching voice, remove cliches and hype. Keep headings, the FAQ, the "Who this is for" section, the conclusion and the Sources section. Do not add new facts.\n\nARTICLE:\n${job.draft}\n\nRESEARCH NOTES:\n${job.research}`;
    const r = await callGemini(env, "writer", prompt, { system: systemFor(ch), temperature: 0.5, maxTokens: 16384 });
    return { draft: r.text };
  },

  async seo(env, job, ch) {
    const meta = JSON.parse(job.meta || "{}");
    const prompt =
      `Create SEO metadata for this article.\nKeyword: ${meta.keyword || job.topic}\nAllowed categories: ${JSON.stringify(ch.categories)}\n\nARTICLE:\n${job.draft.slice(0, 6000)}\n\n` +
      `Return JSON: {"title": "clear, specific, max 60 characters, no clickbait", "description": "max 155 characters, honest summary that earns the click", "slug": "short-lowercase-hyphenated", "category": "one allowed category", "tags": ["3-5 short tags"], "image_query": "2-4 words describing a fitting stock photo, no text or logos", "image_alt": "one-sentence alt text"}`;
    const r = await callGemini(env, "seo", prompt, { json: true, temperature: 0.4 });
    const s = parseJson(r.text);
    return { meta: JSON.stringify({ ...meta, ...s }) };
  },

  async image(env, job, ch, X) {
    const meta = JSON.parse(job.meta || "{}");
    if (!env.PEXELS_API_KEY || !meta.image_query) return {};
    try {
      X.sub++;
      const res = await fetch(
        `https://api.pexels.com/v1/search?per_page=5&orientation=landscape&query=${encodeURIComponent(meta.image_query)}`,
        { headers: { Authorization: env.PEXELS_API_KEY }, signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return {};
      const data = await res.json();
      const p = data.photos && data.photos[0];
      if (!p) return {};
      meta.image = {
        url: p.src.large || p.src.original,
        credit: `Photo by ${p.photographer} on Pexels`,
        credit_url: p.url,
      };
      return { meta: JSON.stringify(meta) };
    } catch {
      return {};
    }
  },

  async finalize(env, job, ch) {
    const meta = JSON.parse(job.meta || "{}");
    const body = job.draft.trim();
    const title = (meta.title || job.topic).trim();
    const notes = [];
    const words = wordCount(body);
    if (words < ch.minWords * 0.8) notes.push(`Short: ${words} words (target ${ch.minWords}+)`);
    const h2 = (body.match(/^## /gm) || []).length;
    if (h2 < 4) notes.push(`Only ${h2} sections`);
    const low = body.toLowerCase();
    const hits = CONFIG.banned.filter((b) => low.includes(b));
    if (hits.length) notes.push(`Cliche phrases: ${hits.join(", ")}`);
    const c2 = JSON.parse(job.check2 || "{}");
    if ((c2.issues || []).length) notes.push(`${c2.issues.length} fact issue(s) were flagged by the second check and sent to the polish pass. Verify key facts.`);
    if (/unverified/i.test(body)) notes.push("Contains the word UNVERIFIED");

    // similarity against existing posts
    const rows = await env.DB.prepare("SELECT title FROM posts").all();
    for (const r of rows.results || []) {
      if (titleSimilarity(title, r.title) >= 0.8) { notes.push(`Very similar to "${r.title}"`); break; }
    }

    let slug = slugify(meta.slug || title) || `post-${job.id}`;
    for (let n = 2; await env.DB.prepare("SELECT 1 FROM posts WHERE slug=?").bind(slug).first(); n++) {
      slug = `${slugify(meta.slug || title)}-${n}`;
    }
    const clean = notes.length === 0;
    const publish = CONFIG.autoPublish && clean;
    const now = nowIso();
    const img = meta.image || {};
    await env.DB.prepare(
      `INSERT INTO posts(job_id,channel,slug,title,description,category,tags,body_md,image_url,image_alt,image_credit,status,quality_notes,created_at,published_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      job.id, ch.id, slug, title, (meta.description || "").slice(0, 200),
      ch.categories.includes(meta.category) ? meta.category : ch.categories[0],
      JSON.stringify(meta.tags || []), body,
      img.url || null, meta.image_alt || title, img.credit ? `${img.credit}|${img.credit_url}` : null,
      publish ? "published" : "draft", notes.join("\n") || null, now, publish ? now : null, now
    ).run();
    await log(env, "info", `Draft ready: ${title}${publish ? " (auto-published)" : ""}`);
    return { __done: true };
  },
};

async function factCheck(env, role, job, ch) {
  const prompt =
    `You are a strict fact-checker. Compare the ARTICLE with the RESEARCH NOTES. List every claim in the article that is not supported by the notes, contradicts them, is an invented number/price/quote/feature, is outdated or likely wrong, or is stated more strongly than the evidence allows. ` +
    `Ignore style. Return JSON: {"verdict": "pass" or "fix", "issues": [{"claim": "exact text", "problem": "why", "fix": "how to correct or remove it"}]}\n\nRESEARCH NOTES:\n${job.research}\n\nARTICLE:\n${job.draft}`;
  const r = await callGemini(env, role, prompt, { json: true, temperature: 0.1 });
  const j = parseJson(r.text);
  j.issues = Array.isArray(j.issues) ? j.issues.slice(0, 12) : [];
  return JSON.stringify(j);
}

// ---------- the scheduler ----------

export async function tick(env) {
  if ((await getSetting(env, "paused", "0")) === "1") return { skipped: "paused" };
  const X = { sub: 0 };
  for (const ch of CONFIG.channels) {
    await runChannel(env, ch, X);
  }
  return { ok: true };
}

async function runChannel(env, ch, X) {
  const day = istDay();
  const cap = CONFIG.gemini.dailyCallCap - CONFIG.gemini.reserveCalls;
  let job = await env.DB.prepare(
    "SELECT * FROM jobs WHERE channel=? AND status='running' ORDER BY id LIMIT 1"
  ).bind(ch.id).first();

  if (!job) {
    const used = await usageToday(env, day);
    if (cap - used < CONFIG.gemini.callsPerPost) return;
    const made = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM jobs WHERE channel=? AND day=? AND status IN ('running','done')"
    ).bind(ch.id, day).first();
    // Target is the goal; anything up to the maximum is only started when budget remains.
    if (made.n >= ch.maxPostsPerDay) return;
    const now = nowIso();
    const ins = await env.DB.prepare(
      "INSERT INTO jobs(channel,day,stage,status,created_at,updated_at) VALUES(?,?,?,?,?,?)"
    ).bind(ch.id, day, "topic", "running", now, now).run();
    job = await env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(ins.meta.last_row_id).first();
    await log(env, "info", `Started job ${job.id}`);
  }

  for (let i = 0; i < CONFIG.maxStagesPerTick; i++) {
    if (X.sub >= CONFIG.maxSubrequestsPerTick) break;
    const stage = job.stage;
    try {
      const patch = await STAGES[stage](env, job, ch, X);
      if (patch.__done) {
        await env.DB.prepare("UPDATE jobs SET status='done', updated_at=? WHERE id=?").bind(nowIso(), job.id).run();
        return;
      }
      const next = ORDER[ORDER.indexOf(stage) + 1];
      await updateJob(env, job.id, { ...patch, stage: next, failures: 0, last_error: patch.last_error ?? null });
      job = await env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(job.id).first();
    } catch (e) {
      if (e instanceof QuotaError) {
        await log(env, "warn", `Quota reached at stage ${stage}. Will resume later.`);
        return;
      }
      const failures = (job.failures || 0) + 1;
      await log(env, "error", `Job ${job.id} stage ${stage} failed (${failures}): ${e.message}`);
      if (failures >= CONFIG.maxStageFailures) {
        await updateJob(env, job.id, { status: "failed", failures, last_error: e.message });
        await maybeAutoPause(env);
      } else {
        await updateJob(env, job.id, { failures, last_error: e.message });
      }
      return;
    }
  }
}

async function updateJob(env, id, patch) {
  const keys = Object.keys(patch);
  const sets = keys.map((k) => `${k}=?`).join(",");
  await env.DB.prepare(`UPDATE jobs SET ${sets}, updated_at=? WHERE id=?`)
    .bind(...keys.map((k) => patch[k]), nowIso(), id)
    .run();
}

async function maybeAutoPause(env) {
  const since = new Date(Date.now() - 86400000).toISOString();
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM jobs WHERE status='failed' AND updated_at>?"
  ).bind(since).first();
  if (r.n >= CONFIG.autoPauseAfterFailedJobs) {
    await setSetting(env, "paused", "1");
    await log(env, "error", `Auto-paused after ${r.n} failed jobs in 24h. Check the logs, then resume from /admin.`);
  }
}
