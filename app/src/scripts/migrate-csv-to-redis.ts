/**
 * One-time migration: moves the CSV "database" content (configs, creators,
 * videos) out of Vercel Blob and into Redis, since Blob's public-storage
 * caching doesn't give immediate read-after-write consistency for data that's
 * overwritten frequently. Thumbnails stay in Blob (write-once, unaffected).
 *
 * Run once with: npx tsx src/scripts/migrate-csv-to-redis.ts
 */
import { config } from "dotenv";
import path from "path";
import { get } from "@vercel/blob";
import { Redis } from "@upstash/redis";

config({ path: path.join(__dirname, "..", "..", "..", ".env") });

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

async function migrateFile(filename: string) {
  const result = await get(`data/${filename}`, { access: "public", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) {
    console.log(`  ${filename}: not found in Blob, skipping`);
    return;
  }
  const content = await new Response(result.stream).text();
  await redis.set(`data:${filename}`, content);
  const lines = content.trim().split("\n").length - 1;
  console.log(`  ${filename}: moved ${lines} rows to Redis`);
}

async function main() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    throw new Error("KV_REST_API_URL / KV_REST_API_TOKEN not set in .env — add them before running this script");
  }
  console.log("Migrating CSV data from Blob to Redis...");
  await migrateFile("configs.csv");
  await migrateFile("creators.csv");
  await migrateFile("videos.csv");
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
