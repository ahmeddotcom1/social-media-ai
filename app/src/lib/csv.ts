import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { Redis } from "@upstash/redis";
import { normalizeFormat } from "./format";
import { normalizeHookPattern, normalizeAngle } from "./classify";
import { normalizeNiche } from "./niche";
import type { Config, Creator, Video } from "./types";

// The CSV "database" files (configs/creators/videos) live in Redis, not local
// disk or Vercel Blob — this data is overwritten on every star toggle, config
// edit, and pipeline run, and Blob's public-storage caching (up to 60s to
// reflect an overwrite) made reads lag behind writes. Redis reads/writes are
// immediately consistent, which this data needs. Thumbnails stay in Blob
// (pipeline.ts) since those are write-once and benefit from CDN caching.
const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

async function readCsv<T>(key: string): Promise<T[]> {
  const content = await redis.get<string>(key);
  if (!content || !content.trim()) return [];
  return parse(content, { columns: true, skip_empty_lines: true, relax_column_count: true }) as T[];
}

async function writeCsv(key: string, data: Record<string, unknown>[], columns: string[]) {
  // csv-stringify renders JS booleans as "1"/"" by default, not "true"/"false" —
  // cast explicitly so the read side's `=== "true"` check actually matches.
  const output = stringify(data, { header: true, columns, cast: { boolean: (v) => (v ? "true" : "false") } });
  await redis.set(key, output);
}

// Configs
const CONFIG_COLUMNS = ["id", "configName", "creatorsCategory", "analysisInstruction"];

export async function readConfigs(): Promise<Config[]> {
  return readCsv<Config>("data:configs.csv");
}

export async function writeConfigs(configs: Config[]) {
  await writeCsv("data:configs.csv", configs as unknown as Record<string, unknown>[], CONFIG_COLUMNS);
}

// Creators
const CREATOR_COLUMNS = ["id", "username", "category", "profilePicUrl", "followers", "reelsCount30d", "avgViews30d", "lastScrapedAt"];

export async function readCreators(): Promise<Creator[]> {
  const raw = await readCsv<Record<string, string>>("data:creators.csv");
  return raw.map((r) => ({
    id: r.id || "",
    username: r.username || "",
    category: r.category || "",
    profilePicUrl: r.profilePicUrl || "",
    followers: parseInt(r.followers || "0", 10) || 0,
    reelsCount30d: parseInt(r.reelsCount30d || "0", 10) || 0,
    avgViews30d: parseInt(r.avgViews30d || "0", 10) || 0,
    lastScrapedAt: r.lastScrapedAt || "",
  }));
}

export async function writeCreators(creators: Creator[]) {
  await writeCsv("data:creators.csv", creators as unknown as Record<string, unknown>[], CREATOR_COLUMNS);
}

// Videos
const VIDEO_COLUMNS = [
  "id", "link", "thumbnail", "creator", "platform", "followers",
  "views", "likes", "comments", "shares", "saves",
  "analysis", "transcript", "scriptHook", "scriptBody", "scriptCta", "hook",
  "hookText", "hookPattern", "scriptBeats", "angle", "format", "structure", "framework", "niche", "cta",
  "datePosted", "dateAdded", "configName", "starred",
  "remakeFormat", "assignedPage", "queueStatus", "deadline",
];

// Days between posting and scraping — the elapsed time behind Velocity.
// A fixed snapshot (not "days since today"), so a video's velocity doesn't
// keep drifting downward the longer the app sits open without a new run.
function daysElapsed(datePosted: string, dateAdded: string): number {
  const posted = new Date(datePosted).getTime();
  const added = new Date(dateAdded).getTime();
  if (Number.isNaN(posted) || Number.isNaN(added)) return 1;
  const days = Math.round((added - posted) / (24 * 60 * 60 * 1000));
  return Math.max(1, days);
}

// Empty/missing means the metric was genuinely unavailable from the source
// (see Video.views comment in types.ts) — null, not 0, so it renders as a
// blank cell rather than a fabricated zero. Negative values are Instagram's
// -1 "creator hid this count" sentinel, stored by rows written before
// pipeline.ts's toCount() existed — also null, so they self-heal on the next
// write instead of surfacing as "-1".
function parseCount(raw: string | undefined): number | null {
  if (!raw || raw.trim() === "") return null;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) || n < 0 ? null : n;
}

export async function readVideos(): Promise<Video[]> {
  const raw = await readCsv<Record<string, string>>("data:videos.csv");
  return raw.map((r) => {
    const views = parseCount(r.views || r.Views);
    const followers = parseInt(r.followers || r.Followers || "0", 10) || 0;
    const datePosted = r.datePosted || r["Date Posted"] || r["datePosted"] || "";
    const dateAdded = r.dateAdded || r["Date Added"] || r["dateAdded"] || "";
    const platform = r.platform || r.Platform || "";
    // Instagram's actor never reports a share count, so any stored value on an
    // Instagram row is a legacy fabricated 0, not real data.
    const isInstagram = platform === "Instagram" || (r.link || r.Link || "").includes("instagram.com");

    return {
      id: r.id || "",
      link: r.link || r.Link || "",
      thumbnail: r.thumbnail || r.Thumbnail || "",
      creator: r.creator || r.Creator || "",
      platform,
      followers,
      views,
      likes: parseCount(r.likes || r.Likes),
      comments: parseCount(r.comments || r.Comments),
      shares: isInstagram ? null : parseCount(r.shares || r.Shares),
      saves: parseInt(r.saves || r.Saves || "0", 10) || 0,
      // Derived, not stored — always consistent with the raw fields above,
      // no migration needed for rows written before these signals existed.
      // Both stay null when views itself is unknown — there's nothing to
      // compute a ratio or rate from.
      viewsPerFollower: views !== null && followers > 0 ? Math.round((views / followers) * 10) / 10 : null,
      velocity: views !== null ? Math.round(views / daysElapsed(datePosted, dateAdded)) : null,
      analysis: r.analysis || r.Analysis || "",
      transcript: r.transcript || r.Transcript || "",
      scriptHook: r.scriptHook || r["Script - Hook Line"] || "",
      scriptBody: r.scriptBody || r["Script - Body"] || "",
      scriptCta: r.scriptCta || r["Script - CTA Line"] || "",
      hook: r.hook || r.Hook || "",
      hookText: r.hookText || r["Hook Text"] || "",
      hookPattern: normalizeHookPattern(r.hookPattern || r["Hook Pattern"] || ""),
      scriptBeats: r.scriptBeats || r["Script Beats"] || "",
      angle: normalizeAngle(r.angle || r.Angle || ""),
      format: normalizeFormat(r.format || r.Format || ""),
      structure: r.structure || r.Structure || "",
      framework: r.framework || r.Framework || "",
      niche: normalizeNiche(r.niche || r.Niche || ""),
      cta: r.cta || r.CTA || "",
      datePosted,
      dateAdded,
      configName: r.configName || r["Config Name"] || r["configName"] || "",
      starred: r.starred === "true",
      remakeFormat: r.remakeFormat || r["Remake Format"] || "",
      assignedPage: r.assignedPage || r["Assigned Page"] || "",
      // r.status/r.Status is a read-compat fallback for rows written before
      // the status -> queueStatus rename (see Video.queueStatus comment).
      queueStatus: r.queueStatus || r.status || r.Status || "To Do",
      deadline: r.deadline || r.Deadline || "",
    };
  });
}

export async function writeVideos(videos: Video[]) {
  await writeCsv("data:videos.csv", videos as unknown as Record<string, unknown>[], VIDEO_COLUMNS);
}

export async function appendVideo(video: Video) {
  const videos = await readVideos();
  videos.push(video);
  await writeVideos(videos);
}
