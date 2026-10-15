import { CONFIG } from "./config.js";
import { esc, getSetting, setSetting, slugify, nowIso, log } from "./util.js";
import { usageToday, istDay } from "./gemini.js";
import { tick } from "./pipeline.js";
import { renderPost } from "./site.js";

const CSS = `body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f4f4f6;color:#1d1d1f}
.w{max-width:760px;margin:0 auto;padding:14px}h1{font-size:22px}h2{font-size:18px;margin-top:26px}
.c{background:#fff;border:1px solid #e1e1e6;border-radius:10px;padding:12px 14px;margin:10px 0}
a{color:#2f5bea}input,textarea,select{width:100%;padding:10px;border:1px solid #c9c9d1;border-radius:8px;font:inherit;margin:4px 0 10px}
textarea{min-height:320px;font-family:ui-monospace,monospace;font-size:14px}
button{padding:10px 16px;border:0;border-radius:8px;background:#2f5bea;color:#fff;font:inherit;margin:4px 6px 4px 0}
button.g{background:#1a8f4d}button.r{background:#c0392b}button.n{background:#6b6b75}
.m{color:#6b6b75;font-size:14px}.warn{color:#b35a00}.err{color:#c0392b}nav a{margin-right:14px}`;

function page(title, body) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="w"><nav><a href="/admin">Dashboard</a><a href="/admin/settings">Settings</a><a href="/admin/export">Backup</a><a href="/" target="_blank">View site</a></nav>${body}</div></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}

const redirect = (to) => new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store" } });

function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function authed(req, env) {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)pn_admin=([^;]+)/);
  return !!(m && env.ADMIN_TOKEN && safeEqual(decodeURIComponent(m[1]), env.ADMIN_TOKEN));
}

export async function adminHandle(req, env, ctx, url) {
  if (!env.ADMIN_TOKEN) return page("Setup", `<h1>Admin not set up</h1><p>Set the ADMIN_TOKEN secret, then reload.</p>`);

  // Login via /admin?key=TOKEN (sets a cookie)
  const key = url.searchParams.get("key");
  if (key !== null) {
    if (safeEqual(key, env.ADMIN_TOKEN)) {
      return new Response(null, {
        status: 303,
        headers: {
          location: "/admin",
          "set-cookie": `pn_admin=${encodeURIComponent(key)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`,
        },
      });
    }
    return page("Login", `<h1>Wrong key</h1>`);
  }
  if (!authed(req, env)) return page("Login", `<h1>Admin</h1><p>Open <code>/admin?key=YOUR_ADMIN_TOKEN</code> once on this device.</p>`);

  const p = url.pathname.replace(/\/+$/, "");
  const post = req.method === "POST";

  if (p === "/admin" && !post) return dashboard(env);
  if (p === "/admin/run" && post) { ctx.waitUntil(tick(env)); return redirect("/admin"); }
  if (p === "/admin/pause" && post) { await setSetting(env, "paused", "1"); await log(env, "info", "Paused from admin"); return redirect("/admin"); }
  if (p === "/admin/resume" && post) { await setSetting(env, "paused", "0"); await log(env, "info", "Resumed from admin"); return redirect("/admin"); }
  if (p === "/admin/settings") return settings(req, env, post);
  if (p === "/admin/export") return exportAll(env);
  if (p === "/admin/retry" && post) {
    const id = (await req.formData()).get("id");
    await env.DB.prepare("UPDATE jobs SET status='running', failures=0, updated_at=? WHERE id=? AND status='failed'").bind(nowIso(), id).run();
    return redirect("/admin");
  }

  let m = p.match(/^\/admin\/post\/(\d+)$/);
  if (m) return editPost(req, env, +m[1], post);
  m = p.match(/^\/admin\/preview\/(\d+)$/);
  if (m) {
    const row = await env.DB.prepare("SELECT * FROM posts WHERE id=?").bind(+m[1]).first();
    if (!row) return page("Not found", "<h1>Not found</h1>");
    return new Response(await renderPost(env, req, row, { preview: true }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
  return page("Not found", "<h1>Not found</h1>");
}

async function dashboard(env) {
  const day = istDay();
  const used = await usageToday(env, day);
  const paused = (await getSetting(env, "paused", "0")) === "1";
  const drafts = (await env.DB.prepare("SELECT id,title,quality_notes,created_at FROM posts WHERE status='draft' ORDER BY id DESC LIMIT 30").all()).results || [];
  const pub = (await env.DB.prepare("SELECT id,title,published_at FROM posts WHERE status='published' ORDER BY published_at DESC LIMIT 10").all()).results || [];
  const counts = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM posts WHERE status='published') AS pub, (SELECT COUNT(*) FROM posts WHERE status='draft') AS dr").first();
  const jobs = (await env.DB.prepare("SELECT id,topic,stage,status,failures,last_error FROM jobs WHERE status IN ('running','failed') ORDER BY id DESC LIMIT 6").all()).results || [];
  const logs = (await env.DB.prepare("SELECT at,level,message FROM logs ORDER BY id DESC LIMIT 15").all()).results || [];

  const body = `<h1>${esc(CONFIG.site.name)} admin</h1>
<div class="c"><b>${paused ? '<span class="err">PAUSED</span>' : "Running"}</b> &middot; Gemini calls today: ${used} / ${CONFIG.gemini.dailyCallCap} &middot; Published: ${counts.pub} &middot; Drafts: ${counts.dr}
<form method="post" action="/admin/run" style="display:inline"><button>Run now</button></form>
<form method="post" action="/admin/${paused ? "resume" : "pause"}" style="display:inline"><button class="${paused ? "g" : "n"}">${paused ? "Resume" : "Pause"}</button></form></div>
<h2>Drafts to review (${drafts.length})</h2>
${drafts.map((d) => `<div class="c"><a href="/admin/post/${d.id}"><b>${esc(d.title)}</b></a>${d.quality_notes ? `<div class="warn m">${esc(d.quality_notes).replace(/\n/g, "<br>")}</div>` : `<div class="m">No warnings</div>`}</div>`).join("") || `<p class="m">No drafts yet.</p>`}
<h2>Jobs in progress / failed</h2>
${jobs.map((j) => `<div class="c">#${j.id} ${esc(j.topic || "(choosing topic)")}<div class="m">stage: ${esc(j.stage)} &middot; ${esc(j.status)}${j.last_error ? ` &middot; <span class="err">${esc(j.last_error)}</span>` : ""}</div>${j.status === "failed" ? `<form method="post" action="/admin/retry"><input type="hidden" name="id" value="${j.id}"><button class="n">Retry</button></form>` : ""}</div>`).join("") || `<p class="m">None.</p>`}
<h2>Published (latest)</h2>
${pub.map((d) => `<div class="c"><a href="/admin/post/${d.id}">${esc(d.title)}</a> <span class="m">${esc((d.published_at || "").slice(0, 10))}</span></div>`).join("") || `<p class="m">Nothing published yet.</p>`}
<h2>Recent activity</h2>
<div class="c m">${logs.map((l) => `${esc(l.at.slice(5, 16).replace("T", " "))} [${esc(l.level)}] ${esc(l.message)}`).join("<br>") || "No activity yet."}</div>`;
  return page("Admin", body);
}

async function editPost(req, env, id, isPost) {
  let row = await env.DB.prepare("SELECT * FROM posts WHERE id=?").bind(id).first();
  if (!row) return page("Not found", "<h1>Not found</h1>");

  if (isPost) {
    const f = await req.formData();
    const action = f.get("action");
    const now = nowIso();
    const title = String(f.get("title") || row.title).trim();
    let slug = slugify(String(f.get("slug") || row.slug)) || row.slug;
    const clash = await env.DB.prepare("SELECT 1 FROM posts WHERE slug=? AND id!=?").bind(slug, id).first();
    if (clash) slug = row.slug;
    const tags = JSON.stringify(String(f.get("tags") || "").split(",").map((s) => s.trim()).filter(Boolean));
    await env.DB.prepare("UPDATE posts SET title=?,slug=?,description=?,category=?,tags=?,body_md=?,updated_at=? WHERE id=?")
      .bind(title, slug, String(f.get("description") || ""), String(f.get("category") || ""), tags, String(f.get("body") || row.body_md), now, id).run();
    if (action === "publish") await env.DB.prepare("UPDATE posts SET status='published', published_at=COALESCE(published_at,?) WHERE id=?").bind(now, id).run();
    if (action === "unpublish") await env.DB.prepare("UPDATE posts SET status='draft' WHERE id=?").bind(id).run();
    if (action === "reject") await env.DB.prepare("UPDATE posts SET status='rejected' WHERE id=?").bind(id).run();
    return redirect(action === "save" ? `/admin/post/${id}` : "/admin");
  }

  const cats = (CONFIG.channels.find((c) => c.id === row.channel) || CONFIG.channels[0]).categories;
  const body = `<h1>${esc(row.status)} post</h1>
${row.quality_notes ? `<div class="c warn">${esc(row.quality_notes).replace(/\n/g, "<br>")}</div>` : ""}
<p><a href="/admin/preview/${id}" target="_blank">Preview</a></p>
<form method="post">
<label>Title<input name="title" value="${esc(row.title)}"></label>
<label>Description<input name="description" value="${esc(row.description || "")}"></label>
<label>Slug<input name="slug" value="${esc(row.slug)}"></label>
<label>Category<select name="category">${cats.map((c) => `<option${c === row.category ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
<label>Tags (comma separated)<input name="tags" value="${esc(JSON.parse(row.tags || "[]").join(", "))}"></label>
<label>Article (Markdown)<textarea name="body">${esc(row.body_md)}</textarea></label>
<button name="action" value="save" class="n">Save</button>
${row.status === "published" ? `<button name="action" value="unpublish" class="n">Unpublish</button>` : `<button name="action" value="publish" class="g">Save and publish</button>`}
<button name="action" value="reject" class="r" onclick="return confirm('Reject this post?')">Reject</button>
</form>`;
  return page("Edit post", body);
}

async function settings(req, env, isPost) {
  if (isPost) {
    const f = await req.formData();
    const raw = String(f.get("affiliates") || "{}").trim() || "{}";
    try {
      const obj = JSON.parse(raw);
      if (typeof obj !== "object" || Array.isArray(obj)) throw new Error("must be an object");
      await setSetting(env, "affiliates", JSON.stringify(obj));
      return redirect("/admin/settings");
    } catch (e) {
      return page("Settings", `<h1>Settings</h1><p class="err">That is not valid JSON: ${esc(e.message)}</p><p><a href="/admin/settings">Back</a></p>`);
    }
  }
  const cur = await getSetting(env, "affiliates", "{}");
  const pretty = (() => { try { return JSON.stringify(JSON.parse(cur), null, 2); } catch { return "{}"; } })();
  return page("Settings", `<h1>Affiliate links</h1>
<p class="m">Add a tool name and your affiliate link. The first mention of that name in each post becomes a link automatically, on old and new posts. Example:<br><code>{"Canva": "https://your-affiliate-link"}</code><br>Leave as <code>{}</code> until you are approved.</p>
<form method="post"><textarea name="affiliates" style="min-height:160px">${esc(pretty)}</textarea><button>Save</button></form>`);
}

async function exportAll(env) {
  const posts = (await env.DB.prepare("SELECT * FROM posts ORDER BY id").all()).results || [];
  const settingsRows = (await env.DB.prepare("SELECT * FROM settings").all()).results || [];
  return new Response(JSON.stringify({ exported_at: nowIso(), posts, settings: settingsRows }, null, 1), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="promptnest-backup-${istDay()}.json"`, "cache-control": "no-store" },
  });
}
