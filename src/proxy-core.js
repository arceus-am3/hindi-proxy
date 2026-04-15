const DEFAULT_REFERER = "https://www.desidubanime.me/";
const PROXY_PATH_ALIASES = new Set(["/api/proxy", "/api/v1/proxy", "/api/v2/proxy"]);
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
  "as-cdn21.top",
  "desidubanime.rpmstream.live",
  "pro.iqsmartgames.com",
  "gdmirrorbot.nl"
]);
const ALLOWED_HOST_SUFFIXES = [
  ".rpmstream.live",
  ".playerp2p.live",
  ".vmeas.cloud",
  ".vidmoly.me",
  ".vidmoly.net",
  ".vmwesa.online",
  ".iqsmartgames.com",
  ".gdmirrorbot.nl"
];
const ALLOWED_HOST_PATTERNS = [
  /^as-cdn\d+\.top$/i,
  /^185\.237\.\d{1,3}\.\d{1,3}$/,
  /^203\.188\.\d{1,3}\.\d{1,3}$/
];
const REQUEST_HEADER_PASSTHROUGH = [
  "range",
  "if-none-match",
  "if-modified-since",
  "content-type",
  "x-requested-with",
  "accept"
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
const PLAYLIST_CACHE_CONTROL = "public, max-age=5, s-maxage=5, stale-while-revalidate=30";
const SEGMENT_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400, immutable";
const DEFAULT_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=60";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8"
};

export async function handleProxyRequest(request, options = {}) {
  const proxyPath = options.proxyPath || "/api/proxy";
  const workerProxyUrl = cleanText(options.workerProxyUrl);
  const requestUrl = new URL(request.url);
  const proxyEndpoint = new URL(proxyPath, requestUrl.origin).toString();

  if (request.method === "OPTIONS") {
    return createResponse(null, {
      status: 204
    });
  }

  if (!["GET", "HEAD", "POST"].includes(request.method)) {
    return jsonResponse(405, { error: "Only GET, HEAD, POST, OPTIONS allowed" });
  }

  if (!requestUrl.searchParams.has("url")) {
    return jsonResponse(200, {
      ok: true,
      message: "Anime HLS proxy running",
      usage: `${proxyEndpoint}?url=${encodeURIComponent(
        "https://example.com/master.m3u8"
      )}`,
      aliases: [
        `${requestUrl.origin}/api/v1/proxy?url=${encodeURIComponent(
          "https://example.com/master.m3u8"
        )}`,
        `${requestUrl.origin}/api/v2/proxy?url=${encodeURIComponent(
          "https://example.com/master.m3u8"
        )}`
      ],
      note: "referer  m3u8&referer=https%3A%2F%2Fdesidubanime.rpmstream.live%2F%23q5wdp."
    });
  }

  const targetUrl = cleanText(requestUrl.searchParams.get("url"));
  const referer = resolveProxyReferer(
    targetUrl,
    requestUrl.searchParams.get("referer")
  );
  const preferredAudio = cleanText(
    requestUrl.searchParams.get("audio") ||
      requestUrl.searchParams.get("preferredAudio")
  );
  const audioMode = normalizeAudioMode(requestUrl.searchParams.get("audioMode"));
  const upstreamUrl = parseAllowedUrl(targetUrl);
  const workerFallbackUrl = buildWorkerFallbackUrl(
    workerProxyUrl,
    requestUrl,
    upstreamUrl,
    referer,
    preferredAudio,
    audioMode
  );

  if (!upstreamUrl) {
    return jsonResponse(403, { error: "Blocked upstream host" });
  }

  const upstreamInit = {
    method: request.method,
    headers: workerFallbackUrl
      ? buildProxyForwardHeaders(request.headers)
      : buildUpstreamHeaders(request.headers, referer),
    redirect: "follow"
  };

  if (request.method === "POST") {
    upstreamInit.body = request.body;
    upstreamInit.duplex = "half";
  }

  const primaryTarget = workerFallbackUrl || upstreamUrl;
  let upstream = await fetch(primaryTarget, upstreamInit);
  let responseSource = workerFallbackUrl ? "worker-fallback" : "direct";

  if (!upstream.ok) {
    return jsonResponse(upstream.status, {
      error: `Upstream fetch failed: ${upstream.status}`,
      host: upstreamUrl.hostname,
      source: responseSource
    });
  }

  const headers = buildResponseHeaders(upstream.headers);
  applyCachePolicy(headers, upstreamUrl, upstream.headers.get("content-type"));
  headers.set("x-proxy-source", responseSource);

  if (
    !workerFallbackUrl &&
    isPlaylistRequest(upstreamUrl, upstream.headers.get("content-type"))
  ) {
    const playlist = await upstream.text();
    const tunedPlaylist = rewritePreferredAudioPlaylist(
      playlist,
      preferredAudio,
      audioMode
    );
    const rewritten = rewriteHlsPlaylist(
      tunedPlaylist,
      upstreamUrl,
      proxyEndpoint,
      referer,
      {
        preferredAudio,
        audioMode
      }
    );

    headers.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
    headers.delete("content-length");

    return createResponse(request.method === "HEAD" ? null : rewritten, {
      status: upstream.status,
      headers
    });
  }

  const body =
    request.method === "HEAD"
      ? null
      : upstream.body
      ? upstream.body
      : (await upstream.arrayBuffer());

  return createResponse(body, {
    status: upstream.status,
    headers
  });
}

function createResponse(body, init = {}) {
  const headers = new Headers(init.headers || {});
  addCors(headers);
  return new Response(body, {
    ...init,
    headers
  });
}

function jsonResponse(status, data) {
  return createResponse(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}

function addCors(headers) {
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET, HEAD, POST, OPTIONS");
  headers.set("access-control-allow-headers", "*");
}

function buildUpstreamHeaders(requestHeaders, referer) {
  const headers = new Headers({
    "user-agent": USER_AGENT,
    accept: "*/*",
    referer
  });

  const origin = safeOrigin(referer);

  if (origin) {
    headers.set("origin", origin);
  }

  for (const name of REQUEST_HEADER_PASSTHROUGH) {
    const value = requestHeaders.get(name);

    if (value) {
      headers.set(name, value);
    }
  }

  return headers;
}

function buildProxyForwardHeaders(requestHeaders) {
  const headers = new Headers({
    "user-agent": USER_AGENT,
    accept: "*/*"
  });

  for (const name of REQUEST_HEADER_PASSTHROUGH) {
    const value = requestHeaders.get(name);

    if (value) {
      headers.set(name, value);
    }
  }

  return headers;
}

function buildResponseHeaders(sourceHeaders) {
  const headers = new Headers();

  for (const name of RESPONSE_HEADER_PASSTHROUGH) {
    const value = sourceHeaders.get(name);

    if (value) {
      headers.set(name, value);
    }
  }

  return headers;
}

function applyCachePolicy(headers, upstreamUrl, contentType) {
  const cacheControl = resolveCacheControl(upstreamUrl, contentType);

  headers.set("cache-control", cacheControl);
  headers.set("cdn-cache-control", cacheControl);
  headers.set("vercel-cdn-cache-control", cacheControl);
}

function resolveCacheControl(url, contentType) {
  if (isPlaylistRequest(url, contentType)) {
    return PLAYLIST_CACHE_CONTROL;
  }

  if (isMediaSegmentRequest(url, contentType)) {
    return SEGMENT_CACHE_CONTROL;
  }

  return DEFAULT_CACHE_CONTROL;
}

function rewriteHlsPlaylist(
  playlistText,
  sourceUrl,
  proxyEndpoint,
  referer,
  options = {}
) {
  return playlistText
    .split(/\r?\n/)
    .map((line) =>
      rewritePlaylistLine(line, sourceUrl, proxyEndpoint, referer, options)
    )
    .join("\n");
}

function rewritePlaylistLine(
  line,
  sourceUrl,
  proxyEndpoint,
  referer,
  options = {}
) {
  const trimmed = line.trim();

  if (!trimmed) {
    return line;
  }

  if (trimmed.startsWith("#")) {
    return line.replace(/URI="([^"]+)"/g, (_, value) => {
      const rewritten = buildMediaProxyUrl(
        proxyEndpoint,
        new URL(value, sourceUrl).toString(),
        referer,
        options
      );

      return `URI="${rewritten}"`;
    });
  }

  return buildMediaProxyUrl(
    proxyEndpoint,
    new URL(trimmed, sourceUrl).toString(),
    referer,
    options
  );
}

function buildMediaProxyUrl(
  proxyEndpoint,
  targetUrl,
  referer = DEFAULT_REFERER,
  options = {}
) {
  const proxyUrl = new URL(proxyEndpoint);
  proxyUrl.searchParams.set("url", targetUrl);

  if (referer) {
    proxyUrl.searchParams.set("referer", referer);
  }

  const preferredAudio = cleanText(options.audio || options.preferredAudio);

  if (preferredAudio) {
    proxyUrl.searchParams.set("audio", preferredAudio);
  }

  const audioMode = normalizeAudioMode(options.audioMode);

  if (audioMode) {
    proxyUrl.searchParams.set("audioMode", audioMode);
  }

  return proxyUrl.toString();
}

function rewritePreferredAudioPlaylist(playlistText, preferredAudio, audioMode) {
  const normalizedPreference = normalizeAudioPreference(preferredAudio);

  if (!normalizedPreference) {
    return playlistText;
  }

  const lines = playlistText.split(/\r?\n/);
  const hasAudioMedia = lines.some((line) =>
    line.trim().startsWith("#EXT-X-MEDIA:TYPE=AUDIO")
  );

  if (!hasAudioMedia) {
    return rewriteCombinedAudioVariantPlaylist(playlistText, normalizedPreference);
  }

  const matchingIndexes = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (!line.startsWith("#EXT-X-MEDIA:")) {
      continue;
    }

    const attrs = parseManifestAttributes(line.slice("#EXT-X-MEDIA:".length));

    if (cleanText(attrs.TYPE).toUpperCase() !== "AUDIO") {
      continue;
    }

    if (matchesPreferredAudio(attrs, normalizedPreference)) {
      matchingIndexes.push(index);
    }
  }

  if (!matchingIndexes.length) {
    return playlistText;
  }

  return lines
    .map((line, index) => {
      const trimmed = line.trim();

      if (!trimmed.startsWith("#EXT-X-MEDIA:")) {
        return line;
      }

      const attrs = parseManifestAttributes(trimmed.slice("#EXT-X-MEDIA:".length));

      if (cleanText(attrs.TYPE).toUpperCase() !== "AUDIO") {
        return line;
      }

      const matched = matchingIndexes.includes(index);

      if (!matched && audioMode === "only") {
        return "";
      }

      return updateManifestBooleanAttribute(
        updateManifestBooleanAttribute(line, "DEFAULT", matched),
        "AUTOSELECT",
        matched
      );
    })
    .filter((line) => line !== "")
    .join("\n");
}

function rewriteCombinedAudioVariantPlaylist(playlistText, preferredAudio) {
  const audioSlot = resolveCombinedAudioSlot(preferredAudio);

  if (!audioSlot) {
    return playlistText;
  }

  return playlistText.replace(/-a\d+(\.m3u8\b)/gi, `-${audioSlot}$1`);
}

function updateManifestBooleanAttribute(line, name, enabled) {
  const value = enabled ? "YES" : "NO";
  const pattern = new RegExp(`([,])${name}=(YES|NO)`, "i");

  if (pattern.test(line)) {
    return line.replace(pattern, `$1${name}=${value}`);
  }

  return `${line},${name}=${value}`;
}

function parseManifestAttributes(input) {
  const attrs = {};
  const pattern = /([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/gi;

  for (const match of input.matchAll(pattern)) {
    const key = cleanText(match[1]).toUpperCase();
    const rawValue = cleanText(match[2]);
    attrs[key] =
      rawValue.startsWith("\"") && rawValue.endsWith("\"")
        ? rawValue.slice(1, -1)
        : rawValue;
  }

  return attrs;
}

function matchesPreferredAudio(attrs, preferredAudio) {
  const candidates = [
    attrs.LANGUAGE,
    attrs.NAME,
    attrs["GROUP-ID"],
    attrs.CHARACTERISTICS
  ];

  return candidates.some((value) => {
    const normalizedValue = normalizeAudioPreference(value);

    if (!normalizedValue) {
      return false;
    }

    return (
      normalizedValue === preferredAudio ||
      normalizedValue.includes(preferredAudio) ||
      preferredAudio.includes(normalizedValue)
    );
  });
}

function normalizeAudioPreference(value) {
  const normalized = cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, "");

  if (!normalized) {
    return "";
  }

  if (/^a\d+$/.test(normalized)) {
    return normalized;
  }

  if (normalized === "hi" || normalized === "hin" || normalized.includes("hindi")) {
    return "hi";
  }

  if (normalized === "en" || normalized.includes("english")) {
    return "en";
  }

  if (normalized === "ja" || normalized.includes("japanese")) {
    return "ja";
  }

  return normalized;
}

function resolveCombinedAudioSlot(preferredAudio) {
  if (!preferredAudio) {
    return "";
  }

  if (/^a\d+$/.test(preferredAudio)) {
    return preferredAudio;
  }

  if (preferredAudio === "hi") {
    return "a1";
  }

  return "";
}

function normalizeAudioMode(value) {
  const normalized = cleanText(value).toLowerCase();
  return normalized === "only" ? "only" : normalized === "default" ? "default" : "";
}

function isPlaylistRequest(url, contentType) {
  const normalizedType = cleanText(contentType).toLowerCase();

  if (url.pathname.toLowerCase().endsWith(".m3u8")) {
    return true;
  }

  return PLAYLIST_CONTENT_TYPES.some((type) => normalizedType.includes(type));
}

function isMediaSegmentRequest(url, contentType) {
  const pathname = cleanText(url?.pathname).toLowerCase();
  const normalizedType = cleanText(contentType).toLowerCase();

  if (
    /\.(ts|m4s|mp4|m4v|cmfv|aac|mp3|vtt|webvtt|jpg|jpeg|png|webp|avif|key)$/i.test(
      pathname
    )
  ) {
    return true;
  }

  return [
    "video/",
    "audio/",
    "application/octet-stream",
    "binary/octet-stream",
    "application/mp4"
  ].some((type) => normalizedType.includes(type));
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
      return normalizeUpstreamUrl(parsed);
    }

    return null;
  } catch {
    return null;
  }
}

function buildWorkerFallbackUrl(
  workerProxyUrl,
  requestUrl,
  upstreamUrl,
  referer,
  preferredAudio = "",
  audioMode = ""
) {
  if (!workerProxyUrl || !upstreamUrl) {
    return null;
  }

  if (!/^as-cdn\d+\.top$/i.test(cleanText(upstreamUrl.hostname))) {
    return null;
  }

  const fallbackUrl = parseWorkerProxyUrl(workerProxyUrl);

  if (!fallbackUrl || isSameProxyTarget(fallbackUrl, requestUrl)) {
    return null;
  }
  fallbackUrl.searchParams.set("url", upstreamUrl.toString());

  if (referer) {
    fallbackUrl.searchParams.set("referer", referer);
  }

  if (preferredAudio) {
    fallbackUrl.searchParams.set("audio", preferredAudio);
  }

  if (audioMode) {
    fallbackUrl.searchParams.set("audioMode", audioMode);
  }

  return fallbackUrl.toString();
}

function parseWorkerProxyUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isSameProxyTarget(proxyUrl, requestUrl) {
  return (
    proxyUrl.origin === requestUrl.origin &&
    PROXY_PATH_ALIASES.has(proxyUrl.pathname.toLowerCase()) &&
    PROXY_PATH_ALIASES.has(requestUrl.pathname.toLowerCase())
  );
}

function normalizeUpstreamUrl(url) {
  const normalized = new URL(url.toString());
  const host = normalized.hostname.toLowerCase();

  // Some RPMStream IP hosts expose expired HTTPS certs but serve HTTP correctly.
  if (
    normalized.protocol === "https:" &&
    ALLOWED_HOST_PATTERNS.slice(1).some((pattern) => pattern.test(host))
  ) {
    normalized.protocol = "http:";
  }

  return normalized;
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

