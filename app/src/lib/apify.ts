export interface ApifyReel {
  videoUrl: string;
  url: string;
  // These come straight off the raw Instagram/Facebook actor JSON with no
  // transform (Instagram's actor in particular uses -1 as a sentinel for "the
  // creator hid this count" — that gets normalized to null downstream in
  // pipeline.ts's toCount(), not here, since scrapeReels()/scrapeReelsByUrls()
  // return the raw dataset untouched).
  videoPlayCount: number | null;
  likesCount: number | null;
  commentsCount: number | null;
  // Only populated by scrapeFacebookReelsByUrls — Instagram's actor doesn't
  // expose a share count at all, so this stays undefined for IG reels.
  sharesCount?: number | null;
  // Only present on Instagram error items — the actor returns one of these
  // (with no videoUrl) instead of a reel when it can't access the post, e.g.
  // { error: "restricted_page", restricted_age: 18 } for an 18+ reel, since
  // the scraper runs logged out.
  error?: string;
  errorDescription?: string;
  restricted_age?: number;
  ownerUsername: string;
  images: string[];
  // Only populated in direct-URL ("reels") scrape mode — profile-feed
  // ("stories") mode populates `images` instead. See pipeline.ts thumbnail
  // mapping, which checks both.
  displayUrl?: string;
  timestamp: string;
}

// Raw shape of a single item from apivault_labs/facebook-reels-video-scraper
// (outputPreset: "full") — verified via a live test call against a real
// direct reel URL, the same way pipeline.ts uses it. Unlike the official
// apify/facebook-posts-scraper (whose direct-URL mode returns an unrelated,
// incomplete shape with no usable video URL), this actor is purpose-built for
// single reel/video URLs and returns a clean, typed dataset row.
interface FacebookVideoResult {
  success: boolean;
  videoStatus: string;
  videoUrl: string;
  publishedAt: string;
  viewCount: number | null;
  reactionCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  creatorName: string;
  thumbnailUrl: string;
  videoMp4Url?: string;
  videoMp4HdUrl?: string;
  videoMp4SdUrl?: string;
}

// Shape of an entry in the actor's ERRORS key-value record — the actual
// reason a candidate failed (removed/private/blocked/no MP4/etc). Confirmed
// via a live test against a deliberately invalid reel id: the dataset-items
// response alone comes back as an empty array with zero explanation; this
// diagnostic only exists in the separate ERRORS record.
interface FacebookScrapeError {
  inputUrl: string;
  canonicalUrl?: string;
  videoStatus?: string;
  error?: string;
}

export interface FacebookScrapeFailure {
  url: string;
  reason: string;
}

interface ApifyProfileResult {
  profilePicUrl: string;
  followersCount: number;
}

export interface CreatorStats {
  profilePicUrl: string;
  followers: number;
  reelsCount30d: number;
  avgViews30d: number;
}

function getToken(): string {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN not set");
  return token;
}

export async function scrapeReels(
  username: string,
  maxVideos: number,
  nDays: number
): Promise<ApifyReel[]> {
  const token = getToken();

  const sinceDate = new Date(Date.now() - nDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const response = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        addParentData: false,
        directUrls: [`https://www.instagram.com/${username}/`],
        enhanceUserSearchWithFacebookPage: false,
        isUserReelFeedURL: false,
        isUserTaggedFeedURL: false,
        onlyPostsNewerThan: sinceDate,
        resultsLimit: maxVideos,
        resultsType: "stories",
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Apify error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data as ApifyReel[];
}

// Scrapes a batch of direct Instagram reel/post URLs (e.g. pasted by a user),
// as opposed to scrapeReels() which walks a creator's whole profile feed.
// One dataset item per URL, in the same shape as a profile-feed reel.
export async function scrapeReelsByUrls(urls: string[]): Promise<ApifyReel[]> {
  const token = getToken();

  const response = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        addParentData: false,
        directUrls: urls,
        resultsType: "reels",
        resultsLimit: urls.length,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Apify error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data as ApifyReel[];
}

// Scrapes a batch of direct Facebook reel/video URLs via
// apivault_labs/facebook-reels-video-scraper — the only Facebook actor found
// (after checking 4 others, including the official apify/facebook-posts-scraper
// and apify/facebook-reels-scraper) that both accepts individual pasted reel
// URLs and returns a real downloadable video URL for them. Output is
// normalized to the same ApifyReel shape scrapeReelsByUrls() returns, so
// pipeline.ts doesn't need to branch on platform beyond picking which scraper
// to call.
//
// Started as an async run (not run-sync-get-dataset-items) rather than a
// single synchronous call, specifically so the ERRORS key-value record can
// also be read: a removed/private/blocked reel comes back as an EMPTY
// dataset with zero explanation, and the actual reason only exists in that
// separate record — confirmed live against a deliberately invalid reel id.
// Without this, a failed scrape is indistinguishable from "link not found"
// with no way to tell the two apart from the pipeline log.
export async function scrapeFacebookReelsByUrls(
  urls: string[]
): Promise<{ reels: ApifyReel[]; failures: FacebookScrapeFailure[] }> {
  const token = getToken();

  const startResponse = await fetch(
    `https://api.apify.com/v2/acts/apivault_labs~facebook-reels-video-scraper/runs?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: "videoUrls",
        startUrls: urls,
        outputPreset: "full",
      }),
    }
  );

  if (!startResponse.ok) {
    const text = await startResponse.text();
    throw new Error(`Apify error ${startResponse.status}: ${text}`);
  }

  const startData = await startResponse.json();
  const runId: string = startData.data.id;
  let status: string = startData.data.status;
  let datasetId: string = startData.data.defaultDatasetId;
  let kvStoreId: string = startData.data.defaultKeyValueStoreId;

  // Facebook scrapes of a handful of URLs typically finish in 10-20s; cap
  // polling well under the pipeline route's 300s budget so a stuck run
  // doesn't stall the rest of the batch (Instagram links, download, Gemini).
  const deadline = Date.now() + 120_000;
  while ((status === "READY" || status === "RUNNING") && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const pollResponse = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`);
    if (!pollResponse.ok) break;
    const pollData = await pollResponse.json();
    status = pollData.data.status;
    datasetId = pollData.data.defaultDatasetId;
    kvStoreId = pollData.data.defaultKeyValueStoreId;
  }

  const [datasetResponse, errorsResponse] = await Promise.all([
    fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}`),
    fetch(`https://api.apify.com/v2/key-value-stores/${kvStoreId}/records/ERRORS?token=${token}`),
  ]);

  const results: FacebookVideoResult[] = datasetResponse.ok ? await datasetResponse.json() : [];
  // No ERRORS record at all just means every candidate succeeded — not an error.
  const errors: FacebookScrapeError[] = errorsResponse.ok ? await errorsResponse.json() : [];

  const reels = results
    .filter((r) => r.success && r.videoStatus === "available")
    .map((r) => ({
      videoUrl: r.videoMp4HdUrl || r.videoMp4Url || r.videoMp4SdUrl || "",
      url: r.videoUrl,
      // Passed through as-is (null stays null) — Facebook already reports
      // an unavailable count as null rather than a sentinel like -1, so no
      // extra normalization is needed at this layer. The shared -1 → null
      // handling (for Instagram's convention) lives in pipeline.ts's
      // toCount(), applied uniformly to both platforms' reels.
      videoPlayCount: r.viewCount ?? null,
      likesCount: r.reactionCount ?? null,
      commentsCount: r.commentCount ?? null,
      sharesCount: r.shareCount ?? null,
      ownerUsername: r.creatorName || "",
      images: [],
      displayUrl: r.thumbnailUrl || "",
      timestamp: r.publishedAt || "",
    }));

  const failures = errors.map((e) => ({
    url: e.inputUrl,
    reason: e.error || e.videoStatus || "unknown error",
  }));

  return { reels, failures };
}

export async function scrapeCreatorStats(username: string): Promise<CreatorStats> {
  const token = getToken();

  // 1. Get profile info (details mode)
  const profileRes = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        directUrls: [`https://www.instagram.com/${username}/`],
        resultsType: "details",
        resultsLimit: 1,
      }),
    }
  );

  if (!profileRes.ok) {
    const text = await profileRes.text();
    throw new Error(`Apify profile error ${profileRes.status}: ${text}`);
  }

  const profileData = await profileRes.json() as ApifyProfileResult[];
  const profile = profileData[0] || {};
  const profilePicUrl = profile.profilePicUrl || "";
  const followers = profile.followersCount || 0;

  // 2. Get recent posts (last 30 days) to compute activity metrics
  const sinceDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const postsRes = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        directUrls: [`https://www.instagram.com/${username}/`],
        resultsType: "stories",
        resultsLimit: 100,
        onlyPostsNewerThan: sinceDate,
        addParentData: false,
      }),
    }
  );

  if (!postsRes.ok) {
    const text = await postsRes.text();
    throw new Error(`Apify posts error ${postsRes.status}: ${text}`);
  }

  const posts = await postsRes.json() as ApifyReel[];

  // Filter to only video posts within 30 days
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentReels = posts.filter(
    (p) => p.videoUrl && p.timestamp && new Date(p.timestamp) >= cutoff
  );

  const reelsCount30d = recentReels.length;
  const avgViews30d = reelsCount30d > 0
    ? Math.round(recentReels.reduce((sum, r) => sum + (r.videoPlayCount || 0), 0) / reelsCount30d)
    : 0;

  return { profilePicUrl, followers, reelsCount30d, avgViews30d };
}
