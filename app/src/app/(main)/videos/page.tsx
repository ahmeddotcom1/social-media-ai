"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Heart, MessageCircle, Film, Search, Star, Play, ArrowUpDown, X, ExternalLink, Share2, Check, FileText, Zap, Trash2, CheckSquare, Square, Download, Users, Flame, ListTodo, CalendarDays, EyeOff, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownContent } from "@/components/markdown-content";
import { REMAKE_FORMATS, VIDEO_STATUSES, hasContradictoryMetrics } from "@/lib/types";
import { CANONICAL_FORMATS } from "@/lib/format";
import { CANONICAL_HOOK_PATTERNS, CANONICAL_ANGLES } from "@/lib/classify";
import { CANONICAL_NICHES } from "@/lib/niche";
import type { Video, Config } from "@/lib/types";

function queueStatusClasses(status: string): string {
  if (status === "In Progress") return "bg-amber-500/[0.1] border-amber-500/25 text-amber-300";
  if (status === "Done") return "bg-emerald-500/[0.1] border-emerald-500/25 text-emerald-300";
  return "bg-white/[0.05] border-white/[0.1] text-muted-foreground";
}

function isBlobUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

function thumbnailSrc(thumbnail: string): string {
  // Locally-saved thumbnails (/thumbnails/...) and our own Vercel Blob copies
  // are stable, public and CORS-free — serve directly. Only older rows that
  // still hold a raw external CDN URL go through the proxy.
  return thumbnail.startsWith("/") || isBlobUrl(thumbnail)
    ? thumbnail
    : `/api/proxy-image?url=${encodeURIComponent(thumbnail)}`;
}

// Falls back to the same film-icon placeholder as a missing thumbnail when
// the image fails to load (expired legacy CDN URL, deleted blob, etc.), so a
// broken thumbnail never shows the browser's broken-image glyph.
function Thumbnail({ src, alt, imgClassName, iconClassName }: { src: string; alt: string; imgClassName: string; iconClassName: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Film className={iconClassName} />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={thumbnailSrc(src)} alt={alt} className={imgClassName} onError={() => setFailedSrc(src)} />
  );
}

// "slow" = still running after a few seconds, which means the stored URL had
// expired and the server is re-scraping the post for a fresh one.
type DownloadStatus = "loading" | "slow";

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

function DownloadVideoButton({ status, onClick, className }: { status?: DownloadStatus; onClick: () => void; className: string }) {
  return (
    <button
      onClick={onClick}
      disabled={!!status}
      title={status === "slow" ? "Fetching fresh link…" : status ? "Downloading…" : "Download video"}
      aria-label="Download video"
      className="shrink-0 ml-1.5 transition-colors text-muted-foreground/40 hover:text-purple-400 disabled:cursor-wait"
    >
      {status ? <Loader2 className={`${className} animate-spin`} /> : <Download className={className} />}
    </button>
  );
}

function formatViews(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toString();
}

// Likes are null when the creator used Instagram's hide-likes setting (the
// only metric creators can hide) — label it so it isn't read as zero.
function LikesCount({ likes }: { likes: number | null }) {
  return (
    <span className="inline-flex items-center gap-1" title={likes === null ? "Likes hidden by the creator" : undefined}>
      <Heart className="h-3 w-3" />
      {likes === null ? (
        <span className="inline-flex items-center gap-0.5 text-muted-foreground/60">
          <EyeOff className="h-2.5 w-2.5" />
          hidden
        </span>
      ) : (
        formatViews(likes)
      )}
    </span>
  );
}

type SortOption = "views" | "likes" | "comments" | "shares" | "date-posted" | "date-added" | "starred" | "format" | "hook-pattern" | "niche" | "ratio" | "velocity";

function AnalysisField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-4 py-3 min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap break-words">{value}</p>
    </div>
  );
}

function StatField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2 min-w-0">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-foreground/90">{value}</p>
    </div>
  );
}

// Same card as AnalysisField, but the value itself is an editable dropdown —
// used for Format, which Gemini sometimes misclassifies and the user needs
// to correct by hand.
function EditableSelectField({
  label,
  value,
  options,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-4 py-3 min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <Select value={value || "none"} onValueChange={(v) => onChange(v === "none" ? "" : v)}>
        <SelectTrigger className="mt-1.5 h-8 w-full rounded-lg glass border-white/[0.08] text-sm">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{placeholder}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>{o}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function VideosPage() {
  return (
    <Suspense>
      <VideosContent />
    </Suspense>
  );
}

function VideosContent() {
  const searchParams = useSearchParams();
  const [videos, setVideos] = useState<Video[]>([]);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [filterConfig, setFilterConfig] = useState<string>("all");
  const [filterFormat, setFilterFormat] = useState<string>("all");
  const [filterHookPattern, setFilterHookPattern] = useState<string>("all");
  const [filterNiche, setFilterNiche] = useState<string>("all");
  const [filterQueueStatus, setFilterQueueStatus] = useState<string>("all");
  const [searchCreator, setSearchCreator] = useState<string>(searchParams.get("creator") || "");
  const [sortBy, setSortBy] = useState<SortOption>("views");
  const [modalVideo, setModalVideo] = useState<Video | null>(null);
  const [modalSection, setModalSection] = useState<"analysis" | "transcript" | "queue">("analysis");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloads, setDownloads] = useState<Record<string, DownloadStatus>>({});
  const [downloadErrors, setDownloadErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/videos").then((r) => r.json()).then(setVideos);
    fetch("/api/configs").then((r) => r.json()).then(setConfigs);
  }, []);

  const formatOptions = [...new Set(videos.map((v) => v.format).filter(Boolean))].sort();
  const hookPatternOptions = [...new Set(videos.map((v) => v.hookPattern).filter(Boolean))].sort();
  const nicheOptions = [...new Set(videos.map((v) => v.niche).filter(Boolean))].sort();

  const filtered = videos
    .filter((v) => {
      if (filterConfig !== "all" && v.configName !== filterConfig) return false;
      if (filterFormat !== "all" && v.format !== filterFormat) return false;
      if (filterHookPattern !== "all" && v.hookPattern !== filterHookPattern) return false;
      if (filterNiche !== "all" && v.niche !== filterNiche) return false;
      if (filterQueueStatus !== "all" && (v.queueStatus || "To Do") !== filterQueueStatus) return false;
      if (searchCreator.trim() && !v.creator.toLowerCase().includes(searchCreator.trim().toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "starred") {
        if (a.starred !== b.starred) return a.starred ? -1 : 1;
        return (b.views ?? -1) - (a.views ?? -1);
      }
      if (sortBy === "views") return (b.views ?? -1) - (a.views ?? -1);
      if (sortBy === "likes") return (b.likes ?? -1) - (a.likes ?? -1);
      if (sortBy === "comments") return (b.comments ?? -1) - (a.comments ?? -1);
      if (sortBy === "shares") return (b.shares ?? -1) - (a.shares ?? -1);
      if (sortBy === "date-posted") return (b.datePosted || "").localeCompare(a.datePosted || "");
      if (sortBy === "date-added") return (b.dateAdded || "").localeCompare(a.dateAdded || "");
      if (sortBy === "format") return (a.format || "").localeCompare(b.format || "");
      if (sortBy === "hook-pattern") return (a.hookPattern || "").localeCompare(b.hookPattern || "");
      if (sortBy === "niche") return (a.niche || "").localeCompare(b.niche || "");
      // Views-derived rankings push contradictory rows (likes/comments > views)
      // to the bottom, since their view count is suspect. Hidden likes alone
      // don't count — see hasContradictoryMetrics().
      if (sortBy === "ratio" || sortBy === "velocity") {
        const unreliableDiff = Number(hasContradictoryMetrics(a)) - Number(hasContradictoryMetrics(b));
        if (unreliableDiff !== 0) return unreliableDiff;
        if (sortBy === "ratio") return (b.viewsPerFollower || 0) - (a.viewsPerFollower || 0);
        return (b.velocity || 0) - (a.velocity || 0);
      }
      return 0;
    });

  const openModal = (video: Video, section: "analysis" | "transcript" | "queue") => {
    setModalVideo(video);
    setModalSection(section);
  };

  const toggleStar = async (id: string, currentStarred: boolean) => {
    const newStarred = !currentStarred;
    setVideos((prev) =>
      prev.map((v) => (v.id === id ? { ...v, starred: newStarred } : v))
    );
    await fetch("/api/videos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, starred: newStarred }),
    });
  };

  // Shared updater for the manual queue/action fields — optimistic local
  // update, same PATCH endpoint as the star toggle.
  const updateVideoField = async (id: string, patch: Partial<Video>) => {
    setVideos((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
    setModalVideo((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
    await fetch("/api/videos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
  };

  const deleteVideo = async (id: string, creator: string) => {
    if (!confirm(`Delete this video from @${creator}? This can't be undone.`)) return;
    setVideos((prev) => prev.filter((v) => v.id !== id));
    if (modalVideo?.id === id) setModalVideo(null);
    await fetch(`/api/videos?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const allFilteredSelected = filtered.length > 0 && filtered.every((v) => selectedIds.has(v.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      clearSelection();
    } else {
      setSelectedIds(new Set(filtered.map((v) => v.id)));
    }
  };

  const exportSelected = async () => {
    // Export in current on-screen order, not click order.
    const ids = filtered.filter((v) => selectedIds.has(v.id)).map((v) => v.id);
    if (ids.length === 0) return;

    const response = await fetch("/api/videos/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!response.ok) return;

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const disposition = response.headers.get("Content-Disposition") || "";
    const filenameMatch = disposition.match(/filename="([^"]+)"/);
    const a = document.createElement("a");
    a.href = url;
    a.download = filenameMatch?.[1] || "videos-export.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // Fetched (not a plain link) so a JSON error from the route — expired URL
  // that couldn't be refreshed, deleted post — shows as a message instead of
  // the browser saving the error body as a broken .mp4.
  const downloadVideo = async (video: Video) => {
    const { id } = video;
    if (downloads[id]) return;
    setDownloads((d) => ({ ...d, [id]: "loading" }));
    setDownloadErrors((e) => omitKey(e, id));
    const slowTimer = setTimeout(() => setDownloads((d) => (d[id] ? { ...d, [id]: "slow" } : d)), 3000);

    try {
      const response = await fetch(`/api/videos/${encodeURIComponent(id)}/download`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `Download failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const disposition = response.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameMatch?.[1] || `${video.creator}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDownloadErrors((e) => ({ ...e, [id]: message }));
      setTimeout(() => setDownloadErrors((e) => (e[id] === message ? omitKey(e, id) : e)), 8000);
    } finally {
      clearTimeout(slowTimer);
      setDownloads((d) => omitKey(d, id));
    }
  };

  const bulkDelete = async () => {
    const n = selectedIds.size;
    if (n === 0) return;
    if (!confirm(`Delete ${n} selected video${n === 1 ? "" : "s"}? This can't be undone.`)) return;

    const ids = [...selectedIds];
    setVideos((prev) => prev.filter((v) => !selectedIds.has(v.id)));
    if (modalVideo && selectedIds.has(modalVideo.id)) setModalVideo(null);
    clearSelection();

    await fetch("/api/videos", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Videos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse analyzed competitor reels with AI insights
        </p>
      </div>

      {/* Filters & Sort */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={filterConfig} onValueChange={setFilterConfig}>
          <SelectTrigger className="w-[220px] rounded-xl glass border-white/[0.08] h-10">
            <SelectValue placeholder="Filter by config" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Configs</SelectItem>
            {configs.map((c) => (
              <SelectItem key={c.id} value={c.configName}>{c.configName}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterFormat} onValueChange={setFilterFormat}>
          <SelectTrigger className="w-[170px] rounded-xl glass border-white/[0.08] h-10">
            <SelectValue placeholder="Filter by format" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Formats</SelectItem>
            {formatOptions.map((f) => (
              <SelectItem key={f} value={f}>{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterHookPattern} onValueChange={setFilterHookPattern}>
          <SelectTrigger className="w-[170px] rounded-xl glass border-white/[0.08] h-10">
            <SelectValue placeholder="Filter by hook pattern" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Hook Patterns</SelectItem>
            {hookPatternOptions.map((f) => (
              <SelectItem key={f} value={f}>{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterNiche} onValueChange={setFilterNiche}>
          <SelectTrigger className="w-[160px] rounded-xl glass border-white/[0.08] h-10">
            <SelectValue placeholder="Filter by niche" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Niches</SelectItem>
            {nicheOptions.map((f) => (
              <SelectItem key={f} value={f}>{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterQueueStatus} onValueChange={setFilterQueueStatus}>
          <SelectTrigger className="w-[160px] rounded-xl glass border-white/[0.08] h-10">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {VIDEO_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={searchCreator}
            onChange={(e) => setSearchCreator(e.target.value)}
            placeholder="Search creator..."
            className="pl-8 rounded-xl glass border-white/[0.08] h-10"
          />
          {searchCreator && (
            <button
              onClick={() => setSearchCreator("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
          <SelectTrigger className="w-[180px] rounded-xl glass border-white/[0.08] h-10">
            <ArrowUpDown className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="views">Most Views</SelectItem>
            <SelectItem value="likes">Most Likes</SelectItem>
            <SelectItem value="comments">Most Comments</SelectItem>
            <SelectItem value="shares">Most Shares</SelectItem>
            <SelectItem value="date-posted">Date Posted</SelectItem>
            <SelectItem value="date-added">Date Added</SelectItem>
            <SelectItem value="starred">Starred First</SelectItem>
            <SelectItem value="format">Format (A-Z)</SelectItem>
            <SelectItem value="hook-pattern">Hook Pattern (A-Z)</SelectItem>
            <SelectItem value="niche">Niche (A-Z)</SelectItem>
            <SelectItem value="ratio">Views/Follower Ratio</SelectItem>
            <SelectItem value="velocity">Velocity (Views/Day)</SelectItem>
          </SelectContent>
        </Select>

        <Badge variant="secondary" className="rounded-lg px-3 py-1.5 text-xs bg-white/[0.05] border border-white/[0.08]">
          {filtered.length} videos
        </Badge>

        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSelectAll}
          disabled={filtered.length === 0}
          className="rounded-xl text-xs h-10 gap-1.5 glass border-white/[0.08] text-muted-foreground hover:text-foreground"
        >
          {allFilteredSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          {allFilteredSelected ? "Deselect All" : "Select All"}
        </Button>
      </div>

      {/* Video Grid — Instagram-style */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        {filtered.map((video) => {
          const id = video.id || video.link;

          const isSelected = selectedIds.has(id);

          return (
            <div key={id} className="group">
              <div
                className={cn(
                  "relative glass rounded-2xl overflow-hidden transition-all duration-300 hover:border-white/[0.12]",
                  isSelected && "ring-2 ring-purple-500/70"
                )}
              >
                {/* Select checkbox — shows on hover, stays visible once anything is selected */}
                <button
                  onClick={() => toggleSelect(id)}
                  className={cn(
                    "absolute top-2 left-2 z-10 h-6 w-6 rounded-md border flex items-center justify-center transition-all duration-150",
                    isSelected
                      ? "bg-purple-500 border-purple-400 opacity-100"
                      : "bg-black/50 border-white/30 opacity-0 group-hover:opacity-100 hover:border-white/60",
                    selectedIds.size > 0 && "opacity-100"
                  )}
                  aria-label={isSelected ? "Deselect video" : "Select video"}
                >
                  {isSelected && <Check className="h-4 w-4 text-white" />}
                </button>

                {/* Thumbnail — clickable, 9:16 ratio */}
                <a
                  href={video.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative block aspect-[9/16] w-full bg-white/[0.02] overflow-hidden"
                >
                  <Thumbnail
                    src={video.thumbnail}
                    alt={`@${video.creator}`}
                    imgClassName="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    iconClassName="h-10 w-10 text-muted-foreground/20"
                  />
                  {/* Views overlay — Instagram style */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent pt-8 pb-2.5 px-3">
                    <div className="flex items-center gap-1.5">
                      <Play className="h-4 w-4 text-white fill-white" />
                      <span className="text-[15px] font-bold text-white">
                        {formatViews(video.views)}
                      </span>
                    </div>
                  </div>
                </a>

                {/* Info bar */}
                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold truncate">@{video.creator}</p>
                    <div className="flex items-center shrink-0">
                      <DownloadVideoButton status={downloads[id]} onClick={() => downloadVideo(video)} className="h-3.5 w-3.5" />
                      <button
                        onClick={() => deleteVideo(id, video.creator)}
                        className="shrink-0 ml-1.5 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground/40 hover:text-red-400" />
                      </button>
                      <button
                        onClick={() => toggleStar(id, video.starred)}
                        className="shrink-0 ml-1.5 transition-colors"
                      >
                        <Star
                          className={`h-4 w-4 ${video.starred ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/40 hover:text-yellow-400/60"}`}
                        />
                      </button>
                    </div>
                  </div>
                  {downloads[id] === "slow" && (
                    <p className="text-[10px] text-muted-foreground">Link expired — fetching a fresh one…</p>
                  )}
                  {downloadErrors[id] && (
                    <p className="text-[10px] text-red-400">{downloadErrors[id]}</p>
                  )}

                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <LikesCount likes={video.likes} />
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" />
                      {formatViews(video.comments)}
                    </span>
                    {video.shares !== null && video.shares > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Share2 className="h-3 w-3" />
                        {formatViews(video.shares)}
                      </span>
                    )}
                    <span className="ml-auto text-[10px]">{video.datePosted}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    <Select value={video.queueStatus || "To Do"} onValueChange={(v) => updateVideoField(id, { queueStatus: v })}>
                      <SelectTrigger
                        className={cn(
                          "h-5 w-auto gap-1 rounded-md border px-1.5 text-[10px] [&_svg]:h-2.5 [&_svg]:w-2.5",
                          queueStatusClasses(video.queueStatus || "To Do")
                        )}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VIDEO_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Badge variant="secondary" className="rounded-md text-[10px] bg-white/[0.05] border border-white/[0.06] text-muted-foreground">
                      {video.configName}
                    </Badge>
                    {video.viewsPerFollower !== null && video.viewsPerFollower > 0 && (
                      <Badge variant="secondary" className="rounded-md text-[10px] bg-emerald-500/[0.08] border border-emerald-500/15 text-emerald-300 gap-0.5">
                        <Flame className="h-2.5 w-2.5" />
                        {video.viewsPerFollower}x
                      </Badge>
                    )}
                    {hasContradictoryMetrics(video) && (
                      <Badge
                        variant="secondary"
                        title="Likes or comments exceed views — the scraped numbers contradict each other"
                        className="rounded-md text-[10px] bg-red-500/[0.08] border border-red-500/15 text-red-300 gap-0.5"
                      >
                        <AlertTriangle className="h-2.5 w-2.5" />
                        unreliable
                      </Badge>
                    )}
                    <Select value={video.format || "none"} onValueChange={(v) => updateVideoField(id, { format: v === "none" ? "" : v })}>
                      <SelectTrigger className="h-5 w-auto gap-1 rounded-md border px-1.5 text-[10px] bg-purple-500/[0.08] border-purple-500/15 text-purple-300 [&_svg]:h-2.5 [&_svg]:w-2.5">
                        <SelectValue placeholder="Not classified" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not classified</SelectItem>
                        {CANONICAL_FORMATS.map((f) => (
                          <SelectItem key={f} value={f}>{f}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={video.hookPattern || "none"} onValueChange={(v) => updateVideoField(id, { hookPattern: v === "none" ? "" : v })}>
                      <SelectTrigger className="h-5 w-auto gap-1 rounded-md border px-1.5 text-[10px] bg-amber-500/[0.08] border-amber-500/15 text-amber-300 [&_svg]:h-2.5 [&_svg]:w-2.5">
                        <SelectValue placeholder="Not classified" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not classified</SelectItem>
                        {CANONICAL_HOOK_PATTERNS.map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={video.angle || "none"} onValueChange={(v) => updateVideoField(id, { angle: v === "none" ? "" : v })}>
                      <SelectTrigger className="h-5 w-auto gap-1 rounded-md border px-1.5 text-[10px] bg-sky-500/[0.08] border-sky-500/15 text-sky-300 [&_svg]:h-2.5 [&_svg]:w-2.5">
                        <SelectValue placeholder="Not classified" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not classified</SelectItem>
                        {CANONICAL_ANGLES.map((a) => (
                          <SelectItem key={a} value={a}>{a}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={video.niche || "none"} onValueChange={(v) => updateVideoField(id, { niche: v === "none" ? "" : v })}>
                      <SelectTrigger className="h-5 w-auto gap-1 rounded-md border px-1.5 text-[10px] bg-rose-500/[0.08] border-rose-500/15 text-rose-300 [&_svg]:h-2.5 [&_svg]:w-2.5">
                        <SelectValue placeholder="Not classified" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not classified</SelectItem>
                        {CANONICAL_NICHES.map((n) => (
                          <SelectItem key={n} value={n}>{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-1.5 pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openModal(video, "analysis")}
                      className="flex-1 rounded-xl text-[11px] h-7 gap-1 transition-all duration-200 glass border-white/[0.06] text-muted-foreground hover:text-foreground"
                    >
                      <Search className="h-3 w-3" />
                      Analysis
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openModal(video, "transcript")}
                      className="flex-1 rounded-xl text-[11px] h-7 gap-1 transition-all duration-200 glass border-white/[0.06] text-muted-foreground hover:text-foreground"
                    >
                      <FileText className="h-3 w-3" />
                      Transcript
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openModal(video, "queue")}
                      className="flex-1 rounded-xl text-[11px] h-7 gap-1 transition-all duration-200 glass border-white/[0.06] text-muted-foreground hover:text-foreground"
                    >
                      <ListTodo className="h-3 w-3" />
                      Queue
                    </Button>
                  </div>

                  {(video.hookText || video.hook) && (
                    <button
                      onClick={() => openModal(video, "analysis")}
                      className="w-full text-left rounded-lg bg-amber-500/[0.06] border border-amber-500/15 px-2.5 py-1.5 transition-colors hover:bg-amber-500/10"
                    >
                      <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-amber-400">
                        <Zap className="h-2.5 w-2.5" />
                        Hook
                      </div>
                      <p className="mt-0.5 text-[11px] text-foreground/70 line-clamp-2">{video.hookText || video.hook}</p>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating bulk-selection bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 glass-strong rounded-2xl border border-white/[0.1] px-4 py-3 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200">
          <span className="text-sm font-medium">
            {selectedIds.size} selected
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearSelection}
            className="rounded-xl text-xs h-8 text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={exportSelected}
            className="rounded-xl text-xs h-8 gap-1.5 glass border-white/[0.08] text-muted-foreground hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
          <Button
            size="sm"
            onClick={bulkDelete}
            className="rounded-xl text-xs h-8 gap-1.5 bg-red-500/90 hover:bg-red-500 text-white border-0"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete Selected
          </Button>
        </div>
      )}

      {filtered.length === 0 && (
        <div className="glass rounded-2xl p-12 text-center">
          <Film className="mx-auto h-10 w-10 text-muted-foreground/30" />
          <h3 className="mt-4 font-semibold">No videos found</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Run a pipeline analysis to generate results, or adjust your filters.
          </p>
        </div>
      )}

      {/* Analysis / Concepts Modal */}
      <Dialog open={!!modalVideo} onOpenChange={(open) => { if (!open) setModalVideo(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden glass-strong rounded-2xl border-white/[0.08] p-0 gap-0">
          <DialogTitle className="sr-only">
            {modalSection === "analysis" ? "Video Analysis" : modalSection === "queue" ? "Queue" : "Transcript"}
          </DialogTitle>
          {modalVideo && (
            <>
              {/* Modal header */}
              <div className="flex flex-wrap items-center gap-4 p-5 border-b border-white/[0.06]">
                {/* Mini thumbnail */}
                <div className="relative h-16 w-12 shrink-0 rounded-lg overflow-hidden bg-white/[0.02]">
                  <Thumbnail
                    src={modalVideo.thumbnail}
                    alt={`@${modalVideo.creator}`}
                    imgClassName="h-full w-full object-cover"
                    iconClassName="h-4 w-4 text-muted-foreground/30"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">@{modalVideo.creator}</p>
                    <a
                      href={modalVideo.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-purple-400 transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <DownloadVideoButton status={downloads[modalVideo.id]} onClick={() => downloadVideo(modalVideo)} className="h-3.5 w-3.5" />
                  </div>
                  {downloads[modalVideo.id] === "slow" && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">Link expired — fetching a fresh one…</p>
                  )}
                  {downloadErrors[modalVideo.id] && (
                    <p className="mt-0.5 text-[11px] text-red-400">{downloadErrors[modalVideo.id]}</p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Play className="h-3 w-3 fill-current" />
                      {formatViews(modalVideo.views)}
                    </span>
                    <LikesCount likes={modalVideo.likes} />
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" />
                      {formatViews(modalVideo.comments)}
                    </span>
                    {modalVideo.shares === null ? (
                      <span
                        className="inline-flex items-center gap-1 text-muted-foreground/60"
                        title={modalVideo.platform === "Instagram" ? "Instagram's scraper doesn't report share counts" : "Share count unavailable"}
                      >
                        <Share2 className="h-3 w-3" />
                        n/a
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Share2 className="h-3 w-3" />
                        {formatViews(modalVideo.shares)}
                      </span>
                    )}
                    {modalVideo.followers > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {formatViews(modalVideo.followers)}
                      </span>
                    )}
                  </div>
                </div>
                {/* Section toggle */}
                <div className="flex gap-1.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setModalSection("analysis")}
                    className={`rounded-xl text-xs h-8 gap-1.5 transition-all duration-200 ${
                      modalSection === "analysis"
                        ? "bg-purple-500/15 text-purple-300 border border-purple-500/20"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Search className="h-3 w-3" />
                    Analysis
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setModalSection("transcript")}
                    className={`rounded-xl text-xs h-8 gap-1.5 transition-all duration-200 ${
                      modalSection === "transcript"
                        ? "bg-sky-500/15 text-sky-300 border border-sky-500/20"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <FileText className="h-3 w-3" />
                    Transcript
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setModalSection("queue")}
                    className={`rounded-xl text-xs h-8 gap-1.5 transition-all duration-200 ${
                      modalSection === "queue"
                        ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <ListTodo className="h-3 w-3" />
                    Queue
                  </Button>
                </div>
              </div>

              {/* Hook — always visible, highlighted, regardless of active section */}
              {(modalVideo.hookText || modalVideo.hook) && (
                <div className="mx-6 mt-5 rounded-xl bg-amber-500/[0.07] border border-amber-500/20 px-4 py-3 min-w-0">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-400">
                    <Zap className="h-3 w-3" />
                    Hook{modalVideo.hookPattern ? ` — ${modalVideo.hookPattern}` : ""}
                  </div>
                  <p className="mt-1 text-sm text-foreground/90 leading-relaxed break-words">{modalVideo.hookText || modalVideo.hook}</p>
                </div>
              )}

              {/* Modal body — scrollable */}
              <div className="overflow-y-auto overflow-x-hidden max-h-[calc(90vh-100px)] p-6 space-y-4">
                {modalSection === "queue" ? (
                  <div className="space-y-4 max-w-md">
                    <div>
                      <Label className="text-xs text-muted-foreground">Remake Format</Label>
                      <Select
                        value={modalVideo.remakeFormat || "none"}
                        onValueChange={(v) => updateVideoField(modalVideo.id, { remakeFormat: v === "none" ? "" : v })}
                      >
                        <SelectTrigger className="mt-1.5 rounded-xl glass border-white/[0.08] h-10 w-full">
                          <SelectValue placeholder="Not assigned" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Not assigned</SelectItem>
                          {REMAKE_FORMATS.map((f) => (
                            <SelectItem key={f} value={f}>{f}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Assigned Page</Label>
                      <Input
                        value={modalVideo.assignedPage}
                        onChange={(e) => updateVideoField(modalVideo.id, { assignedPage: e.target.value })}
                        placeholder="e.g. @myagency.page"
                        className="mt-1.5 rounded-xl glass border-white/[0.08] h-10"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Status</Label>
                      <Select
                        value={modalVideo.queueStatus || "To Do"}
                        onValueChange={(v) => updateVideoField(modalVideo.id, { queueStatus: v })}
                      >
                        <SelectTrigger className="mt-1.5 rounded-xl glass border-white/[0.08] h-10 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {VIDEO_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <CalendarDays className="h-3 w-3" />
                        Deadline
                      </Label>
                      <Input
                        type="date"
                        value={modalVideo.deadline}
                        onChange={(e) => updateVideoField(modalVideo.id, { deadline: e.target.value })}
                        className="mt-1.5 rounded-xl glass border-white/[0.08] h-10"
                      />
                    </div>
                  </div>
                ) : modalSection === "transcript" ? (
                  modalVideo.transcript ? (
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/85">{modalVideo.transcript}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">No transcript available for this video.</p>
                  )
                ) : modalVideo.niche || modalVideo.angle || modalVideo.structure || modalVideo.framework || modalVideo.scriptBeats || modalVideo.cta || modalVideo.format || modalVideo.hookPattern ? (
                  <div className="space-y-4">
                    {((modalVideo.viewsPerFollower ?? 0) > 0 || (modalVideo.velocity ?? 0) > 0 || modalVideo.saves > 0) && (
                      <div className="grid grid-cols-3 gap-3">
                        <StatField label="Views/Follower" value={modalVideo.viewsPerFollower !== null && modalVideo.viewsPerFollower > 0 ? `${modalVideo.viewsPerFollower}x` : "—"} />
                        <StatField label="Velocity" value={modalVideo.velocity !== null && modalVideo.velocity > 0 ? `${formatViews(modalVideo.velocity)}/day` : "—"} />
                        <StatField label="Saves" value={modalVideo.saves > 0 ? formatViews(modalVideo.saves) : "—"} />
                      </div>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <EditableSelectField
                        label="Format"
                        value={modalVideo.format}
                        options={CANONICAL_FORMATS}
                        placeholder="Not classified"
                        onChange={(v) => updateVideoField(modalVideo.id, { format: v })}
                      />
                      <EditableSelectField
                        label="Hook Pattern"
                        value={modalVideo.hookPattern}
                        options={CANONICAL_HOOK_PATTERNS}
                        placeholder="Not classified"
                        onChange={(v) => updateVideoField(modalVideo.id, { hookPattern: v })}
                      />
                      <EditableSelectField
                        label="Niche"
                        value={modalVideo.niche}
                        options={CANONICAL_NICHES}
                        placeholder="Not classified"
                        onChange={(v) => updateVideoField(modalVideo.id, { niche: v })}
                      />
                      <EditableSelectField
                        label="Angle"
                        value={modalVideo.angle}
                        options={CANONICAL_ANGLES}
                        placeholder="Not classified"
                        onChange={(v) => updateVideoField(modalVideo.id, { angle: v })}
                      />
                      <AnalysisField label="Structure" value={modalVideo.structure} />
                      <AnalysisField label="Framework" value={modalVideo.framework} />
                    </div>
                    <AnalysisField label="Script Beats" value={modalVideo.scriptBeats} />
                    <AnalysisField label="CTA" value={modalVideo.cta} />
                    {(modalVideo.scriptHook || modalVideo.scriptBody || modalVideo.scriptCta) && (
                      <div className="space-y-3 border-t border-white/[0.06] pt-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Verbatim Script Breakdown
                        </p>
                        <AnalysisField label="Script - Hook Line" value={modalVideo.scriptHook} />
                        <AnalysisField label="Script - Body" value={modalVideo.scriptBody} />
                        <AnalysisField label="Script - CTA Line" value={modalVideo.scriptCta} />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="min-w-0 break-words">
                    <MarkdownContent content={modalVideo.analysis} variant="analysis" />
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
