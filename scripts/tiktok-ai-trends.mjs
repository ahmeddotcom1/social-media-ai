import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually
const envPath = resolve(__dirname, "../.env");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

const TOKEN = process.env.APIFY_API_TOKEN;
if (!TOKEN) throw new Error("APIFY_API_TOKEN not set in .env");

const HASHTAGS = ["ai", "artificialintelligence", "aitools", "chatgpt", "aitutorial"];
const MAX_VIDEOS_PER_TAG = 10;

async function runActor(actorId, input, timeoutSecs = 120) {
  const encodedActor = actorId.replace("/", "~");
  const url = `https://api.apify.com/v2/acts/${encodedActor}/run-sync-get-dataset-items?token=${TOKEN}&timeout=${timeoutSecs}`;
  console.log(`  Running ${actorId}...`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Actor ${actorId} failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return res.json();
}

async function scrapeTrending() {
  console.log("\n=== Step 1: Scraping trending TikTok videos in AI niche ===\n");

  const allVideos = [];

  for (const tag of HASHTAGS) {
    console.log(`Scraping #${tag}...`);
    try {
      const results = await runActor("clockworks/tiktok-hashtag-scraper", {
        hashtags: [tag],
        resultsPerPage: MAX_VIDEOS_PER_TAG,
      }, 180);
      console.log(`  Got ${results.length} videos for #${tag}`);
      allVideos.push(...results.map((v) => ({ ...v, searchTag: tag })));
    } catch (err) {
      console.error(`  Error scraping #${tag}: ${err.message}`);
    }
  }

  return allVideos;
}

function dedupeAndRank(videos) {
  // Dedupe by video ID
  const seen = new Set();
  const unique = [];
  for (const v of videos) {
    const id = v.id || v.videoId || v.webVideoUrl || JSON.stringify(v).slice(0, 100);
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(v);
    }
  }

  // Sort by play count (views) descending
  unique.sort((a, b) => (b.playCount || b.videoPlayCount || 0) - (a.playCount || a.videoPlayCount || 0));

  return unique;
}

async function getTranscripts(videos) {
  console.log("\n=== Step 2: Extracting transcripts for top videos ===\n");

  const top = videos.slice(0, 15); // Get transcripts for top 15
  const urls = top
    .map((v) => v.webVideoUrl || v.videoUrl || v.url)
    .filter(Boolean);

  if (urls.length === 0) {
    console.log("  No video URLs found for transcripts");
    return [];
  }

  console.log(`  Fetching transcripts for ${urls.length} videos...`);
  try {
    const results = await runActor("sociavault/tiktok-transcript-scraper", {
      videoUrls: urls,
    }, 300);
    console.log(`  Got ${results.length} transcripts`);
    return results;
  } catch (err) {
    console.error(`  Transcript error: ${err.message}`);
    return [];
  }
}

function buildPresentation(videos, transcripts) {
  const transcriptMap = new Map();
  for (const t of transcripts) {
    const url = t.url || t.videoUrl;
    if (url && t.hasTranscript) transcriptMap.set(url, t.transcript || "");
  }

  const top20 = videos.slice(0, 20);

  let md = `# Trending TikTok Topics in the AI Niche\n`;
  md += `### Scraped ${new Date().toLocaleDateString()} via Apify\n\n`;
  md += `**Total videos found:** ${videos.length} | **Unique after dedup:** ${top20.length} shown (top by views)\n\n`;
  md += `---\n\n`;

  // Summary section - group by themes
  md += `## Key Themes & Topics\n\n`;

  const tagCounts = {};
  for (const v of videos) {
    const tag = v.searchTag || "unknown";
    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
  }
  md += `### Hashtag Distribution\n\n`;
  for (const [tag, count] of Object.entries(tagCounts).sort((a, b) => b[1] - a[1])) {
    md += `- **#${tag}**: ${count} videos\n`;
  }
  md += `\n---\n\n`;

  // Top videos
  md += `## Top Viral Videos (by views)\n\n`;

  for (let i = 0; i < top20.length; i++) {
    const v = top20[i];
    const views = v.playCount || v.videoPlayCount || 0;
    const likes = v.diggCount || v.likesCount || 0;
    const comments = v.commentCount || v.commentsCount || 0;
    const shares = v.shareCount || 0;
    const author = v.authorMeta?.name || v.authorMeta?.nickName || v.ownerUsername || v.author || "Unknown";
    const desc = v.text || v.description || v.caption || "";
    const url = v.webVideoUrl || v.videoUrl || v.url || "";
    const hashtags = v.hashtags?.map((h) => `#${h.name || h}`).join(" ") || "";

    md += `### ${i + 1}. ${author}\n\n`;
    md += `**Views:** ${views.toLocaleString()} | **Likes:** ${likes.toLocaleString()} | **Comments:** ${comments.toLocaleString()} | **Shares:** ${shares.toLocaleString()}\n\n`;
    if (desc) md += `**Caption:** ${desc.slice(0, 300)}\n\n`;
    if (hashtags) md += `**Tags:** ${hashtags}\n\n`;
    if (url) md += `**Link:** ${url}\n\n`;

    // Add transcript if available
    const transcript = transcriptMap.get(url);
    if (transcript) {
      const cleanTranscript = typeof transcript === "string" ? transcript : JSON.stringify(transcript);
      md += `<details><summary>Transcript</summary>\n\n${cleanTranscript.slice(0, 1000)}\n\n</details>\n\n`;
    }

    md += `---\n\n`;
  }

  // Insights section
  md += `## Insights for Content Strategy\n\n`;
  md += `### What's Working in AI TikTok Right Now\n\n`;
  md += `1. **Top performing hashtags:** ${Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).map(([t]) => `#${t}`).join(", ")}\n`;
  md += `2. **Average views (top 20):** ${Math.round(top20.reduce((s, v) => s + (v.playCount || v.videoPlayCount || 0), 0) / top20.length).toLocaleString()}\n`;
  md += `3. **Average engagement rate:** ${(top20.reduce((s, v) => {
    const views = v.playCount || v.videoPlayCount || 1;
    const likes = v.diggCount || v.likesCount || 0;
    return s + likes / views;
  }, 0) / top20.length * 100).toFixed(1)}%\n\n`;

  return md;
}

// Main
async function main() {
  console.log("TikTok AI Niche Trends Scraper");
  console.log("==============================\n");

  const rawVideos = await scrapeTrending();
  console.log(`\nTotal raw results: ${rawVideos.length}`);

  const ranked = dedupeAndRank(rawVideos);
  console.log(`After dedup & ranking: ${ranked.length}`);

  // Save raw data
  const dataPath = resolve(__dirname, "../outputs/tiktok-ai-raw.json");
  writeFileSync(dataPath, JSON.stringify(ranked, null, 2));
  console.log(`Raw data saved to ${dataPath}`);

  const transcripts = await getTranscripts(ranked);

  const presentation = buildPresentation(ranked, transcripts);
  const presPath = resolve(__dirname, "../outputs/tiktok-ai-trends.md");
  writeFileSync(presPath, presentation);
  console.log(`\nPresentation saved to ${presPath}`);

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
