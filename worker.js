import { handleProxyRequest } from "./src/proxy-core.js";
import { renderHomePage } from "./src/home-page.js";

const PROXY_PATHS = new Set(["/api/proxy", "/api/v1/proxy", "/api/v2/proxy"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response(renderHomePage(url.origin), {
        headers: {
          "content-type": "text/html; charset=utf-8"
        }
      });
    }

    if (!PROXY_PATHS.has(url.pathname)) {
      return new Response("Not Found", { status: 404 });
    }

    return handleProxyRequest(request, {
      proxyPath: "/api/proxy",
      workerProxyUrl: env?.ANIMESALT_WORKER_PROXY || "",
      fallbackProxyUrl: env?.ANIMESALT_FALLBACK_PROXY || ""
    });
  }
};
