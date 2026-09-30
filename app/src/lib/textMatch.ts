// Shared "force onto a fixed list" fallback used by format.ts and classify.ts.
// Scores each canonical option by how many significant words it shares with
// the raw value and returns the best match — a deterministic, dependency-free
// heuristic appropriate for short controlled-vocabulary lists. It is not a
// semantic matcher: it catches near-miss phrasing and reordered words, not
// deep synonyms outside a curated alias table. Ties go to the first canonical
// entry with the highest score; if nothing shares even one word, it falls
// back to the first canonical entry so the result is always one of the
// allowed values, never invented text.
function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
}

export function closestMatch(raw: string, canonical: readonly string[]): string {
  const rawTokens = tokenize(raw);
  let best = canonical[0];
  let bestScore = -1;

  for (const option of canonical) {
    const optionTokens = tokenize(option);
    let shared = 0;
    for (const t of rawTokens) {
      if (optionTokens.has(t)) shared++;
    }
    if (shared > bestScore) {
      bestScore = shared;
      best = option;
    }
  }

  return best;
}
