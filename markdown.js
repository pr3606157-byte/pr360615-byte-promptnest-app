import { esc } from "./util.js";

// Minimal, safe Markdown renderer (headings, lists, quotes, code, links, images, bold, italic).
export function md(src, affSet = new Set()) {
  const inline = (s) => {
    s = esc(s);
    s = s.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (m, a, u) => `<img src="${u}" alt="${a}" loading="lazy">`);
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, (m, t, u) => {
      const ext = u.startsWith("http");
      const raw = u.replace(/&amp;/g, "&");
      const rel = affSet.has(raw) ? "sponsored nofollow noopener" : ext ? "noopener" : "";
      return `<a href="${u}"${rel ? ` rel="${rel}"` : ""}${ext ? ' target="_blank"' : ""}>${t}</a>`;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    return s;
  };

  const lines = String(src || "").replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  const isBlock = (l) => /^(#{1,6}\s|[-*]\s|\d+[.)]\s|>\s?|```)/.test(l);

  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }

    if (l.startsWith("```")) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = Math.min(Math.max(h[1].length, 2), 4);
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      i++;
      continue;
    }
    if (/^[-*]\s/.test(l)) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^[-*]\s+/, ""))}</li>`);
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\d+[.)]\s/.test(l)) {
      const items = [];
      while (i < lines.length && /^\d+[.)]\s/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\d+[.)]\s+/, ""))}</li>`);
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    if (/^>\s?/.test(l)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !isBlock(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

// Turns the first mention of a tool name into an affiliate link (only in normal paragraph lines).
export function applyAffiliates(text, map) {
  const used = new Set();
  let count = 0;
  const entries = Object.entries(map || {}).filter(([n, u]) => n && /^https?:\/\//.test(u));
  if (!entries.length) return { md: text, count: 0, urls: new Set() };
  const lines = String(text).split("\n");
  let inCode = false;
  const out = lines.map((line) => {
    if (line.startsWith("```")) { inCode = !inCode; return line; }
    if (inCode || /^#{1,6}\s/.test(line) || line.includes("](")) return line;
    for (const [name, url] of entries) {
      if (used.has(name)) continue;
      const re = new RegExp(`(?<![\\w\\[])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w\\]])`);
      if (re.test(line)) {
        line = line.replace(re, `[${name}](${url})`);
        used.add(name);
        count++;
      }
    }
    return line;
  });
  return { md: out.join("\n"), count, urls: new Set(entries.map(([, u]) => u)) };
}
