import { put } from "@vercel/blob";
import { v4 as uuid } from "uuid";
import { readConfigs, readCreators, readVideos, writeVideos } from "./csv";
import { scrapeReels, scrapeReelsByUrls, scrapeFacebookReelsByUrls } from "./apify";
import { uploadVideo, analyzeVideo, extractScript } from "./gemini";
import type { Config, Creator, LinkPipelineParams, PipelineParams, PipelineProgress, Video, ActiveTask } from "./types";

const VIDEO_CONCURRENCY = 3;
// Instagram's video CDN URLs are signed and short-lived. At VIDEO_CONCURRENCY=3,
// a batch of 15-20+ videos can take 8+ minutes to work through the Gemini/Claude
// queue — long enough for a URL scraped at the start to expire before its turn
// comes up, causing "fetch failed"/"terminated" errors on later videos in a
// large batch. Downloading is just I/O (no AI quota involved), so it runs as
// its own higher-concurrency phase immediately after scraping, before anything
// sits waiting on the slower AI-processing queue.
const DOWNLOAD_CONCURRENCY = 8;

// Instagram/Facebook CDN thumbnail URLs are signed and expire (the `oe=` param),
// and their edge-node hostnames aren't reliably resolvable outside the network
// that issued them — so the raw URL can't be hotlinked later. Download the bytes
// now, while the URL is still fresh, and store them in Vercel Blob (works both
// locally and on Vercel's read-only serverless filesystem) instead.
// Tries twice (a transient CDN/Blob hiccup shouldn't cost a video its
// thumbnail), then gives up with a reason instead of throwing — a missing
// thumbnail isn't worth failing the whole video over, but the caller logs it.
async function downloadThumbnail(url: string, id: string): Promise<{ url: string; error?: string }> {
  if (!url) return { url: "", error: "scraper returned no thumbnail URL" };
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }

      const ext = url.match(/\.(jpe?g|png|webp)(?:\?|$)/i)?.[1]?.toLowerCase() || "jpg";
      const buffer = Buffer.from(await response.arrayBuffer());
      const blob = await put(`thumbnails/${id}.${ext}`, buffer, {
        access: "public",
        allowOverwrite: true,
        addRandomSuffix: false,
      });
      return { url: blob.url };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { url: "", error: lastError };
}

interface ScrapedVideo {
  videoUrl: string;
  postUrl: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  username: string;
  thumbnail: string;
  datePosted: string;
}

// Normalizes a raw metric from either scraper onto null when it's genuinely
// unavailable — Instagram's actor uses -1 as a sentinel for "creator hid this
// count," and both actors can return null/undefined outright. A real 0 (a
// video with zero comments, say) is a legitimate value and passes through
// unchanged; only -1/null/undefined/NaN become null.
function toCount(raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === -1 || Number.isNaN(raw)) return null;
  return raw;
}

interface DownloadedVideo extends ScrapedVideo {
  videoId: string;
  videoBuffer: Buffer;
  contentType: string;
  thumbnailPath: string;
}

// Apify returns each reel's canonical URL, which can differ cosmetically from
// what the user pasted (tracking params like ?igsh=..., trailing slash,
// http vs https) even though the same post was scraped successfully. Compare
// by the reel/post shortcode instead of raw string equality. Covers both
// Instagram's path-based ids (/reel/, /reels/, /p/, /tv/) and Facebook's
// (/reel/, /videos/, plus /watch/?v=<id>, which is query-param based, not
// path-based, so it needs its own branch).
function reelShortcode(url: string): string {
  try {
    const { pathname, searchParams } = new URL(url);
    if (pathname === "/watch" || pathname === "/watch/") {
      const v = searchParams.get("v");
      if (v) return v;
    }
    const match = pathname.match(/\/(?:reel|reels|p|tv|videos)\/([^/]+)/);
    return match ? match[1] : pathname.replace(/\/+$/, "");
  } catch {
    return url.trim();
  }
}

// Detected per-link from its URL (not hardcoded) so the Platform column
// stays accurate if/when Facebook or TikTok scraping gets wired up later.
function detectPlatform(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (host.includes("instagram.com")) return "Instagram";
    if (host.includes("facebook.com") || host.includes("fb.watch")) return "Facebook";
    if (host.includes("tiktok.com")) return "TikTok";
    return "Other";
  } catch {
    return "Other";
  }
}

// fb.watch short links and /share/v/, /share/r/ links are opaque tokens that
// only resolve to a stable, actor-supported URL (/reel/<id>, /watch/?v=<id>,
// /<page>/videos/<id>) via an HTTP redirect — Facebook doesn't expose any way
// to derive one from the other. /reel/, /videos/, and /watch/ are already
// canonical and pass through untouched.
function needsUrlResolution(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.replace(/^www\./, "").toLowerCase();
    if (host === "fb.watch") return true;
    if (host.includes("facebook.com") && /\/share\/(v|r)\//.test(pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

// Resolves a short/share Facebook link to its canonical form by following
// redirects. Falls back to the original URL on any failure (timeout, network
// error, non-redirecting response) rather than throwing — worst case the
// actor gets the unresolved link and fails with its own clear error, same as
// before this existed.
async function resolveFacebookUrl(url: string): Promise<string> {
  if (!needsUrlResolution(url)) return url;
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(10000),
    });
    return response.url || url;
  } catch {
    return url;
  }
}

// TikTok isn't wired up in apify.ts yet — a link detected as an unsupported
// platform via detectPlatform() gets flagged and skipped rather than sent to
// a scraper that can't handle it.
const SCRAPER_SUPPORTED_PLATFORMS = new Set(["Instagram", "Facebook"]);

function followersMap(creators: Creator[]): Map<string, number> {
  return new Map(creators.map((c) => [c.username, c.followers]));
}

function librarySet(videos: Video[]): Set<string> {
  return new Set(videos.map((v) => reelShortcode(v.link)));
}

// Merges freshly-analyzed videos into the existing library by matching reel
// shortcode: a match keeps the existing row's identity and manually-filled
// queue fields (id/dateAdded/starred/remakeFormat/assignedPage/queueStatus/
// deadline), refreshing everything else from the new analysis. This is a
// defense-in-depth safety net — the pre-scrape dedup in both pipelines means
// a genuine duplicate should rarely reach here at all.
function upsertVideos(existing: Video[], newVideos: Video[]): Video[] {
  const result = [...existing];
  const indexByShortcode = new Map(result.map((v, i) => [reelShortcode(v.link), i]));

  for (const newVideo of newVideos) {
    const shortcode = reelShortcode(newVideo.link);
    const existingIndex = indexByShortcode.get(shortcode);
    if (existingIndex !== undefined) {
      const prior = result[existingIndex];
      result[existingIndex] = {
        ...newVideo,
        id: prior.id,
        dateAdded: prior.dateAdded,
        starred: prior.starred,
        remakeFormat: prior.remakeFormat,
        assignedPage: prior.assignedPage,
        queueStatus: prior.queueStatus,
        deadline: prior.deadline,
      };
    } else {
      indexByShortcode.set(shortcode, result.length);
      result.push(newVideo);
    }
  }

  return result;
}

// isAborted is checked before picking up each new item — an item already
// in flight when it flips true is left to finish naturally (it already
// consumed an API call; killing it mid-request would just waste that call
// and lose the result). This is what makes a "stop" request cheap: it
// bounds the wait to whatever's already running, not the whole remaining
// queue, and it works purely by not starting new work rather than by
// forcefully aborting in-flight fetches.
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
  isAborted?: () => boolean
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      if (isAborted?.()) break;
      const i = index++;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

interface ProcessVideoHooks {
  onTaskAdd: (task: ActiveTask) => void;
  onTaskUpdate: (id: string, step: string) => void;
  onTaskRemove: (id: string) => void;
  onLog: (msg: string) => void;
}

// Downloads every scraped video's bytes + thumbnail up front, at higher
// concurrency than the AI-processing phase, so each video's signed CDN URL
// gets consumed while it's still fresh — see DOWNLOAD_CONCURRENCY comment.
// Per-video failures (including an already-expired URL) are collected as
// error strings rather than thrown, so the caller can fold them into
// progress.errors the same way the AI-processing phase already does.
async function downloadPhase(
  videos: ScrapedVideo[],
  hooks: Pick<ProcessVideoHooks, "onTaskAdd" | "onTaskRemove">,
  isAborted?: () => boolean
): Promise<{ downloaded: DownloadedVideo[]; errors: string[]; warnings: string[] }> {
  const { onTaskAdd, onTaskRemove } = hooks;
  const downloaded: DownloadedVideo[] = [];
  const errors: string[] = [];
  // Non-fatal: the video still gets analyzed, it just has no thumbnail.
  const warnings: string[] = [];

  await runWithConcurrency(videos, DOWNLOAD_CONCURRENCY, async (video) => {
    const taskId = `download-${uuid().slice(0, 8)}`;
    const label = `${(video.views ?? 0).toLocaleString()} views`;

    try {
      onTaskAdd({ id: taskId, creator: video.username, step: "Downloading", views: video.views ?? undefined });

      const videoId = uuid();
      const thumb = await downloadThumbnail(video.thumbnail, videoId);
      if (thumb.error) warnings.push(`@${video.username} (${label}): thumbnail not saved — ${thumb.error}`);
      const thumbnailPath = thumb.url;

      const videoResponse = await fetch(video.videoUrl);
      if (!videoResponse.ok) throw new Error(`Download failed: ${videoResponse.status}`);
      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
      const contentType = videoResponse.headers.get("content-type") || "video/mp4";

      downloaded.push({ ...video, videoId, videoBuffer, contentType, thumbnailPath });
      onTaskRemove(taskId);
    } catch (err) {
      onTaskRemove(taskId);
      errors.push(`@${video.username} (${label}): download failed — ${err instanceof Error ? err.message : err}`);
    }
  }, isAborted);

  return { downloaded, errors, warnings };
}

// Shared per-video worker: upload (already-downloaded bytes) to Gemini →
// analyze → extract transcript → save. Used by both
// the creator-based pipeline (runPipeline) and the direct-link pipeline
// (runPipelineFromLinks) so every video gets the same fields regardless of
// how it entered the system. Actual video/thumbnail download happens earlier,
// in downloadPhase() — see its comment for why that's a separate phase.
async function processVideo(
  video: DownloadedVideo,
  config: Config,
  configName: string,
  followers: number,
  hooks: ProcessVideoHooks
): Promise<Video> {
  const taskId = `video-${uuid().slice(0, 8)}`;
  const label = `${(video.views ?? 0).toLocaleString()} views`;
  const { onTaskAdd, onTaskUpdate, onTaskRemove, onLog } = hooks;

  try {
    onTaskAdd({ id: taskId, creator: video.username, step: "Uploading to Gemini", views: video.views ?? undefined });
    onLog(`@${video.username} (${label}): uploading to Gemini`);

    const fileData = await uploadVideo(video.videoBuffer, video.contentType);

    onTaskUpdate(taskId, "Gemini analyzing");
    onLog(`@${video.username} (${label}): Gemini analyzing`);

    const analysis = await analyzeVideo(
      fileData.uri,
      fileData.mimeType,
      config.analysisInstruction
    );

    onTaskUpdate(taskId, "Extracting script");
    const { transcript, scriptHook, scriptBody, scriptCta } = await extractScript(fileData.uri, fileData.mimeType);

    // Flattened text of the structured analysis fields, kept for the
    // legacy single-blob "analysis" column / old-row modal fallback.
    const analysisText = [
      `Niche: ${analysis.niche}`,
      `Format: ${analysis.format}`,
      `Angle: ${analysis.angle}`,
      `Hook Pattern: ${analysis.hookPattern}`,
      `Hook: ${analysis.hookText}`,
      `Structure: ${analysis.structure}`,
      `Framework: ${analysis.framework}`,
      `Script Beats:\n${analysis.scriptBeats}`,
      `CTA: ${analysis.cta}`,
    ].join("\n\n");

    const videoRecord: Video = {
      id: video.videoId,
      link: video.postUrl,
      thumbnail: video.thumbnailPath,
      creator: video.username,
      platform: detectPlatform(video.postUrl),
      followers,
      views: video.views,
      likes: video.likes,
      comments: video.comments,
      shares: video.shares,
      saves: 0,
      // Derived at read time from views/followers/dates — see csv.ts.
      viewsPerFollower: null,
      velocity: null,
      analysis: analysisText,
      transcript,
      scriptHook,
      scriptBody,
      scriptCta,
      hook: "",
      hookText: analysis.hookText,
      hookPattern: analysis.hookPattern,
      scriptBeats: analysis.scriptBeats,
      angle: analysis.angle,
      format: analysis.format,
      structure: analysis.structure,
      framework: analysis.framework,
      niche: analysis.niche,
      cta: analysis.cta,
      datePosted: video.datePosted,
      dateAdded: new Date().toISOString().slice(0, 10),
      configName,
      starred: false,
      remakeFormat: "",
      assignedPage: "",
      queueStatus: "To Do",
      deadline: "",
    };

    onTaskRemove(taskId);
    onLog(`@${video.username} (${label}): done`);
    return videoRecord;
  } catch (err) {
    onTaskRemove(taskId);
    throw new Error(`@${video.username} (${label}): ${err instanceof Error ? err.message : err}`);
  }
}

function makeProgressEmitter(onProgress: (progress: PipelineProgress) => void, progress: PipelineProgress) {
  return () => {
    onProgress({ ...progress, activeTasks: [...progress.activeTasks], log: [...progress.log], errors: [...progress.errors] });
  };
}

export async function runPipeline(
  params: PipelineParams,
  onProgress: (progress: PipelineProgress) => void,
  isAborted?: () => boolean
): Promise<void> {
  const progress: PipelineProgress = {
    status: "running",
    phase: "scraping",
    activeTasks: [],
    creatorsCompleted: 0,
    creatorsTotal: 0,
    creatorsScraped: 0,
    videosAnalyzed: 0,
    videosTotal: 0,
    errors: [],
    log: [],
  };

  const emit = makeProgressEmitter(onProgress, progress);

  const log = (msg: string) => {
    progress.log.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    emit();
  };

  const addTask = (task: ActiveTask) => {
    progress.activeTasks.push(task);
    emit();
  };

  const updateTask = (id: string, step: string) => {
    const t = progress.activeTasks.find((t) => t.id === id);
    if (t) { t.step = step; emit(); }
  };

  const removeTask = (id: string) => {
    progress.activeTasks = progress.activeTasks.filter((t) => t.id !== id);
    emit();
  };

  // Writes whatever videos were finished (full success or a mid-run stop —
  // either way, nothing already analyzed is thrown away) and settles the
  // run into a terminal, non-"running" status so the UI never sits stuck.
  const finish = async (newVideos: Video[], stopped: boolean) => {
    if (newVideos.length > 0) {
      const existing = await readVideos();
      await writeVideos(upsertVideos(existing, newVideos));
    }
    progress.phase = "done";
    progress.status = stopped ? "stopped" : "completed";
    log(
      stopped
        ? `Pipeline stopped. ${progress.videosAnalyzed}/${progress.videosTotal} videos were already analyzed and saved.`
        : `Pipeline complete! ${progress.videosAnalyzed}/${progress.videosTotal} videos analyzed, ${progress.errors.length} errors.`
    );
    emit();
  };

  try {
    // Load config
    const configs = await readConfigs();
    const config = configs.find((c) => c.configName === params.configName);
    if (!config) throw new Error(`Config "${params.configName}" not found`);

    log(`Loaded config: ${config.configName}`);

    // Existing library, checked against each scraped video below so already-
    // analyzed reels are skipped before they reach download/Gemini/Claude.
    const library = librarySet(await readVideos());

    // Load creators
    const allCreators = await readCreators();
    const creators = allCreators.filter((c) => c.category === config.creatorsCategory);
    if (creators.length === 0) throw new Error(`No creators found for category "${config.creatorsCategory}"`);

    progress.creatorsTotal = creators.length;
    log(`Found ${creators.length} creators — scraping all in parallel`);
    emit();

    // Phase 1: Scrape all creators in parallel
    progress.phase = "scraping";
    const cutoffDate = new Date(Date.now() - params.nDays * 24 * 60 * 60 * 1000);
    const allTopVideos: ScrapedVideo[] = [];

    const scrapeResults = await Promise.allSettled(
      creators.map(async (creator) => {
        const taskId = `scrape-${creator.username}`;
        addTask({ id: taskId, creator: creator.username, step: "Scraping reels" });

        const reels = await scrapeReels(creator.username, params.maxVideos, params.nDays);
        updateTask(taskId, `Found ${reels.length} reels`);

        const videos = reels
          .filter((r) => r.videoUrl && r.timestamp)
          .map((r) => ({
            videoUrl: r.videoUrl,
            postUrl: r.url,
            views: toCount(r.videoPlayCount),
            likes: toCount(r.likesCount),
            comments: toCount(r.commentsCount),
            // Instagram doesn't expose a share count at all — genuinely
            // unavailable, not zero.
            shares: null,
            username: r.ownerUsername || creator.username,
            thumbnail: r.displayUrl || r.images?.[0] || "",
            datePosted: r.timestamp?.split("T")[0] || "",
            timestamp: new Date(r.timestamp),
          }))
          .filter((v) => v.timestamp >= cutoffDate);

        // Unknown views sort last, not first — treating them as 0 would rank
        // an unscored video above every genuinely low-view one.
        videos.sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
        const topVideos = videos.slice(0, params.topK);

        updateTask(taskId, `Top ${topVideos.length} selected`);
        log(`@${creator.username}: ${reels.length} reels → top ${topVideos.length} selected`);

        removeTask(taskId);
        progress.creatorsScraped++;
        emit();

        return { creator: creator.username, videos: topVideos };
      })
    );

    for (const result of scrapeResults) {
      if (result.status === "fulfilled") {
        for (const v of result.value.videos) {
          allTopVideos.push(v);
        }
        progress.creatorsCompleted++;
      } else {
        const msg = `Scraping error: ${result.reason instanceof Error ? result.reason.message : result.reason}`;
        progress.errors.push(msg);
        log(msg);
        progress.creatorsCompleted++;
      }
    }

    // Drop anything already in the library before it reaches download/Gemini/
    // Claude — saves API cost on creators whose top-K reels overlap a prior run.
    const skippedExisting = allTopVideos.filter((v) => library.has(reelShortcode(v.postUrl)));
    const newTopVideos = allTopVideos.filter((v) => !library.has(reelShortcode(v.postUrl)));
    for (const v of skippedExisting) {
      log(`Skipping (already in library): ${v.postUrl}`);
    }
    log(`${newTopVideos.length} new, ${skippedExisting.length} skipped (already added)`);

    progress.videosTotal = newTopVideos.length;
    const newVideos: Video[] = [];

    if (isAborted?.()) {
      log("Stop requested — no videos had started yet.");
      await finish(newVideos, true);
      return;
    }

    log(`Scraping done. Downloading ${newTopVideos.length} videos (${DOWNLOAD_CONCURRENCY} workers)`);
    emit();

    // Phase 2: download all video bytes/thumbnails up front, at higher
    // concurrency, before anything sits waiting on the slower AI queue below
    // (see DOWNLOAD_CONCURRENCY comment).
    const { downloaded, errors: downloadErrors, warnings: downloadWarnings } = await downloadPhase(
      newTopVideos,
      { onTaskAdd: addTask, onTaskRemove: removeTask },
      isAborted
    );
    for (const msg of downloadErrors) {
      progress.errors.push(msg);
      log(`Error — ${msg}`);
    }
    for (const msg of downloadWarnings) log(`Warning — ${msg}`);
    log(`Download done. ${downloaded.length}/${newTopVideos.length} ready to analyze (${VIDEO_CONCURRENCY} workers)`);
    emit();

    if (isAborted?.()) {
      log("Stop requested — skipping analysis of downloaded-but-not-yet-started videos.");
      await finish(newVideos, true);
      return;
    }

    // Phase 3: Process videos concurrently
    progress.phase = "analyzing";
    emit();

    const followers = followersMap(allCreators);

    await runWithConcurrency(downloaded, VIDEO_CONCURRENCY, async (video) => {
      try {
        const videoRecord = await processVideo(video, config, params.configName, followers.get(video.username) || 0, {
          onTaskAdd: addTask,
          onTaskUpdate: updateTask,
          onTaskRemove: removeTask,
          onLog: log,
        });
        newVideos.push(videoRecord);
        progress.videosAnalyzed++;
        emit();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        progress.errors.push(msg);
        log(`Error — ${msg}`);
        emit();
      }
    }, isAborted);

    await finish(newVideos, isAborted?.() ?? false);
  } catch (err) {
    progress.status = "error";
    const msg = `Pipeline error: ${err instanceof Error ? err.message : err}`;
    progress.errors.push(msg);
    log(msg);
    emit();
  }
}

// Analyzes an explicit batch of pasted Instagram reel/post links instead of
// walking a creator category — same per-video analysis pipeline as runPipeline,
// via the shared processVideo() worker.
export async function runPipelineFromLinks(
  params: LinkPipelineParams,
  onProgress: (progress: PipelineProgress) => void,
  isAborted?: () => boolean
): Promise<void> {
  const progress: PipelineProgress = {
    status: "running",
    phase: "scraping",
    activeTasks: [],
    creatorsCompleted: 0,
    creatorsTotal: 0,
    creatorsScraped: 0,
    videosAnalyzed: 0,
    videosTotal: 0,
    errors: [],
    log: [],
  };

  const emit = makeProgressEmitter(onProgress, progress);

  const log = (msg: string) => {
    progress.log.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    emit();
  };

  const addTask = (task: ActiveTask) => {
    progress.activeTasks.push(task);
    emit();
  };

  const updateTask = (id: string, step: string) => {
    const t = progress.activeTasks.find((t) => t.id === id);
    if (t) { t.step = step; emit(); }
  };

  const removeTask = (id: string) => {
    progress.activeTasks = progress.activeTasks.filter((t) => t.id !== id);
    emit();
  };

  const finish = async (newVideos: Video[], stopped: boolean) => {
    if (newVideos.length > 0) {
      const existing = await readVideos();
      await writeVideos(upsertVideos(existing, newVideos));
    }
    progress.phase = "done";
    progress.status = stopped ? "stopped" : "completed";
    log(
      stopped
        ? `Pipeline stopped. ${progress.videosAnalyzed}/${progress.videosTotal} videos were already analyzed and saved.`
        : `Pipeline complete! ${progress.videosAnalyzed}/${progress.videosTotal} videos analyzed, ${progress.errors.length} errors.`
    );
    emit();
  };

  try {
    const allLinks = [...new Set(params.links.map((l) => l.trim()).filter(Boolean))];
    if (allLinks.length === 0) throw new Error("No links provided");

    const configs = await readConfigs();
    const config = configs.find((c) => c.configName === params.configName);
    if (!config) throw new Error(`Config "${params.configName}" not found`);

    log(`Loaded config: ${config.configName}`);

    // The scraper only supports Instagram today — flag and skip anything
    // else up front rather than sending it to the Instagram-only Apify
    // actor, where it would just fail with a less clear error.
    const supportedLinks = allLinks.filter((l) => SCRAPER_SUPPORTED_PLATFORMS.has(detectPlatform(l)));
    for (const link of allLinks) {
      const platform = detectPlatform(link);
      if (!SCRAPER_SUPPORTED_PLATFORMS.has(platform)) {
        const msg = `Skipping ${link}: detected platform "${platform}" isn't supported by the scraper yet (Instagram only)`;
        progress.errors.push(msg);
        log(msg);
      }
    }
    if (supportedLinks.length === 0) throw new Error("No supported (Instagram/Facebook) links found — TikTok scraping isn't wired up yet");

    // Resolve fb.watch / /share/v/ / /share/r/ links to their canonical form
    // before dedup and scraping — the actor only accepts canonical Facebook
    // URLs, and resolving up front also means dedup correctly recognizes a
    // share link for a reel already in the library under its canonical URL.
    const resolvedLinks = await Promise.all(
      supportedLinks.map(async (link) => {
        const resolved = await resolveFacebookUrl(link);
        if (resolved !== link) log(`Resolved Facebook share link: ${link} → ${resolved}`);
        return resolved;
      })
    );

    // Drop anything already in the library before spending an Apify/Gemini
    // call on it — the same reel pasted twice (or across two batches) should
    // never re-scrape/re-analyze.
    const library = params.reanalyze ? new Set<string>() : librarySet(await readVideos());
    if (params.reanalyze) log("Re-analyze mode: links already in the library will be refreshed in place");
    const links = resolvedLinks.filter((l) => !library.has(reelShortcode(l)));
    const skippedLinks = resolvedLinks.filter((l) => library.has(reelShortcode(l)));
    for (const link of skippedLinks) {
      log(`Skipping (already in library): ${link}`);
    }
    log(`${links.length} new, ${skippedLinks.length} skipped (already added)`);

    if (links.length === 0) {
      log("All pasted links are already in the library — nothing to analyze.");
      await finish([], false);
      return;
    }

    const instagramLinks = links.filter((l) => detectPlatform(l) === "Instagram");
    const facebookLinks = links.filter((l) => detectPlatform(l) === "Facebook");

    log(`Scraping ${instagramLinks.length} Instagram + ${facebookLinks.length} Facebook link(s) directly from Apify`);
    emit();

    // Phase 1: scrape all pasted links — one batch call per platform, since
    // Instagram and Facebook go through different Apify actors.
    progress.phase = "scraping";
    const scrapedVideos: ScrapedVideo[] = [];

    const [igReels, fbResult] = await Promise.all([
      instagramLinks.length > 0 ? scrapeReelsByUrls(instagramLinks) : Promise.resolve([]),
      facebookLinks.length > 0 ? scrapeFacebookReelsByUrls(facebookLinks) : Promise.resolve({ reels: [], failures: [] }),
    ]);
    const reels = [...igReels, ...fbResult.reels];

    // Facebook failures come with a real reason (removed/private/blocked/no
    // MP4/etc, read from the actor's ERRORS record) — report those
    // specifically, then skip them in the generic shortcode check below so
    // the same miss isn't reported twice with a less useful message.
    const reportedFacebookFailures = new Set<string>();
    for (const f of fbResult.failures) {
      const msg = `Could not scrape Facebook link: ${f.url} — ${f.reason}`;
      progress.errors.push(msg);
      log(msg);
      reportedFacebookFailures.add(reelShortcode(f.url));
    }

    const foundShortcodes = new Set(reels.map((r) => reelShortcode(r.url)));
    for (const link of links) {
      const shortcode = reelShortcode(link);
      if (!foundShortcodes.has(shortcode) && !reportedFacebookFailures.has(shortcode)) {
        const msg = `Could not scrape link: ${link}`;
        progress.errors.push(msg);
        log(msg);
      }
    }

    for (const r of reels) {
      if (!r.videoUrl) {
        const reason = r.restricted_age
          ? `age-restricted (${r.restricted_age}+) — scraper runs logged out and can't access it`
          : r.error
            ? `${r.error}${r.errorDescription ? ` — ${r.errorDescription}` : ""}`
            : "no video found";
        const msg = `Skipping (${reason}): ${r.url}`;
        progress.errors.push(msg);
        log(msg);
        continue;
      }
      scrapedVideos.push({
        videoUrl: r.videoUrl,
        postUrl: r.url,
        views: toCount(r.videoPlayCount),
        likes: toCount(r.likesCount),
        comments: toCount(r.commentsCount),
        // Only Facebook's actor reports a share count — Instagram reels
        // leave sharesCount undefined, which toCount() turns into null
        // (genuinely unavailable, not zero).
        shares: toCount(r.sharesCount),
        username: r.ownerUsername || "",
        thumbnail: r.displayUrl || r.images?.[0] || "",
        datePosted: r.timestamp?.split("T")[0] || "",
      });
    }

    progress.creatorsTotal = links.length;
    progress.creatorsScraped = links.length;
    progress.creatorsCompleted = links.length;
    progress.videosTotal = scrapedVideos.length;
    const newVideos: Video[] = [];

    if (isAborted?.()) {
      log("Stop requested — no videos had started yet.");
      await finish(newVideos, true);
      return;
    }

    log(`Scraping done. Downloading ${scrapedVideos.length}/${links.length} videos (${DOWNLOAD_CONCURRENCY} workers)`);
    emit();

    // Phase 2: download all video bytes/thumbnails up front, at higher
    // concurrency, before anything sits waiting on the slower AI queue below
    // (see DOWNLOAD_CONCURRENCY comment — this is exactly the fix for larger
    // link batches failing partway through with expired-URL download errors).
    const { downloaded, errors: downloadErrors, warnings: downloadWarnings } = await downloadPhase(
      scrapedVideos,
      { onTaskAdd: addTask, onTaskRemove: removeTask },
      isAborted
    );
    for (const msg of downloadErrors) {
      progress.errors.push(msg);
      log(`Error — ${msg}`);
    }
    for (const msg of downloadWarnings) log(`Warning — ${msg}`);
    log(`Download done. ${downloaded.length}/${scrapedVideos.length} ready to analyze (${VIDEO_CONCURRENCY} workers)`);
    emit();

    if (isAborted?.()) {
      log("Stop requested — skipping analysis of downloaded-but-not-yet-started videos.");
      await finish(newVideos, true);
      return;
    }

    // Phase 3: process videos concurrently
    progress.phase = "analyzing";
    emit();

    const followers = followersMap(await readCreators());

    await runWithConcurrency(downloaded, VIDEO_CONCURRENCY, async (video) => {
      try {
        const videoRecord = await processVideo(video, config, params.configName, followers.get(video.username) || 0, {
          onTaskAdd: addTask,
          onTaskUpdate: updateTask,
          onTaskRemove: removeTask,
          onLog: log,
        });
        newVideos.push(videoRecord);
        progress.videosAnalyzed++;
        emit();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        progress.errors.push(msg);
        log(`Error — ${msg}`);
        emit();
      }
    }, isAborted);

    await finish(newVideos, isAborted?.() ?? false);
  } catch (err) {
    progress.status = "error";
    const msg = `Pipeline error: ${err instanceof Error ? err.message : err}`;
    progress.errors.push(msg);
    log(msg);
    emit();
  }
}
