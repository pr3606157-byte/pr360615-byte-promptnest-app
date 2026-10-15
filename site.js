import { CONFIG } from "./config.js";
import { esc, getSetting } from "./util.js";
import { md, applyAffiliates } from "./markdown.js";

const CSS = `
:root{--bg:#fbfaf7;--fg:#1d1d1f;--mute:#66666b;--card:#fff;--line:#e6e3dc;--acc:#2f5bea}
@media(prefers-color-scheme:dark){:root{--bg:#121214;--fg:#ececee;--mute:#9a9aa2;--card:#1b1b1f;--line:#2b2b31;--acc:#8aa4ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.7 Georgia,'Times New Roman',serif}
a{color:var(--acc)}header.site{border-bottom:1px solid var(--line);background:var(--card)}
.wrap{max-width:720px;margin:0 auto;padding:0 18px}
header.site .wrap{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;flex-wrap:wrap;gap:8px}
.brand{font:700 22px system-ui,sans-serif;color:var(--fg);text-decoration:none}
nav a{font:15px system-ui,sans-serif;margin-left:14px;color:var(--mute);text-decoration:none}
h1{font:800 32px/1.2 system-ui,sans-serif;margin:28px 0 8px}h2{font:700 24px/1.3 system-ui,sans-serif;margin:34px 0 8px}h3{font:700 19px system-ui,sans-serif;margin:24px 0 6px}
.meta{font:14px system-ui,sans-serif;color:var(--mute)}.lead{font-size:19px;color:var(--mute)}
article img,.hero{max-width:100%;height:auto;border-radius:10px}
.card{display:block;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:16px 0;text-decoration:none;color:var(--fg)}
.card h2{margin:0 0 6px;font-size:21px}.card p{margin:0;color:var(--mute);font-size:16px}
.tag{display:inline-block;font:12px system-ui,sans-serif;background:var(--line);padding:2px 9px;border-radius:99px;margin-right:6px;color:var(--mute)}
blockquote{border-left:3px solid var(--acc);margin:18px 0;padding:2px 16px;color:var(--mute)}
pre{overflow:auto;background:var(--card);border:1px solid var(--line);padding:12px;border-radius:8px}code{font-size:15px}
.note{font:14px system-ui,sans-serif;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 14px;color:var(--mute);margin:18px 0}
footer{border-top:1px solid var(--line);margin-top:48px;padding:22px 0;font:14px system-ui,sans-serif;color:var(--mute)}
footer a{margin-right:14px;color:var(--mute)}.credit{font:13px system-ui,sans-serif;color:var(--mute)}
`;

export function origin(env, req) {
  return (env.SITE_URL || new URL(req.url).origin).replace(/\/$/, "");
}

function layout(env, req, { title, description, path, body, jsonld, noindex, image, type = "website" }) {
  const base = origin(env, req);
  const full = title === CONFIG.site.name ? title : `${title} | ${CONFIG.site.name}`;
  return `<!doctype html><html lang="${CONFIG.site.lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description || CONFIG.site.tagline)}">
${noindex ? '<meta name="robots" content="noindex,nofollow">' : `<link rel="canonical" href="${esc(base + path)}">`}
${env.GSC_VERIFICATION ? `<meta name="google-site-verification" content="${esc(env.GSC_VERIFICATION)}">` : ""}
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description || CONFIG.site.tagline)}">
<meta property="og:type" content="${type}"><meta property="og:site_name" content="${esc(CONFIG.site.name)}">
${image ? `<meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image">` : ""}
<link rel="alternate" type="application/rss+xml" title="${esc(CONFIG.site.name)}" href="/rss.xml">
<style>${CSS}</style>
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>` : ""}
</head><body>
<header class="site"><div class="wrap"><a class="brand" href="/">${esc(CONFIG.site.name)}</a>
<nav><a href="/">Home</a><a href="/about">About</a><a href="/contact">Contact</a></nav></div></header>
<main class="wrap">${body}</main>
<footer><div class="wrap"><a href="/about">About</a><a href="/contact">Contact</a><a href="/privacy">Privacy</a><a href="/disclaimer">Disclaimer</a><a href="/rss.xml">RSS</a>
<p>&copy; ${new Date().getFullYear()} ${esc(CONFIG.site.name)}. Articles are researched with AI assistance and reviewed by a human editor.</p></div></footer>
</body></html>`;
}

function html(body, status = 200, cache = "public, max-age=300") {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": cache } });
}

function card(p) {
  return `<a class="card" href="/post/${esc(p.slug)}"><h2>${esc(p.title)}</h2><p>${esc(p.description || "")}</p>
<div class="meta" style="margin-top:8px">${esc(p.category || "")} &middot; ${esc((p.published_at || "").slice(0, 10))}</div></a>`;
}

const PER_PAGE = 12;

export async function siteHandle(req, env, ctx, url) {
  const p = url.pathname.replace(/\/+$/, "") || "/";

  if (p === "/") return home(env, req, url);
  if (p === "/robots.txt")
    return new Response(`User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${origin(env, req)}/sitemap.xml\n`, { headers: { "content-type": "text/plain" } });
  if (p === "/sitemap.xml") return sitemap(env, req);
  if (p === "/rss.xml") return rss(env, req);
  if (p.startsWith("/post/")) {
    const post = await env.DB.prepare("SELECT * FROM posts WHERE slug=? AND status='published'").bind(decodeURIComponent(p.slice(6))).first();
    if (!post) return notFound(env, req);
    return html(await renderPost(env, req, post));
  }
  if (p.startsWith("/category/")) return category(env, req, decodeURIComponent(p.slice(10)), url);
  const pg = staticPage(env, req, p);
  if (pg) return pg;
  return notFound(env, req);
}

function notFound(env, req) {
  return html(layout(env, req, { title: "Page not found", path: "/404", noindex: true, body: `<h1>Page not found</h1><p><a href="/">Back to the home page</a></p>` }), 404, "no-store");
}

async function home(env, req, url) {
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const rows = await env.DB.prepare("SELECT * FROM posts WHERE status='published' ORDER BY published_at DESC LIMIT ? OFFSET ?")
    .bind(PER_PAGE + 1, (page - 1) * PER_PAGE).all();
  const list = rows.results || [];
  const more = list.length > PER_PAGE;
  const body =
    `<h1>${esc(CONFIG.site.name)}</h1><p class="lead">${esc(CONFIG.site.tagline)}.</p>` +
    (list.length ? list.slice(0, PER_PAGE).map(card).join("") : `<p>New guides are on the way.</p>`) +
    `<p>${page > 1 ? `<a href="/?page=${page - 1}">&larr; Newer</a> ` : ""}${more ? `<a href="/?page=${page + 1}">Older &rarr;</a>` : ""}</p>`;
  return html(layout(env, req, { title: CONFIG.site.name, description: CONFIG.site.tagline, path: "/", body }));
}

async function category(env, req, name, url) {
  const rows = await env.DB.prepare("SELECT * FROM posts WHERE status='published' AND category=? ORDER BY published_at DESC LIMIT 50").bind(name).all();
  const list = rows.results || [];
  if (!list.length) return notFound(env, req);
  const body = `<h1>${esc(name)}</h1>` + list.map(card).join("");
  return html(layout(env, req, { title: name, description: `${name} guides on ${CONFIG.site.name}`, path: `/category/${encodeURIComponent(name)}`, body }));
}

export async function renderPost(env, req, post, { preview = false } = {}) {
  const base = origin(env, req);
  let affiliates = {};
  try { affiliates = JSON.parse((await getSetting(env, "affiliates", "{}")) || "{}"); } catch {}
  const aff = applyAffiliates(post.body_md, affiliates);
  const content = md(aff.md, aff.urls);
  const tags = JSON.parse(post.tags || "[]");
  const [credit, creditUrl] = (post.image_credit || "").split("|");
  const related = await env.DB.prepare("SELECT * FROM posts WHERE status='published' AND id!=? AND category=? ORDER BY published_at DESC LIMIT 3").bind(post.id, post.category || "").all();
  const date = (post.published_at || post.created_at || "").slice(0, 10);
  const jsonld = {
    "@context": "https://schema.org", "@type": "Article", headline: post.title, description: post.description,
    datePublished: post.published_at || post.created_at, dateModified: post.updated_at || post.created_at,
    author: { "@type": "Organization", name: CONFIG.site.author },
    publisher: { "@type": "Organization", name: CONFIG.site.name },
    mainEntityOfPage: `${base}/post/${post.slug}`, ...(post.image_url ? { image: post.image_url } : {}),
  };
  const body =
    (preview ? `<div class="note">Preview. This is a ${esc(post.status)} post and is not public.</div>` : "") +
    `<article><p class="meta"><a href="/category/${encodeURIComponent(post.category || "")}">${esc(post.category || "")}</a> &middot; ${esc(date)}</p>
<h1>${esc(post.title)}</h1><p class="lead">${esc(post.description || "")}</p>
${post.image_url ? `<img class="hero" src="${esc(post.image_url)}" alt="${esc(post.image_alt || post.title)}">${credit ? `<div class="credit"><a href="${esc(creditUrl || "#")}" rel="noopener">${esc(credit)}</a></div>` : ""}` : ""}
${aff.count ? `<div class="note">Some links are affiliate links. If you buy through them we may earn a commission at no extra cost to you. <a href="/disclaimer">Details</a></div>` : ""}
${content}
<p>${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</p></article>
${(related.results || []).length ? `<h2>Keep reading</h2>${related.results.map(card).join("")}` : ""}`;
  return layout(env, req, { title: post.title, description: post.description, path: `/post/${post.slug}`, body, jsonld, image: post.image_url, type: "article", noindex: preview });
}

async function sitemap(env, req) {
  const base = origin(env, req);
  const rows = await env.DB.prepare("SELECT slug, category, updated_at, published_at FROM posts WHERE status='published' ORDER BY published_at DESC LIMIT 2000").all();
  const cats = new Set();
  const urls = [`<url><loc>${base}/</loc></url>`];
  for (const p of ["about", "contact", "privacy", "disclaimer"]) urls.push(`<url><loc>${base}/${p}</loc></url>`);
  for (const r of rows.results || []) {
    if (r.category) cats.add(r.category);
    urls.push(`<url><loc>${esc(base)}/post/${esc(r.slug)}</loc><lastmod>${esc((r.updated_at || r.published_at || "").slice(0, 10))}</lastmod></url>`);
  }
  for (const c of cats) urls.push(`<url><loc>${esc(base)}/category/${encodeURIComponent(c)}</loc></url>`);
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`,
    { headers: { "content-type": "application/xml", "cache-control": "public, max-age=900" } });
}

async function rss(env, req) {
  const base = origin(env, req);
  const rows = await env.DB.prepare("SELECT * FROM posts WHERE status='published' ORDER BY published_at DESC LIMIT 30").all();
  const items = (rows.results || []).map((p) =>
    `<item><title>${esc(p.title)}</title><link>${esc(base)}/post/${esc(p.slug)}</link><guid>${esc(base)}/post/${esc(p.slug)}</guid><pubDate>${new Date(p.published_at).toUTCString()}</pubDate><description>${esc(p.description || "")}</description></item>`).join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(CONFIG.site.name)}</title><link>${esc(base)}</link><description>${esc(CONFIG.site.tagline)}</description>${items}</channel></rss>`,
    { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=900" } });
}

function staticPage(env, req, p) {
  const n = esc(CONFIG.site.name);
  const mail = env.CONTACT_EMAIL ? esc(env.CONTACT_EMAIL) : "";
  const pages = {
    "/about": ["About", `<h1>About ${n}</h1>
<p>${n} helps beginners and freelancers get real work done with AI tools. We write step-by-step guides, honest comparisons and plain explanations of AI news, without hype.</p>
<h2>How we make our articles</h2>
<p>Every article starts from real sources. We use AI tools to help research and draft, then check each claim against those sources, edit for clarity, and have a human editor review before publishing. AI tools and prices change quickly, so always confirm important details on the official website.</p>
<h2>Our promise</h2>
<p>We tell you what a tool can't do as clearly as what it can. If we are wrong, tell us and we will fix it.</p>`],
    "/contact": ["Contact", `<h1>Contact</h1><p>Questions, corrections or partnership ideas are welcome.</p>${mail ? `<p>Email: <a href="mailto:${mail}">${mail}</a></p>` : `<p>Contact details will be added soon.</p>`}`],
    "/privacy": ["Privacy Policy", `<h1>Privacy Policy</h1>
<p>${n} respects your privacy. We do not ask visitors to create accounts and we do not collect personal information through forms on this site.</p>
<h2>Information collected automatically</h2><p>Our hosting provider and analytics tools may collect technical data such as IP address, browser type and pages visited, to keep the site secure and understand how it is used.</p>
<h2>Cookies and advertising</h2><p>If we show ads or use affiliate links, third parties such as Google may use cookies to serve ads based on your visits to this and other sites. You can manage ad personalisation in your Google account settings.</p>
<h2>Third-party links</h2><p>Our articles link to other websites. We are not responsible for their content or privacy practices.</p>
<h2>Contact</h2><p>For privacy questions, see our <a href="/contact">contact page</a>.</p>`],
    "/disclaimer": ["Disclaimer and Affiliate Disclosure", `<h1>Disclaimer and Affiliate Disclosure</h1>
<p>The information on ${n} is for general education only. AI tools, features and prices change often; please verify details on the official website before you buy or rely on them.</p>
<h2>Affiliate disclosure</h2><p>Some links on this site may be affiliate links. If you buy through them we may earn a commission at no extra cost to you. This never changes our opinion of a tool.</p>
<h2>AI-assisted content</h2><p>We use AI tools to help research and draft articles. Each article is fact-checked and reviewed by a human editor before it is published.</p>`],
  };
  const x = pages[p];
  if (!x) return null;
  return html(layout(env, req, { title: x[0], path: p, body: x[1] }));
}
