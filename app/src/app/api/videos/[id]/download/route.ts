import { NextResponse } from "next/server";
import { readVideos, writeVideos } from "@/lib/csv";
import { scrapeReelsByUrls, scrapeFacebookReelsByUrls } from "@/lib/apify";
import { detectPlatform } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
// A fresh-URL re-scrape (below) can take 10-30s on Apify.
export const maxDuration = 120;

// Instagram/Facebook CDN video URLs are signed and expire, so the stored
// videoUrl only works for a few days after the pipeline run. Streamed through
// this route (not linked directly) because browsers ignore <a download>'s
// filename on cross-origin URLs, and the CDNs reject hotlinked requests.
async function fetchVideo(url: string): Promise<Response | null> {
  if (!url) return null;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
    });
    // An expired signature comes back as 403/410, but some CDN edges answer
    // with a 200 HTML error page instead — never hand that to the user as an .mp4.
    const type = response.headers.get("content-type") || "";
    if (!response.ok || !response.body || type.startsWith("text/")) {
      await response.body?.cancel();
      return null;
    }
    return response;
  } catch {
    return null;
  }
}

// Re-scrapes the post for a fresh signed MP4 URL. Returns null with a reason
// when the post can't be scraped anymore (deleted, private, 18+ — the
// scraper runs logged out).
async function freshVideoUrl(link: string): Promise<{ url: string } | { error: string }> {
  const platform = detectPlatform(link);
  try {
    if (platform === "Instagram") {
      const [item] = await scrapeReelsByUrls([link]);
      if (item?.videoUrl) return { url: item.videoUrl };
      if (item?.restricted_age) return { error: "This reel is age-restricted (18+), so the scraper can't access it." };
    } else if (platform === "Facebook") {
      const { reels, failures } = await scrapeFacebookReelsByUrls([link]);
      if (reels[0]?.videoUrl) return { url: reels[0].videoUrl };
      if (failures[0]) return { error: `Facebook scraper couldn't access it (${failures[0].reason}).` };
    } else {
      return { error: `Downloading ${platform} videos isn't supported yet.` };
    }
    return { error: "Couldn't get a fresh video link — the post may have been deleted or made private." };
  } catch (err) {
    return { error: `Couldn't get a fresh video link: ${err instanceof Error ? err.message : err}` };
  }
}

function compactCount(n: number | null): string {
  if (n === null) return "unknown";
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function downloadFilename(creator: string, views: number | null): string {
  const name = creator.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "video";
  return `${name}-${compactCount(views)}.mp4`;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const videos = await readVideos();
  const video = videos.find((v) => v.id === id);
  if (!video) return NextResponse.json({ error: "Video not found" }, { status: 404 });

  let upstream = await fetchVideo(video.videoUrl);

  if (!upstream) {
    const fresh = await freshVideoUrl(video.link);
    if ("error" in fresh) return NextResponse.json({ error: fresh.error }, { status: 502 });

    upstream = await fetchVideo(fresh.url);
    if (!upstream) {
      return NextResponse.json({ error: "Got a fresh video link, but the download from Instagram/Facebook failed. Try again." }, { status: 502 });
    }

    // Cache the fresh URL so repeat downloads in the next few days skip the
    // re-scrape. Re-read right before writing to keep the read-modify-write
    // window as short as possible (the scrape above took seconds).
    // Best-effort: a failed write shouldn't fail the download.
    try {
      const latest = await readVideos();
      const row = latest.find((v) => v.id === id);
      if (row) {
        row.videoUrl = fresh.url;
        await writeVideos(latest);
      }
    } catch {
      // ignore
    }
  }

  const filename = downloadFilename(video.creator, video.views);
  const headers = new Headers({
    "Content-Type": "video/mp4",
    "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "Cache-Control": "no-store",
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);

  return new Response(upstream.body, { headers });
}
