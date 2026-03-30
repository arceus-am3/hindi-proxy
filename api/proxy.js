import { Readable } from "node:stream";

const DEFAULT_REFERER = "https://www.desidubanime.me/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
const PLAYLIST_CONTENT_TYPES = [
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl"
];
const ALLOWED_HOSTS = new Set([
  "203.188.166.98",
  "185.237.107.230",
  "desidubanime.rpmstream.live",
  "pro.iqsmartgames.com",
  "gdmirrorbot.nl"
]);
const ALLOWED_HOST_SUFFIXES = [
  ".rpmstream.live",
  ".playerp2p.live",
  ".iqsmartgames.com",
  ".gdmirrorbot.nl"
];
const ALLOWED_HOST_PATTERNS = [
  /^185\.237\.\d{1,3}\.\d{1,3}$/,
  /^203\.188\.\d{1,3}\.\d{1,3}$/
];
const REQUEST_HEADER_PASSTHROUGH = [
  "range",
  "if-none-match",
  "if-modified-since"
];
const RESPONSE_HEADER_PASSTHROUGH = [
  "content-type",
  "content-length",
  "cache-control",
  "etag",
  "last-modified",
  "expires",
  "accept-ranges",
  "content-range",
  "content-disposition"
];

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false
  }
};

export default async function handler(req, res) {
  try {
    addCors(res);

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    if (!["GET", "HEAD"].includes(req.method)) {
      sendJson(res, 405, { error: "Only GET, HEAD, OPTIONS allowed" });
      return;
    }

    const requestUrl = new URL(req.url, getOrigin(req));

    if (!requestUrl.searchParams.has("url")) {
      sendJson(res, 200, {
        ok: true,
        message: "Anime HLS proxy running",
        usage: `${getOrigin(req)}/api/proxy?url=${encodeURIComponent("https://example.com/master.m3u8")}`,
        note: "referer optional hai. m3u8 se auto infer ho jayega."
      });
      return;
    }

    const targetUrl = cleanText(requestUrl.searchParams.get("url"));
    const referer = resolveProxyReferer(targetUrl, requestUrl.searchParams.get("referer"));
    const upstreamUrl = parseAllowedUrl(targetUrl);

    if (!upstreamUrl) {
      sendJson(res, 403, { error: "Blocked upstream host" });
      return;
    }

    const upstream = await fetch(upstreamUrl.toString(), {
      method: req.method,
      headers: buildUpstreamHeaders(req.headers, referer),
      redirect: "follow"
    });

    if (!upstream.ok) {
      sendJson(res, upstream.status, { error: `Upstream fetch failed: ${upstream.status}` });
      return;
    }

    writeResponseHeaders(res, upstream.headers);

    if (req.method === "HEAD") {
      res.status(upstream.status).end();
      return;
    }

    if (isPlaylistRequest(upstreamUrl, upstream.headers.get("content-type"))) {
      const playlist = await upstream.text();
      const rewritten = rewriteHlsPlaylist(
        playlist,
        upstreamUrl,
        `${getOrigin(req)}/api/proxy`,
        referer
      );
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
      res.removeHeader("Content-Length");
      res.status(upstream.status).send(rewritten);
      return;
    }

    res.status(upstream.status);

    if (upstream.body) {
      Readable.fromWeb(upstream.body).pipe(res);
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.end(buffer);
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Proxy error"
    });
  }
}

function getOrigin(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";
  return `${protocol}://${host}`;
}

function addCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
}

function sendJson(res, status, data) {
  addCors(res);
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(JSON.stringify(data));
}

function buildUpstreamHeaders(requestHeaders, referer) {
  const headers = new Headers({
    "User-Agent": USER_AGENT,
    Accept: "*/*",
    Referer: referer
  });

  const origin = safeOrigin(referer);

  if (origin) {
    headers.set("Origin", origin);
  }

  for (const name of REQUEST_HEADER_PASSTHROUGH) {
    const value = requestHeaders[name];

    if (value) {
      headers.set(name, value);
    }
  }

  return headers;
}

function writeResponseHeaders(res, sourceHeaders) {
  addCors(res);

  for (const name of RESPONSE_HEADER_PASSTHROUGH) {
    const value = sourceHeaders.get(name);

    if (value) {
      res.setHeader(name, value);
    }
  }
}

function rewriteHlsPlaylist(playlistText, sourceUrl, proxyEndpoint, referer) {
  return playlistText
    .split(/\r?\n/)
    .map((line) => rewritePlaylistLine(line, sourceUrl, proxyEndpoint, referer))
    .join("\n");
}

function rewritePlaylistLine(line, sourceUrl, proxyEndpoint, referer) {
  const trimmed = line.trim();

  if (!trimmed) {
    return line;
  }

  if (trimmed.startsWith("#")) {
    return line.replace(/URI="([^"]+)"/g, (_, value) => {
      const rewritten = buildMediaProxyUrl(
        proxyEndpoint,
        new URL(value, sourceUrl).toString(),
        referer
      );

      return `URI="${rewritten}"`;
    });
  }

  return buildMediaProxyUrl(proxyEndpoint, new URL(trimmed, sourceUrl).toString(), referer);
}

function buildMediaProxyUrl(proxyEndpoint, targetUrl, referer = DEFAULT_REFERER) {
  const proxyUrl = new URL(proxyEndpoint);
  proxyUrl.searchParams.set("url", targetUrl);

  if (referer) {
    proxyUrl.searchParams.set("referer", referer);
  }

  return proxyUrl.toString();
}

function isPlaylistRequest(url, contentType) {
  const normalizedType = cleanText(contentType).toLowerCase();

  if (url.pathname.toLowerCase().endsWith(".m3u8")) {
    return true;
  }

  return PLAYLIST_CONTENT_TYPES.some((type) => normalizedType.includes(type));
}

function parseAllowedUrl(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();

    if (
      ALLOWED_HOSTS.has(host) ||
      ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)) ||
      ALLOWED_HOST_PATTERNS.some((pattern) => pattern.test(host))
    ) {
      return parsed;
    }

    return null;
  } catch {
    return null;
  }
}

function resolveProxyReferer(targetUrl, explicitReferer) {
  const explicit = cleanText(explicitReferer);

  if (explicit) {
    return explicit;
  }

  return inferProxyReferer(targetUrl) || DEFAULT_REFERER;
}

function inferProxyReferer(targetUrl) {
  try {
    const parsed = new URL(targetUrl);

    if (!parsed.pathname.toLowerCase().endsWith(".m3u8")) {
      return "";
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    let playerId = segments.at(-2) || "";

    if (!playerId || playerId.includes(".") || playerId.length < 4 || playerId === "tt") {
      playerId = segments.at(-3) || "";
    }

    return playerId ? `https://desidubanime.rpmstream.live/#${playerId}` : "";
  } catch {
    return "";
  }
}

function safeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function cleanText(value) {
  return String(value ?? "").trim();
}
