import { NextResponse } from "next/server";
import { stringify } from "csv-stringify/sync";
import { readVideos } from "@/lib/csv";

export const dynamic = "force-dynamic";

const EXPORT_COLUMNS = [
  "Username",
  "Link",
  "Platform",
  "Niche",
  "Followers",
  "Views",
  "Likes",
  "Comments",
  "Shares",
  "Saves",
  "Views/Follower Ratio",
  "Velocity (Views/Day)",
  "Date Posted",
  "Date Added",
  "Hook Text",
  "Hook Pattern",
  "Structure",
  "Framework",
  "Script Beats",
  "Angle",
  "Format",
  "CTA",
  "Transcript",
  "Script - Hook Line",
  "Script - Body",
  "Script - CTA Line",
  "Remake Format",
  "Assigned Page",
  "Status",
  "Deadline",
];

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((x: unknown) => typeof x === "string")
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }

  const videos = await readVideos();
  const byId = new Map(videos.map((v) => [v.id, v]));

  // Preserve the order the client sent (its current on-screen sort/filter
  // order), not the store's own order.
  const rows = ids
    .map((id) => byId.get(id))
    .filter((v): v is NonNullable<typeof v> => !!v)
    .map((v) => ({
      Username: v.creator,
      Link: v.link,
      Platform: v.platform,
      Niche: v.niche,
      Followers: v.followers || 0,
      // null (genuinely unavailable from the source, e.g. Instagram's hidden-
      // likes sentinel) renders as a blank cell, not a fabricated 0 — see
      // Video.views in types.ts.
      Views: v.views ?? "",
      Likes: v.likes ?? "",
      Comments: v.comments ?? "",
      Shares: v.shares ?? "",
      // Blank rather than 0 — the scraper never actually reports saves today,
      // so a literal 0 would misleadingly imply a verified zero-saves count.
      Saves: v.saves > 0 ? v.saves : "",
      "Views/Follower Ratio": v.viewsPerFollower ?? "",
      "Velocity (Views/Day)": v.velocity ?? "",
      "Date Posted": v.datePosted,
      "Date Added": v.dateAdded,
      "Hook Text": v.hookText,
      "Hook Pattern": v.hookPattern,
      Structure: v.structure,
      Framework: v.framework,
      "Script Beats": v.scriptBeats,
      Angle: v.angle,
      Format: v.format,
      CTA: v.cta,
      Transcript: v.transcript,
      "Script - Hook Line": v.scriptHook,
      "Script - Body": v.scriptBody,
      "Script - CTA Line": v.scriptCta,
      "Remake Format": v.remakeFormat,
      "Assigned Page": v.assignedPage,
      Status: v.queueStatus,
      Deadline: v.deadline,
    }));

  const csv = stringify(rows, { header: true, columns: EXPORT_COLUMNS });

  // UTF-8 BOM — without it, Sheets/Excel can mis-detect encoding and mangle
  // emoji/accented characters that are common in real captions/transcripts.
  const body_ = "﻿" + csv;

  const filename = `videos-export-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(body_, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
