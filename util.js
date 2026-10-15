// Small shared helpers: logging, settings, text utilities, RSS parsing.

export const nowIso = () => new Date().toISOString();

export async function log(env, level, message) {
  try {
    await env.DB.prepare("INSERT INTO logs(at,level,message) VALUES(?,?,?)")
      .bind(nowIso(), level, String(message).slice(0, 500))
      .run();
  } catch {}
}

export async function getSetting(env, key, fallback = null) {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key=?").bind(key).first();
  return r ? r.value : fallback;
}

export async function setSetting(env, key, value) {
  await env.DB.prepare(
    "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  ).bind(key, String(value)).run();
}

export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export function wordCount(s) {
  return (String(s || "").match(/\S+/g) || []).length;
}

// Similarity of two titles by shared words (0 to 1)
export function titleSimilarity(a, b) {
  const stop = new Set(["the", "a", "an", "to", "for", "of", "and", "in", "with", "how", "your", "on", "is", "ai"]);
  const w = (x) => new Set(String(x).toLowerCase().match(/[a-z0-9]+/g)?.filter((t) => !stop.has(t)) || []);
  const A = w(a), B = w(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.min(A.size, B.size);
}

function clean(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? clean(m[1]) : "";
}

export function parseFeed(xml) {
  const items = [];
  for (const m of String(xml).matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)) {
    const block = m[0];
    const title = tag(block, "title");
    let link = tag(block, "link");
    if (!link) {
      const h = block.match(/<link[^>]*href="([^"]+)"/i);
      link = h ? h[1] : "";
    }
    const date = tag(block, "pubDate") || tag(block, "updated") || tag(block, "published");
    if (title && link) items.push({ title, link, date });
  }
  return items;
}

export function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(nav|footer|header|aside)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
