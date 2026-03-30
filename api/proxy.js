const { Readable } = require("node:stream");

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

module.exports = async function handler(req, res) {
  const requestUrl = new URL(req.url, getOrigin(req));

  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!["GET", "HEAD"].includes(req.method || "GET")) {
    return sendJson(res, 405, { error: "Only GET and HEAD allowed" });
  }

  if (!requestUrl.searchParams.has("url")) {
    return sendJson(res, 200, {
      ok: true,
      message: "Anime HLS proxy running on Vercel",
      usage: `${requestUrl.origin}/api/proxy?url=${encodeURIComponent("https://example.com/master.m3u8")}`,
      note: "referer optional hai. m3u8 link se auto infer ho jayega."
    });
  }

  const targetUrl = cleanText(requestUrl.searchParams.get("url"));
  const referer = resolveProxyReferer(targetUrl, requestUrl.searchParams.get("referer"));

  if (!targetUrl) {
    return sendJson(res, 400, { error: "Missing url query parameter" });
  }

  const upstreamUrl = parseAllowedUrl(targetUrl);

  if (!upstreamUrl) {
    return sendJson(res, 403, { error: "Blocked upstream host" });
  }

  const upstream = await fetch(upstreamUrl.toString(), {
    method: req.method === "HEAD" ? "HEAD" : "GET",
    headers: buildUpstreamHeaders(req.headers, referer),
    redirect: "follow"
  });

  if (!upstream.ok) {
    return sendJson(res, upstream.status, { error: `Upstream fetch failed: ${upstream.status}` });
  }

  copyResponseHeaders(res, upstream.headers);

  if (req.method === "HEAD") {
    res.statusCode = upstream.status;
    res.end();
    return;
  }

  if (isPlaylistRequest(upstreamUrl, upstream.headers.get("content-type"))) {
    const playlist = await upstream.text();
    const rewritten = rewriteHlsPlaylist(
      playlist,
      upstreamUrl,
      `${requestUrl.origin}/api/proxy`,
      referer
    );

    res.statusCode = upstream.status;
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
    res.removeHeader("Content-Length");
    res.end(rewritten);
    return;
  }

  res.statusCode = upstream.status;

  if (!upstream.body) {
    res.end();
    return;
  }

  Readable.fromWeb(upstream.body).pipe(res);
};

function getOrigin(req) {
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host || "localhost";
  return `${protocol}://${host}`;
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function buildUpstreamHeaders(requestHeaders, referer) {
  const headers = new Headers({
    "User-Agent": USER_AGENT,
    "Accept": "*/*",
    "Referer": referer
  });
  const origin = safeOrigin(referer);

  if (origin) {
    headers.set("Origin", origin);
  }

  for (const name of REQUEST_HEADER_PASSTHROUGH) {
    const value = getHeaderValue(requestHeaders, name);

    if (value) {
      headers.set(name, value);
    }
  }

  return headers;
}

function copyResponseHeaders(res, sourceHeaders) {
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

function getHeaderValue(headersLike, name) {
  const lower = String(name || "").toLowerCase();
  const value = headersLike?.[lower] ?? headersLike?.[name];

  if (Array.isArray(value)) {
    return value[0] || "";
  }

  return value || "";
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
