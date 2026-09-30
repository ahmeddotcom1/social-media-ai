import { closestMatch } from "./textMatch";

// Canonical niche labels — must match the exact wording given to Gemini in
// each config's analysisInstruction, same convention as CANONICAL_FORMATS
// in format.ts and CANONICAL_HOOK_PATTERNS/CANONICAL_ANGLES in classify.ts.
export const CANONICAL_NICHES = [
  "Anti-aging",
  "Wellness & Supplements",
  "Skincare & Beauty",
  "Fitness & Weight Loss",
  "Gut & Digestive Health",
  "Nutrition & Diet",
  "Healthy Recipes",
  "Mental Health",
  "Other",
] as const;

// Known near-duplicates actually seen in the data, mapped onto the current
// canonical list, keyed lowercase for case-insensitive lookup.
const NICHE_ALIASES: Record<string, string> = {
  "health & wellness": "Wellness & Supplements",
  "health and wellness": "Wellness & Supplements",
  wellness: "Wellness & Supplements",
  "health & fitness": "Fitness & Weight Loss",
  "health and fitness": "Fitness & Weight Loss",
  "health & weight loss": "Fitness & Weight Loss",
  "weight loss": "Fitness & Weight Loss",
  fitness: "Fitness & Weight Loss",
  "health & nutrition": "Nutrition & Diet",
  "health and nutrition": "Nutrition & Diet",
  nutrition: "Nutrition & Diet",
  diet: "Nutrition & Diet",
  "healthy baking & nutrition": "Healthy Recipes",
  "healthy baking and nutrition": "Healthy Recipes",
  "healthy baking recipes": "Healthy Recipes",
  "healthy recipes": "Healthy Recipes",
  recipes: "Healthy Recipes",
  baking: "Healthy Recipes",
  "gut health & weight loss": "Gut & Digestive Health",
  "gut health": "Gut & Digestive Health",
  "gut & digestive health": "Gut & Digestive Health",
  "digestive health": "Gut & Digestive Health",
  "anti-aging & fitness": "Anti-aging",
  "anti aging": "Anti-aging",
  antiaging: "Anti-aging",
  "skincare & beauty": "Skincare & Beauty",
  skincare: "Skincare & Beauty",
  beauty: "Skincare & Beauty",
  "mental health": "Mental Health",
  supplements: "Wellness & Supplements",
};

// Forces any niche string Gemini returns (or a manual edit) onto one
// canonical spelling — exact/alias match first, then the closest canonical
// option by word overlap (see textMatch.ts). The result is always one of
// CANONICAL_NICHES, never freeform text, so the filter dropdown and pattern
// analysis across videos stay consistent. Applied when a new video is
// analyzed (gemini.ts), on every read (csv.ts, self-heals existing data with
// no migration), and on manual edits (api/videos/route.ts).
export function normalizeNiche(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const lower = trimmed.toLowerCase();
  if (NICHE_ALIASES[lower]) return NICHE_ALIASES[lower];

  const exact = CANONICAL_NICHES.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;

  return closestMatch(trimmed, CANONICAL_NICHES);
}
