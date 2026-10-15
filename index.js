import { tick } from "./pipeline.js";
import { adminHandle } from "./admin.js";
import { siteHandle } from "./site.js";
import { log } from "./util.js";

export default {
  async fetch(req, env, ctx) {
    try {
      const url = new URL(req.url);
      if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
        return await adminHandle(req, env, ctx, url);
      }
      return await siteHandle(req, env, ctx, url);
    } catch (e) {
      ctx.waitUntil(log(env, "error", `Request error: ${e.message}`));
      return new Response("Something went wrong.", { status: 500 });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      tick(env).catch((e) => log(env, "error", `Tick error: ${e.message}`))
    );
  },
};
