import { closestMatch } from "./textMatch";

// Canonical video-format labels — must match the exact wording given to
// Gemini in each config's analysisInstruction ("copied word-for-word").
export const CANONICAL_FORMATS = [
  "Talking head",
  "Green-screen react",
  "Caption post",
  "Slideshow",
  "Carousel",
  "Street interview",
  "B-roll + text",
  "Clip & re-hook",
] as const;

// Known variants (from earlier prompt wording, or Gemini drift) mapped onto
// the current canonical list, keyed lowercase for case-insensitive lookup.
const FORMAT_ALIASES: Record<string, string> = {
  "talking head": "Talking head",
  "green-screen react": "Green-screen react",
  "green screen react": "Green-screen react",
  "greenscreen react": "Green-screen react",
  "caption post": "Caption post",
  slideshow: "Slideshow",
  carousel: "Carousel",
  "street interview": "Street interview",
  "b-roll + text": "B-roll + text",
  "broll + text": "B-roll + text",
  "text-on-screen": "B-roll + text",
  "text on screen": "B-roll + text",
  "voiceover b-roll": "B-roll + text",
  "clip & re-hook": "Clip & re-hook",
  "clip and re-hook": "Clip & re-hook",
  "clip & rehook": "Clip & re-hook",
};

// Trims + case-folds any format string Gemini returns onto one canonical
// spelling, so "Talking Head" / "talking head" / "Talking head" all collapse
// to a single value the filter dropdown and export see once. Anything that
// doesn't match a known alias or canonical value is forced onto the closest
// canonical option (see textMatch.ts) — the result is always one of
// CANONICAL_FORMATS, never freeform text, so pattern analysis across videos
// stays consistent.
export function normalizeFormat(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const lower = trimmed.toLowerCase();
  if (FORMAT_ALIASES[lower]) return FORMAT_ALIASES[lower];

  const canonical = CANONICAL_FORMATS.find((c) => c.toLowerCase() === lower);
  if (canonical) return canonical;

  return closestMatch(trimmed, CANONICAL_FORMATS);
}
