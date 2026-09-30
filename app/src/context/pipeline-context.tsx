"use client";

import { createContext, useContext, useState, useRef, useCallback } from "react";
import type { PipelineProgress } from "@/lib/types";

interface PipelineContextValue {
  running: boolean;
  progress: PipelineProgress | null;
  runPipeline: (params: { configName: string; maxVideos: number; topK: number; nDays: number }) => void;
  runPipelineFromLinks: (params: { configName: string; links: string[] }) => void;
  stopPipeline: () => void;
}

const PipelineContext = createContext<PipelineContextValue | null>(null);

export function PipelineProvider({ children }: { children: React.ReactNode }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stream = useCallback(async (url: string, body: unknown) => {
    if (running) return;
    setRunning(true);
    setProgress(null);

    abortRef.current = new AbortController();

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      });

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              setProgress(data);
            } catch {
              // skip
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // The server keeps running until its own next isAborted() checkpoint
        // (see pipeline.ts) and may still send a final "stopped" progress
        // event before the connection fully closes — but that's a race, not
        // a guarantee. Set it here too so the UI reliably reflects the stop
        // immediately regardless of whether that last message arrives.
        setProgress((prev) => (prev ? { ...prev, status: "stopped" as const } : prev));
        return;
      }
      setProgress((prev) => ({
        ...(prev || { phase: "done" as const, activeTasks: [], creatorsCompleted: 0, creatorsTotal: 0, creatorsScraped: 0, videosAnalyzed: 0, videosTotal: 0, log: [] }),
        status: "error" as const,
        errors: [err instanceof Error ? err.message : "Unknown error"],
      }));
    } finally {
      setRunning(false);
    }
  }, [running]);

  const runPipeline = useCallback((params: { configName: string; maxVideos: number; topK: number; nDays: number }) => {
    stream("/api/pipeline", params);
  }, [stream]);

  const runPipelineFromLinks = useCallback((params: { configName: string; links: string[] }) => {
    stream("/api/pipeline/links", params);
  }, [stream]);

  const stopPipeline = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return (
    <PipelineContext.Provider value={{ running, progress, runPipeline, runPipelineFromLinks, stopPipeline }}>
      {children}
    </PipelineContext.Provider>
  );
}

export function usePipeline() {
  const ctx = useContext(PipelineContext);
  if (!ctx) throw new Error("usePipeline must be used within PipelineProvider");
  return ctx;
}
