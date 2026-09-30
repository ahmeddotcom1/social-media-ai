// @vercel/blob imports `fetch` from undici, whose socket layer can't connect
// inside a Cloudflare Worker — Blob uploads just retry until they time out.
// next.config.ts aliases "undici" to this file so it uses the platform's
// native fetch instead (Node 18+ and workerd both provide one). Mirrors the
// undici-browser.js shim @vercel/blob ships for browser builds.
export const fetch = globalThis.fetch.bind(globalThis);
