/**
 * One-time migration: uploads the existing local data/*.csv files and
 * public/thumbnails/* images into Vercel Blob, so the app has the same data
 * once it switches from local-disk storage to Blob storage.
 *
 * Run once with: npx tsx src/scripts/migrate-to-blob.ts
 */
import { config } from "dotenv";
import path from "path";
import { readFileSync, readdirSync, existsSync } from "fs";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { put } from "@vercel/blob";

config({ path: path.join(__dirname, "..", "..", "..", ".env") });

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const DATA_DIR = path.join(REPO_ROOT, "data");
const THUMBNAILS_DIR = path.join(REPO_ROOT, "app", "public", "thumbnails");

async function migrateThumbnails(): Promise<Map<string, string>> {
  const urlMap = new Map<string, string>(); // "/thumbnails/x.jpg" -> new Blob URL
  if (!existsSync(THUMBNAILS_DIR)) return urlMap;

  const files = readdirSync(THUMBNAILS_DIR);
  console.log(`Uploading ${files.length} thumbnails...`);

  for (const filename of files) {
    const buffer = readFileSync(path.join(THUMBNAILS_DIR, filename));
    const blob = await put(`thumbnails/${filename}`, buffer, {
      access: "public",
      allowOverwrite: true,
      addRandomSuffix: false,
    });
    urlMap.set(`/thumbnails/${filename}`, blob.url);
    console.log(`  ${filename} -> ${blob.url}`);
  }
  return urlMap;
}

async function migrateCsv(filename: string, transform?: (rows: Record<string, string>[]) => Record<string, string>[]) {
  const filepath = path.join(DATA_DIR, filename);
  if (!existsSync(filepath)) {
    console.log(`  ${filename}: not found locally, skipping`);
    return;
  }
  const content = readFileSync(filepath, "utf-8");
  if (!content.trim()) {
    console.log(`  ${filename}: empty, skipping`);
    return;
  }
  let rows = parse(content, { columns: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];
  if (transform) rows = transform(rows);

  const columns = Object.keys(rows[0] || {});
  const output = stringify(rows, { header: true, columns });
  await put(`data/${filename}`, output, {
    access: "public",
    contentType: "text/csv",
    allowOverwrite: true,
    addRandomSuffix: false,
  });
  console.log(`  ${filename}: uploaded ${rows.length} rows`);
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN not set in .env — add it before running this script");
  }

  const urlMap = await migrateThumbnails();

  console.log("\nUploading CSVs...");
  await migrateCsv("configs.csv");
  await migrateCsv("creators.csv");
  await migrateCsv("videos.csv", (rows) =>
    rows.map((r) => ({
      ...r,
      thumbnail: urlMap.get(r.thumbnail) || r.thumbnail,
    }))
  );

  console.log("\nDone. Existing data is now in Vercel Blob.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
