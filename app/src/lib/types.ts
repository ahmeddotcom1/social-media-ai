export interface Config {
  id: string;
  configName: string;
  creatorsCategory: string;
  analysisInstruction: string;
}

export interface Creator {
  id: string;
  username: string;
  category: string;
  profilePicUrl: string;
  followers: number;
  reelsCount30d: number;
  avgViews30d: number;
  lastScrapedAt: string;
}

export interface Video {
  id: string;
  link: string;
  // Direct MP4 URL from the scraper. Signed and short-lived (Instagram/Facebook
  // CDN URLs expire within days) — the download route re-scrapes `link` for a
  // fresh one when this has expired. Empty on rows added before it was stored.
  videoUrl: string;
  thumbnail: string;
  creator: string;
  platform: string;
  followers: number;
  // null = genuinely unavailable from the source (hidden by the creator, not
  // exposed by the platform, or an actor-specific sentinel like Instagram's
  // -1 for hidden like counts) — distinct from a real 0, which does happen.
  // Never coerce one into the other; render null as a blank cell/dash.
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number;
  viewsPerFollower: number | null;
  velocity: number | null;
  analysis: string;
  transcript: string;
  scriptHook: string;
  scriptBody: string;
  scriptCta: string;
  hook: string;
  hookText: string;
  hookPattern: string;
  scriptBeats: string;
  angle: string;
  format: string;
  structure: string;
  framework: string;
  niche: string;
  cta: string;
  datePosted: string;
  dateAdded: string;
  configName: string;
  starred: boolean;
  // Manual queue/action fields — filled in by hand, never AI-generated.
  // Named queueStatus (not "status") to avoid clashing with PipelineProgress.status
  // (unrelated run-state concept) elsewhere in the codebase.
  remakeFormat: string;
  assignedPage: string;
  queueStatus: string;
  deadline: string;
}

// True only when the scraped numbers actually contradict each other (more
// likes or comments than views), which means the view count can't be trusted
// for ranking. A hidden (null) metric is never a contradiction — hidden-likes
// videos rank on their views like any other.
export function hasContradictoryMetrics(v: Pick<Video, "views" | "likes" | "comments">): boolean {
  if (v.views === null) return false;
  const views = v.views;
  return (v.likes !== null && v.likes > views) || (v.comments !== null && v.comments > views);
}

export const VIDEO_STATUSES = ["To Do", "In Progress", "Done"] as const;
export const REMAKE_FORMATS = [
  "Caption Post",
  "Slideshow",
  "Green-Screen React",
  "Carousel",
  "Clip & Re-hook",
  "Talking Head",
] as const;

export interface PipelineParams {
  configName: string;
  maxVideos: number;
  topK: number;
  nDays: number;
}

export interface LinkPipelineParams {
  configName: string;
  links: string[];
  // Re-scrape and re-analyze links already in the library (e.g. after a
  // prompt change) instead of skipping them. upsertVideos() then refreshes
  // the existing row in place, keeping its id and manual queue fields.
  reanalyze?: boolean;
}

export interface ActiveTask {
  id: string;
  creator: string;
  step: string;
  views?: number;
}

export interface PipelineProgress {
  status: "idle" | "running" | "completed" | "error" | "stopped";
  phase: "scraping" | "analyzing" | "done";
  activeTasks: ActiveTask[];
  creatorsCompleted: number;
  creatorsTotal: number;
  creatorsScraped: number;
  videosAnalyzed: number;
  videosTotal: number;
  errors: string[];
  log: string[];
}
