"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Play, Loader2, CheckCircle2, XCircle, Terminal, Zap, ChevronDown, ArrowRight, Film, AlertTriangle, Users, Link2, Square } from "lucide-react";
import { usePipeline } from "@/context/pipeline-context";
import type { Config } from "@/lib/types";

function formatViews(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toString();
}

const LINK_SOFT_LIMIT = 20;

export default function RunPage() {
  const [mode, setMode] = useState<"creators" | "links">("creators");
  const [configs, setConfigs] = useState<Config[]>([]);
  const [selectedConfig, setSelectedConfig] = useState("");
  const [maxVideos, setMaxVideos] = useState(20);
  const [topK, setTopK] = useState(3);
  const [nDays, setNDays] = useState(30);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [linksText, setLinksText] = useState("");
  const [stopRequested, setStopRequested] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const { running, progress, runPipeline, runPipelineFromLinks, stopPipeline } = usePipeline();

  useEffect(() => {
    fetch("/api/configs").then((r) => r.json()).then(setConfigs);
  }, []);

  // Reset once a run actually finishes (completed/stopped/error) so the
  // button is back to its normal "Stop" state for the next run.
  useEffect(() => {
    if (!running) setStopRequested(false);
  }, [running]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [progress?.log.length]);

  const links = [...new Set(linksText.split("\n").map((l) => l.trim()).filter(Boolean))];

  const handleRun = () => {
    if (!selectedConfig) return;
    if (mode === "creators") {
      runPipeline({ configName: selectedConfig, maxVideos, topK, nDays });
    } else {
      if (links.length === 0) return;
      runPipelineFromLinks({ configName: selectedConfig, links });
    }
  };

  const handleStop = () => {
    setStopRequested(true);
    stopPipeline();
  };

  const totalProgress = progress
    ? progress.phase === "scraping"
      ? progress.creatorsTotal > 0 ? (progress.creatorsScraped / progress.creatorsTotal) * 40 : 0
      : progress.videosTotal > 0 ? 40 + (progress.videosAnalyzed / progress.videosTotal) * 60 : 40
    : 0;

  const runDisabled = running || !selectedConfig || (mode === "links" && links.length === 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Run Pipeline</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Analyze competitor content and generate new video concepts
        </p>
      </div>

      {/* Config Form */}
      <div className="glass rounded-2xl p-6 space-y-6">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-purple-400" />
          <h2 className="text-sm font-semibold">Pipeline Configuration</h2>
        </div>

        <Tabs value={mode} onValueChange={(v) => setMode(v as "creators" | "links")}>
          <TabsList>
            <TabsTrigger value="creators" className="gap-1.5">
              <Users className="h-3.5 w-3.5" />
              By Creators
            </TabsTrigger>
            <TabsTrigger value="links" className="gap-1.5">
              <Link2 className="h-3.5 w-3.5" />
              By Links
            </TabsTrigger>
          </TabsList>

          <div className="space-y-4 mt-4">
            <div>
              <Label className="text-xs text-muted-foreground">Config</Label>
              <Select value={selectedConfig} onValueChange={setSelectedConfig}>
                <SelectTrigger className="mt-1.5 rounded-xl glass border-white/[0.08] h-11">
                  <SelectValue placeholder="Select a config..." />
                </SelectTrigger>
                <SelectContent>
                  {configs.map((c) => (
                    <SelectItem key={c.id} value={c.configName}>{c.configName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <TabsContent value="creators" className="space-y-4 mt-0">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${showAdvanced ? "rotate-180" : ""}`} />
                Advanced settings
              </button>

              {showAdvanced && (
                <div className="grid gap-4 md:grid-cols-3 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div>
                    <Label className="text-xs text-muted-foreground">Max Videos per Creator</Label>
                    <Input
                      type="number"
                      value={maxVideos}
                      onChange={(e) => setMaxVideos(Number(e.target.value))}
                      min={1}
                      max={100}
                      className="mt-1.5 rounded-xl glass border-white/[0.08] h-11"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Top K to Analyze</Label>
                    <Input
                      type="number"
                      value={topK}
                      onChange={(e) => setTopK(Number(e.target.value))}
                      min={1}
                      max={10}
                      className="mt-1.5 rounded-xl glass border-white/[0.08] h-11"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Days Lookback</Label>
                    <Input
                      type="number"
                      value={nDays}
                      onChange={(e) => setNDays(Number(e.target.value))}
                      min={1}
                      max={365}
                      className="mt-1.5 rounded-xl glass border-white/[0.08] h-11"
                    />
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="links" className="space-y-2 mt-0">
              <Label className="text-xs text-muted-foreground">Instagram Reel Links (one per line)</Label>
              <Textarea
                value={linksText}
                onChange={(e) => setLinksText(e.target.value)}
                placeholder={"https://www.instagram.com/reel/xxxxxxx/\nhttps://www.instagram.com/reel/yyyyyyy/\n..."}
                className="min-h-[160px] rounded-xl glass border-white/[0.08] font-mono text-xs"
              />
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">
                  {links.length} link{links.length === 1 ? "" : "s"} detected
                </span>
                {links.length > LINK_SOFT_LIMIT && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-amber-400">
                    <AlertTriangle className="h-3 w-3" />
                    Large batches may exceed the 5-minute run limit
                  </span>
                )}
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <div className="flex gap-3">
          <Button
            onClick={handleRun}
            disabled={runDisabled}
            size="lg"
            className="flex-1 rounded-xl h-12 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 border-0 glow-sm transition-all duration-300 hover:glow text-sm font-semibold"
          >
            {running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Running Pipeline...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Run Pipeline
              </>
            )}
          </Button>

          {running && (
            <Button
              onClick={handleStop}
              disabled={stopRequested}
              size="lg"
              variant="ghost"
              className="rounded-xl h-12 px-5 glass border-white/[0.08] text-red-400 hover:text-red-300 hover:bg-red-500/10 font-semibold shrink-0"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              {stopRequested ? "Stopping..." : "Stop"}
            </Button>
          )}
        </div>
      </div>

      {/* Progress */}
      {progress && (
        <div className="space-y-4">
          {/* Status card */}
          <div className="glass rounded-2xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {progress.status === "running" && <Loader2 className="h-4 w-4 text-purple-400 animate-spin" />}
                {progress.status === "completed" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                {progress.status === "error" && <XCircle className="h-4 w-4 text-red-400" />}
                {progress.status === "stopped" && <Square className="h-3.5 w-3.5 text-amber-400 fill-current" />}
                <h2 className="text-sm font-semibold">
                  {progress.status === "running" && progress.phase === "scraping" && "Scraping..."}
                  {progress.status === "running" && progress.phase === "analyzing" && "Analyzing videos..."}
                  {progress.status === "completed" && "Pipeline complete"}
                  {progress.status === "error" && "Pipeline failed"}
                  {progress.status === "stopped" && "Pipeline stopped"}
                </h2>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {progress.phase === "scraping" && (
                  <span>Creators: <span className="text-foreground">{progress.creatorsScraped}/{progress.creatorsTotal}</span></span>
                )}
                {(progress.phase === "analyzing" || progress.phase === "done") && (
                  <span>Videos: <span className="text-foreground">{progress.videosAnalyzed}/{progress.videosTotal}</span></span>
                )}
                {progress.errors.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-red-400">
                    <AlertTriangle className="h-3 w-3" />
                    {progress.errors.length}
                  </span>
                )}
              </div>
            </div>

            {/* Progress bar */}
            <div>
              <div className="h-2 rounded-full bg-white/[0.05] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    progress.status === "completed"
                      ? "bg-gradient-to-r from-emerald-500 to-teal-500"
                      : progress.status === "error"
                      ? "bg-gradient-to-r from-red-500 to-orange-500"
                      : progress.status === "stopped"
                      ? "bg-gradient-to-r from-amber-500 to-orange-400"
                      : "bg-gradient-to-r from-purple-500 to-indigo-500"
                  }`}
                  style={{ width: `${progress.status === "completed" ? 100 : totalProgress}%` }}
                />
              </div>
            </div>

            {/* Active tasks */}
            {progress.activeTasks.length > 0 && (
              <div className="space-y-2">
                {progress.activeTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/[0.04] px-3 py-2"
                  >
                    <Loader2 className="h-3 w-3 text-purple-400 animate-spin shrink-0" />
                    <span className="text-xs font-medium text-foreground/80">@{task.creator}</span>
                    <span className="text-[11px] text-muted-foreground">{task.step}</span>
                    {task.views && (
                      <span className="ml-auto text-[11px] text-muted-foreground/60">
                        {formatViews(task.views)} views
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Completion CTA — shown after a full run or a stop, since a
                stop still keeps whatever was already analyzed and saved */}
            {(progress.status === "completed" || progress.status === "stopped") && progress.videosAnalyzed > 0 && (
              <Button asChild className="w-full rounded-xl h-11 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 border-0 font-semibold gap-2">
                <Link href="/videos">
                  <Film className="h-4 w-4" />
                  View {progress.videosAnalyzed} New Videos
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            )}

            {/* Errors summary */}
            {progress.errors.length > 0 && (
              <div className="rounded-xl bg-red-500/5 border border-red-500/10 p-3 space-y-1">
                <p className="text-[11px] font-medium text-red-400">Errors ({progress.errors.length})</p>
                {progress.errors.map((err, i) => (
                  <p key={i} className="text-[11px] text-red-400/70 leading-relaxed">{err}</p>
                ))}
              </div>
            )}
          </div>

          {/* Log — collapsible */}
          <details className="glass rounded-2xl overflow-hidden">
            <summary className="p-4 flex items-center gap-2 cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
              <Terminal className="h-4 w-4" />
              <span className="font-medium">Log</span>
              <Badge variant="secondary" className="ml-auto rounded-md text-[10px] bg-white/[0.05] border border-white/[0.06]">
                {progress.log.length} entries
              </Badge>
            </summary>
            <div className="border-t border-white/[0.06]">
              <ScrollArea className="h-[300px] p-4">
                <div className="space-y-0.5 font-mono text-[11px]">
                  {progress.log.map((line, i) => (
                    <div
                      key={i}
                      className={`leading-5 ${
                        line.includes("Error") || line.includes("error")
                          ? "text-red-400"
                          : line.includes("stopped") || line.includes("Stop requested")
                          ? "text-amber-400/80"
                          : line.includes("done") || line.includes("complete") || line.includes("Complete")
                          ? "text-emerald-400/80"
                          : "text-muted-foreground"
                      }`}
                    >
                      {line}
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </ScrollArea>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
