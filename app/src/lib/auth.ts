// Single-account login. Credentials and the signing secret come from env
// (APP_USERNAME / APP_PASSWORD / AUTH_SECRET) — never commit them. The
// session is a stateless HMAC-signed cookie: "<username>.<expiresAtMs>.<sig>".
// Uses Web Crypto only, so it runs the same in Node (dev) and on Workers.

export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

const encoder = new TextEncoder();

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return secret;
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Buffer.from(sig).toString("base64url");
}

// Compare via HMAC digests so the comparison time doesn't leak how many
// leading characters of a guess were right.
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([hmac(`cmp:${a}`), hmac(`cmp:${b}`)]);
  return ha === hb;
}

export async function checkCredentials(username: string, password: string): Promise<boolean> {
  const expectedUser = process.env.APP_USERNAME;
  const expectedPass = process.env.APP_PASSWORD;
  if (!expectedUser || !expectedPass) throw new Error("APP_USERNAME / APP_PASSWORD are not set");
  const [userOk, passOk] = await Promise.all([
    safeEqual(username, expectedUser),
    safeEqual(password, expectedPass),
  ]);
  return userOk && passOk;
}

export async function createSessionToken(username: string): Promise<string> {
  const payload = `${encodeURIComponent(username)}.${Date.now() + SESSION_MAX_AGE_SECONDS * 1000}`;
  return `${payload}.${await hmac(payload)}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const lastDot = token.lastIndexOf(".");
  if (lastDot <= 0) return false;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  const expiresAt = Number(payload.split(".")[1]);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  return safeEqual(sig, await hmac(payload));
}
