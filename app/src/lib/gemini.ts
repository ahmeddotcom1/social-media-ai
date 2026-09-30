import { normalizeFormat } from "./format";
import { normalizeHookPattern, normalizeAngle } from "./classify";
import { normalizeNiche } from "./niche";

const GEMINI_UPLOAD_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GENERATE_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  return key;
}

export async function uploadVideo(
  videoBuffer: Buffer,
  mimeType: string
): Promise<{ uri: string; mimeType: string }> {
  const key = getApiKey();

  const response = await fetch(`${GEMINI_UPLOAD_URL}?key=${key}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Command": "start, upload, finalize",
      "X-Goog-Upload-Header-Content-Length": String(videoBuffer.length),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": mimeType,
    },
    body: new Uint8Array(videoBuffer),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini upload error ${response.status}: ${text}`);
  }

  const data = await response.json();
  const fileName = data.file.name; // e.g. "files/abc123"
  const fileUri = data.file.uri;
  const fileMimeType = data.file.mimeType;

  // Poll until file is ACTIVE (Gemini needs to process the upload)
  await waitForFileActive(fileName);

  return { uri: fileUri, mimeType: fileMimeType };
}

async function waitForFileActive(fileName: string, maxWaitMs = 120000): Promise<void> {
  const key = getApiKey();
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${key}`
    );

    if (!response.ok) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    const data = await response.json();
    const state = data.state;

    if (state === "ACTIVE") return;
    if (state === "FAILED") throw new Error(`Gemini file processing failed for ${fileName}`);

    // Still PROCESSING — wait and retry
    await new Promise((r) => setTimeout(r, 3000));
  }

  throw new Error(`Gemini file ${fileName} did not become ACTIVE within ${maxWaitMs / 1000}s`);
}

export interface VideoAnalysis {
  hookText: string;
  hookPattern: string;
  scriptBeats: string;
  angle: string;
  format: string;
  structure: string;
  framework: string;
  niche: string;
  cta: string;
}

// A field that came back as an array (e.g. script_beats as a list of beats)
// is flattened to a readable, newline-separated string — CSV/UI both expect
// plain text per field, not nested JSON.
function toFlatString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
      .join("\n");
  }
  if (value == null) return "";
  return JSON.stringify(value);
}

// The config's analysisInstruction is expected to instruct Gemini to return
// JSON with these exact snake_case keys — this call just asks for JSON mode
// and maps that response onto the app's structured Video fields.
export async function analyzeVideo(
  fileUri: string,
  mimeType: string,
  analysisPrompt: string,
  maxRetries = 3
): Promise<VideoAnalysis> {
  const key = getApiKey();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(`${GEMINI_GENERATE_URL}?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { fileData: { fileUri, mimeType } },
                { text: analysisPrompt },
              ],
            },
          ],
          generationConfig: { responseMimeType: "application/json" },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        if (attempt < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }
        throw new Error(`Gemini analysis error ${response.status}: ${text}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      const parsed = JSON.parse(text);
      return {
        hookText: toFlatString(parsed.hook_text),
        hookPattern: normalizeHookPattern(toFlatString(parsed.hook_pattern)),
        scriptBeats: toFlatString(parsed.script_beats),
        angle: normalizeAngle(toFlatString(parsed.angle)),
        format: normalizeFormat(toFlatString(parsed.format)),
        structure: toFlatString(parsed.structure),
        framework: toFlatString(parsed.framework),
        niche: normalizeNiche(toFlatString(parsed.niche)),
        cta: toFlatString(parsed.cta),
      };
    } catch (error) {
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      throw error;
    }
  }

  throw new Error("Gemini analysis failed after retries");
}

const SCRIPT_PROMPT = `You are extracting the full spoken script from this video, split into parts. Return ONLY compact JSON matching this exact schema, no markdown fences, no commentary:
{"transcript": string, "script_hook": string, "script_body": string, "script_cta": string}

- "transcript": a verbatim, word-for-word transcript of all spoken/voiceover audio in the video, in order. If there is no spoken audio, transcribe any on-screen text verbatim instead, in order.
- "script_hook": the verbatim opening spoken line(s) that open the video (the hook/first sentence(s)).
- "script_body": the verbatim middle spoken content — the value, problem, or demonstration portion, excluding the opening hook and closing CTA.
- "script_cta": the verbatim closing spoken line(s) — the call-to-action or closing statement. Empty string if the video has no explicit CTA.

script_hook + script_body + script_cta should together reconstruct the full transcript in order, split at natural boundaries. If a field cannot be determined, use an empty string for it. Return only the JSON object.`;

interface ScriptExtraction {
  transcript: string;
  scriptHook: string;
  scriptBody: string;
  scriptCta: string;
}

// A second, fixed-prompt Gemini call (reusing the already-uploaded file) so
// the transcript/script breakdown is always populated in a predictable shape,
// regardless of what a given config's custom analysisInstruction asks for.
// Best-effort: any failure here is non-fatal to the caller, it should just
// leave the fields blank.
export async function extractScript(
  fileUri: string,
  mimeType: string,
  maxRetries = 2
): Promise<ScriptExtraction> {
  const key = getApiKey();
  const empty: ScriptExtraction = { transcript: "", scriptHook: "", scriptBody: "", scriptCta: "" };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(`${GEMINI_GENERATE_URL}?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { fileData: { fileUri, mimeType } },
                { text: SCRIPT_PROMPT },
              ],
            },
          ],
          generationConfig: { responseMimeType: "application/json" },
        }),
      });

      if (!response.ok) {
        if (attempt < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        return empty;
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      const parsed = JSON.parse(text);
      return {
        transcript: typeof parsed.transcript === "string" ? parsed.transcript : "",
        scriptHook: typeof parsed.script_hook === "string" ? parsed.script_hook : "",
        scriptBody: typeof parsed.script_body === "string" ? parsed.script_body : "",
        scriptCta: typeof parsed.script_cta === "string" ? parsed.script_cta : "",
      };
    } catch {
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      return empty;
    }
  }

  return empty;
}
