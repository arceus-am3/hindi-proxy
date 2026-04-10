import { Readable } from "node:stream";
import { handleProxyRequest } from "../src/proxy-core.js";

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false
  }
};

export default async function handler(req, res) {
  try {
    const request = createNodeRequest(req);
    const response = await handleProxyRequest(request, {
      proxyPath: "/api/proxy",
      workerProxyUrl: process.env.ANIMESALT_WORKER_PROXY || ""
    });

    await sendNodeResponse(res, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Proxy error";
    const response = new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
        "access-control-allow-headers": "*"
      }
    });

    await sendNodeResponse(res, response);
  }
}

function createNodeRequest(req) {
  const body =
    req.method === "GET" || req.method === "HEAD"
      ? undefined
      : Readable.toWeb(req);
  const init = {
    method: req.method,
    headers: req.headers
  };

  if (body) {
    init.body = body;
    init.duplex = "half";
  }

  return new Request(new URL(req.url, getOrigin(req)), init);
}

function getOrigin(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";
  return `${protocol}://${host}`;
}

async function sendNodeResponse(res, response) {
  response.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });

  res.status(response.status);

  if (!response.body) {
    res.end();
    return;
  }

  Readable.fromWeb(response.body).pipe(res);
}

