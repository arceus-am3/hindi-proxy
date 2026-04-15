# Hindi Proxy

This proxy can run on both Vercel and Cloudflare Workers.

## Homepage

- Root `/` shows the live endpoint URLs.
- Proxy endpoints: `/api/proxy`, `/api/v1/proxy`, `/api/v2/proxy`

## Vercel

- Entry: `api/proxy.js`
- Aliases: `/api/v1/proxy`, `/api/v2/proxy`
- Optional env: `ANIMESALT_WORKER_PROXY=https://your-worker-domain/api/v2/proxy`
- Optional env: `ANIMESALT_FALLBACK_PROXY=https://your-backup-proxy-domain/api/proxy`

## Cloudflare Workers

1. Install dependencies: `npm install`
2. Login: `npx wrangler login`
3. Deploy: `npm run deploy:worker`

Worker entrypoints:

- Main file: `worker.js`
- Shared logic: `src/proxy-core.js`
- Recommended env: `ANIMESALT_FALLBACK_PROXY=https://your-vercel-domain.vercel.app/api/proxy`

## Local env

- Use `.env.example` as a template.
- Keep real secrets only in `.env.local`.

## Why Cloudflare origin transfer gets high

When this runs behind Cloudflare on top of Vercel, every video segment request goes:

`Client -> Cloudflare -> Vercel -> upstream host`

That means large HLS media bytes are repeatedly pulled from the origin side. Running the same proxy as a Worker removes the Vercel hop.

## Bandwidth mitigation now built in

- HLS playlists (`.m3u8`) are cached for a few seconds at the CDN edge so updates still refresh quickly.
- Media segments (`.ts`, `.m4s`, `.mp4`, audio chunks, keys, captions) are cached much longer at the CDN edge to cut repeat origin transfer.
- For the biggest savings, make the app hit the Cloudflare Worker first and keep `ANIMESALT_FALLBACK_PROXY` pointed at Vercel only as a rescue path for `403`, `429`, or `5xx` upstream failures.
