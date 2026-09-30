import { runPipelineFromLinks } from "@/lib/pipeline";
import type { LinkPipelineParams } from "@/lib/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const params: LinkPipelineParams = await request.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Enqueueing after the client has disconnected (Stop button, tab
      // closed, etc.) throws — the controller is already closed/errored at
      // that point. That's expected once request.signal.aborted flips true,
      // not a real failure, so swallow it instead of crashing the handler.
      const safeEnqueue = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk);
        } catch {
          // client gone — nothing to do
        }
      };

      try {
        await runPipelineFromLinks(
          params,
          (progress) => {
            const data = `data: ${JSON.stringify(progress)}\n\n`;
            safeEnqueue(encoder.encode(data));
          },
          () => request.signal.aborted
        );
      } catch (err) {
        const errorData = `data: ${JSON.stringify({
          status: "error",
          errors: [err instanceof Error ? err.message : "Unknown error"],
          log: [],
          currentCreator: "",
          currentStep: "",
          creatorsCompleted: 0,
          creatorsTotal: 0,
          videosAnalyzed: 0,
          videosTotal: 0,
        })}\n\n`;
        safeEnqueue(encoder.encode(errorData));
      } finally {
        try {
          controller.close();
        } catch {
          // already closed (e.g. client disconnected) — fine
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
