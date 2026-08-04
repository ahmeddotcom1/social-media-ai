import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { Redis } from "@upstash/redis";
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
const CONFIG_COLUMNS = ["id", "configName", "creatorsCategory", "analysisInstruction", "newConceptsInstruction"];

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
const VIDEO_COLUMNS = ["id", "link", "thumbnail", "creator", "views", "likes", "comments", "analysis", "newConcepts", "datePosted", "dateAdded", "configName", "starred"];

export async function readVideos(): Promise<Video[]> {
  const raw = await readCsv<Record<string, string>>("data:videos.csv");
  return raw.map((r) => ({
    id: r.id || "",
    link: r.link || r.Link || "",
    thumbnail: r.thumbnail || r.Thumbnail || "",
    creator: r.creator || r.Creator || "",
    views: parseInt(r.views || r.Views || "0", 10) || 0,
    likes: parseInt(r.likes || r.Likes || "0", 10) || 0,
    comments: parseInt(r.comments || r.Comments || "0", 10) || 0,
    analysis: r.analysis || r.Analysis || "",
    newConcepts: r.newConcepts || r["newConcepts"] || r["New Concepts"] || "",
    datePosted: r.datePosted || r["Date Posted"] || r["datePosted"] || "",
    dateAdded: r.dateAdded || r["Date Added"] || r["dateAdded"] || "",
    configName: r.configName || r["Config Name"] || r["configName"] || "",
    starred: r.starred === "true",
  }));
}

export async function writeVideos(videos: Video[]) {
  await writeCsv("data:videos.csv", videos as unknown as Record<string, unknown>[], VIDEO_COLUMNS);
}

export async function appendVideo(video: Video) {
  const videos = await readVideos();
  videos.push(video);
  await writeVideos(videos);
}
