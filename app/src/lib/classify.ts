import { closestMatch } from "./textMatch";

// Canonical hook-pattern / angle labels — must match the exact wording given
// to Gemini in each config's analysisInstruction, same convention as
// CANONICAL_FORMATS in format.ts.
export const CANONICAL_HOOK_PATTERNS = [
  "Nostalgia check",
  "Insider reveal",
  "Free value transfer",
  "Curiosity gap",
  "Pattern interrupt",
  "Age claim",
  "Social proof",
] as const;

export const CANONICAL_ANGLES = [
  "Insider secret",
  "Transformation",
  "Us-vs-them",
  "Curiosity",
  "Nostalgia",
  "Authority",
  "Fear/warning",
] as const;

const HOOK_PATTERN_ALIASES: Record<string, string> = {
  "nostalgia check": "Nostalgia check",
  nostalgia: "Nostalgia check",
  throwback: "Nostalgia check",
  "insider reveal": "Insider reveal",
  "insider secret": "Insider reveal",
  "behind the scenes": "Insider reveal",
  "free value transfer": "Free value transfer",
  "free value": "Free value transfer",
  "value transfer": "Free value transfer",
  "curiosity gap": "Curiosity gap",
  curiosity: "Curiosity gap",
  "pattern interrupt": "Pattern interrupt",
  "age claim": "Age claim",
  "social proof": "Social proof",
};

const ANGLE_ALIASES: Record<string, string> = {
  "insider secret": "Insider secret",
  "insider reveal": "Insider secret",
  transformation: "Transformation",
  "before and after": "Transformation",
  "us vs them": "Us-vs-them",
  "us-vs-them": "Us-vs-them",
  "us versus them": "Us-vs-them",
  curiosity: "Curiosity",
  nostalgia: "Nostalgia",
  authority: "Authority",
  expertise: "Authority",
  "fear/warning": "Fear/warning",
  fear: "Fear/warning",
  warning: "Fear/warning",
};

// Forces any hook_pattern/angle string Gemini returns onto one canonical
// spelling — exact/alias match first, then the closest canonical option by
// word overlap (see textMatch.ts). The result is always one of the fixed
// list, never freeform text, so cross-video pattern analysis stays
// consistent. Applied both when a new video is analyzed (gemini.ts) and on
// every read (csv.ts), so already-stored inconsistent values self-heal
// without a migration.
function normalizeAgainst(raw: string, canonical: readonly string[], aliases: Record<string, string>): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const lower = trimmed.toLowerCase();
  if (aliases[lower]) return aliases[lower];

  const exact = canonical.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;

  return closestMatch(trimmed, canonical);
}

export function normalizeHookPattern(raw: string): string {
  return normalizeAgainst(raw, CANONICAL_HOOK_PATTERNS, HOOK_PATTERN_ALIASES);
}

export function normalizeAngle(raw: string): string {
  return normalizeAgainst(raw, CANONICAL_ANGLES, ANGLE_ALIASES);
}
