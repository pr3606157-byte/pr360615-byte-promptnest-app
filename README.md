# PromptNest: automated AI-assisted blog on Cloudflare (V1)

One Cloudflare Worker is both the website and the writing machine.
Free tools only: Cloudflare Workers + D1 database, Gemini free API, optional Pexels photos.

## What it does
- Every 30 minutes it advances the daily job. One article = about 10 Gemini calls:
  topic -> research (with Google Search) -> outline -> draft -> fact-check #1 -> fix -> fact-check #2 (different model) -> polish -> SEO -> photo -> quality gate.
- Starts new articles until `maxPostsPerDay` (3) is reached, as long as the daily Gemini budget allows. Set it to 2 if you want exactly two.
- Hard daily Gemini cap (`dailyCallCap`), model fallback, stops and resumes after quota resets.
- Every article lands as a DRAFT on /admin. You approve it from your phone.
- Public site: home, posts, categories, About/Contact/Privacy/Disclaimer, sitemap.xml, robots.txt, rss.xml, Search Console meta tag.
- Affiliate links: empty for now. Later paste `{"Canva": "https://..."}` in /admin/settings and the first mention of each tool in every post (old and new) becomes a link.
- Safety: failed steps retry, a job that fails 3 times is marked failed, 3 failed jobs in 24h auto-pause the tool. Backup button exports everything.

## One-time setup (needs a computer, about 15 minutes)
1. Install Node.js (nodejs.org). Open a terminal in this folder.
2. `npm install`
3. `npx wrangler login`  (log in to your free Cloudflare account)
4. `npx wrangler d1 create promptnest-db`  -> copy the database_id it prints into wrangler.toml
5. `npx wrangler d1 execute promptnest-db --remote --file=schema.sql`
6. Get a free Gemini API key at aistudio.google.com, then:
   `npx wrangler secret put GEMINI_API_KEY`
   `npx wrangler secret put ADMIN_TOKEN`  (make up a long random password)
   `npx wrangler secret put PEXELS_API_KEY`  (optional, free key from pexels.com/api)
7. `npx wrangler deploy`  -> it prints your address, like https://promptnest.YOURNAME.workers.dev
8. Open `https://YOUR-ADDRESS/admin?key=YOUR_ADMIN_TOKEN` on your phone, tap "Run now".
   Put your address in `SITE_URL` in wrangler.toml and deploy again.

## Search Console
1. search.google.com/search-console -> Add property -> URL prefix -> your address.
2. Choose "HTML tag", copy only the content="..." value into `GSC_VERIFICATION` in wrangler.toml, deploy, click Verify.
3. Submit `YOUR-ADDRESS/sitemap.xml`.
Tip: buy a custom domain before applying for AdSense or affiliate programs, and attach it in the Cloudflare dashboard (Workers -> your worker -> Settings -> Domains).

## Edit later
- All settings (models, caps, feeds, niche, voice, post counts) are in `src/config.js`.
- Model names and free limits change. Check ai.google.dev/gemini-api/docs/models and edit the names at the top of config.js.
- Add a niche: add another object to `channels` (V1 shows one channel per site).
- Keep `autoPublish: false` until you trust the quality.

## Before you rely on it
- Read the About, Privacy and Disclaimer text in `src/site.js` and adjust to your situation.
- Review every draft. Fact-checking by AI lowers errors but does not remove them.
