import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { readVideos, writeVideos } from "@/lib/csv";
import { REMAKE_FORMATS, VIDEO_STATUSES } from "@/lib/types";
import { CANONICAL_FORMATS } from "@/lib/format";
import { CANONICAL_HOOK_PATTERNS, CANONICAL_ANGLES } from "@/lib/classify";
import { CANONICAL_NICHES } from "@/lib/niche";

function isValidDeadline(value: string): boolean {
  if (value === "") return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// This data is read from Vercel Blob and changes on every write (star toggle,
// pipeline run) — never cache, or reads can lag behind the latest write.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const configName = searchParams.get("configName");
  const creator = searchParams.get("creator");

  let videos = await readVideos();

  if (configName) videos = videos.filter((v) => v.configName === configName);
  if (creator) videos = videos.filter((v) => v.creator === creator);

  // Sort by dateAdded desc, then views desc
  videos.sort((a, b) => {
    const dateDiff = (b.dateAdded || "").localeCompare(a.dateAdded || "");
    if (dateDiff !== 0) return dateDiff;
    return (b.views ?? -1) - (a.views ?? -1);
  });

  return NextResponse.json(videos);
}

// Accepts a partial update of the editable fields — the star toggle plus the
// manual queue/action fields, which are hand-filled and never touched by the
// pipeline. Anything else on Video (views, analysis, etc.) is not writable
// through this route.
export async function PATCH(request: Request) {
  const body = await request.json();
  const { id } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const videos = await readVideos();
  const video = videos.find((v) => v.id === id);
  if (!video) return NextResponse.json({ error: "not found" }, { status: 404 });

  if ("remakeFormat" in body) {
    const value = String(body.remakeFormat ?? "");
    if (value !== "" && !(REMAKE_FORMATS as readonly string[]).includes(value)) {
      return NextResponse.json({ error: `invalid remakeFormat: ${value}` }, { status: 400 });
    }
  }
  if ("queueStatus" in body) {
    const value = String(body.queueStatus ?? "");
    if (!(VIDEO_STATUSES as readonly string[]).includes(value)) {
      return NextResponse.json({ error: `invalid queueStatus: ${value}` }, { status: 400 });
    }
  }
  if ("deadline" in body) {
    const value = String(body.deadline ?? "");
    if (!isValidDeadline(value)) {
      return NextResponse.json({ error: `invalid deadline: ${value}` }, { status: 400 });
    }
  }
  if ("format" in body) {
    const value = String(body.format ?? "");
    if (value !== "" && !(CANONICAL_FORMATS as readonly string[]).includes(value)) {
      return NextResponse.json({ error: `invalid format: ${value}` }, { status: 400 });
    }
  }
  if ("hookPattern" in body) {
    const value = String(body.hookPattern ?? "");
    if (value !== "" && !(CANONICAL_HOOK_PATTERNS as readonly string[]).includes(value)) {
      return NextResponse.json({ error: `invalid hookPattern: ${value}` }, { status: 400 });
    }
  }
  if ("angle" in body) {
    const value = String(body.angle ?? "");
    if (value !== "" && !(CANONICAL_ANGLES as readonly string[]).includes(value)) {
      return NextResponse.json({ error: `invalid angle: ${value}` }, { status: 400 });
    }
  }
  if ("niche" in body) {
    const value = String(body.niche ?? "");
    if (value !== "" && !(CANONICAL_NICHES as readonly string[]).includes(value)) {
      return NextResponse.json({ error: `invalid niche: ${value}` }, { status: 400 });
    }
  }

  if ("starred" in body) video.starred = !!body.starred;
  if ("remakeFormat" in body) video.remakeFormat = String(body.remakeFormat ?? "");
  if ("assignedPage" in body) video.assignedPage = String(body.assignedPage ?? "");
  if ("queueStatus" in body) video.queueStatus = String(body.queueStatus ?? "To Do");
  if ("deadline" in body) video.deadline = String(body.deadline ?? "");
  if ("format" in body) video.format = String(body.format ?? "");
  if ("hookPattern" in body) video.hookPattern = String(body.hookPattern ?? "");
  if ("angle" in body) video.angle = String(body.angle ?? "");
  if ("niche" in body) video.niche = String(body.niche ?? "");

  await writeVideos(videos);
  return NextResponse.json(video);
}

// Single delete: DELETE /api/videos?id=xxx
// Bulk delete: DELETE /api/videos with JSON body { ids: string[] }
// Bulk takes a single read-modify-write pass rather than N calls to the
// single-id path — concurrent single deletes would each read the same
// starting list and write back independently, silently losing whichever
// deletion lost the race.
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const singleId = searchParams.get("id");

  let ids: string[];
  if (singleId) {
    ids = [singleId];
  } else {
    const body = await request.json().catch(() => null);
    ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
  }
  if (ids.length === 0) return NextResponse.json({ error: "id or ids required" }, { status: 400 });

  const idSet = new Set(ids);
  const videos = await readVideos();
  const toDelete = videos.filter((v) => idSet.has(v.id));
  if (toDelete.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });

  const remaining = videos.filter((v) => !idSet.has(v.id));
  await writeVideos(remaining);

  // Best-effort cleanup of saved thumbnails — a Blob hiccup shouldn't block
  // the record delete, which is the part the user is waiting on.
  await Promise.all(
    toDelete.map(async (video) => {
      if (!video.thumbnail?.startsWith("http")) return;
      try {
        await del(video.thumbnail);
      } catch {
        // ignore — orphaned blob, not worth failing the request over
      }
    })
  );

  return NextResponse.json({ success: true, deleted: toDelete.length });
}
