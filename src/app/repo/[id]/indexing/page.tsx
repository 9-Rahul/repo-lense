"use client";

import { useEffect, useState, use, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, Code2, Database, Search, AlertCircle, RotateCcw, Clock } from "lucide-react";

interface ProgressInfo {
  status: "indexing" | "completed" | "failed";
  phase: "discovering" | "chunking" | "embedding" | "rate_limited" | "completed" | "failed";
  processedChunks: number;
  totalChunks: number;
  waitSeconds?: number;
  error?: string;
}

export default function IndexingPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);

  const [step, setStep] = useState(1);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const triggerIndexing = useCallback(async () => {
    setError(null);
    setRetrying(true);
    try {
      const res = await fetch("/api/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId: id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to index repository");
      }
    } catch (e: any) {
      setError(e.message || "Network error during indexing");
    } finally {
      setRetrying(false);
    }
  }, [id]);

  useEffect(() => {
    triggerIndexing();
    const timer1 = setTimeout(() => setStep((s) => Math.max(s, 2)), 1200);
    const timer2 = setTimeout(() => setStep((s) => Math.max(s, 3)), 2500);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [triggerIndexing]);

  useEffect(() => {
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/repo/${id}`);
        if (res.ok) {
          const data = await res.json();
          if (data.isIndexed) {
            clearInterval(pollInterval);
            router.push(`/repo/${id}`);
            return;
          }
          if (data.indexingProgress) {
            setProgress(data.indexingProgress);
            if (data.indexingProgress.status === "failed") {
              setError(data.indexingProgress.error || "Indexing failed");
            } else {
              setError(null);
              if (
                data.indexingProgress.phase === "embedding" ||
                data.indexingProgress.phase === "rate_limited"
              ) {
                setStep(3);
              }
            }
          }
        }
      } catch (e) {
        console.error("Polling error", e);
      }
    }, 1500);

    return () => clearInterval(pollInterval);
  }, [id, router]);

  const percent =
    progress && progress.totalChunks > 0
      ? Math.min(100, Math.round((progress.processedChunks / progress.totalChunks) * 100))
      : null;

  const isRateLimited = progress?.phase === "rate_limited" && !error;

  return (
    <main className="min-h-screen p-8 md:p-24 flex items-center justify-center bg-background">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center space-y-2">
          {error ? (
            <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-6" />
          ) : (
            <Loader2 className="w-10 h-10 animate-spin text-muted mx-auto mb-6" />
          )}
          <h1 className="text-2xl font-semibold tracking-tight">
            {error ? "Indexing Paused" : "Indexing Repository"}
          </h1>
          <p className="text-muted text-sm">
            {error
              ? "Click Retry below to resume from the last saved batch."
              : isRateLimited
              ? `Gemini Free Tier limit (100 chunks/min) reached — auto-resuming in ~${progress?.waitSeconds ?? 20}s...`
              : "Chunking code and generating semantic embeddings with Gemini."}
          </p>
        </div>

        <div className="bg-accent border border-border rounded-xl p-6 space-y-6 shadow-sm">
          <Step
            active={step >= 0}
            done={step > 0}
            icon={<Code2 className="w-4 h-4" />}
            text="Repository cloned successfully"
          />
          <Step
            active={step >= 1}
            done={step > 1}
            icon={<Search className="w-4 h-4" />}
            text="Discovering code files"
          />
          <Step
            active={step >= 2}
            done={step > 2}
            icon={<Database className="w-4 h-4" />}
            text="Chunking code context"
          />
          <Step
            active={step >= 3}
            done={false}
            icon={
              isRateLimited ? (
                <Clock className="w-4 h-4 text-yellow-400 animate-pulse" />
              ) : (
                <Loader2 className="w-4 h-4 animate-spin" />
              )
            }
            text={
              progress && progress.totalChunks > 0
                ? `Generating embeddings (${progress.processedChunks}/${progress.totalChunks} chunks)`
                : "Generating semantic embeddings"
            }
          />

          {percent !== null && !error && (
            <div className="pt-2 space-y-1.5">
              <div className="flex justify-between text-xs text-muted">
                <span>
                  {isRateLimited
                    ? `Waiting ~${progress?.waitSeconds ?? 20}s for Free Tier quota reset...`
                    : "Vector Indexing Progress"}
                </span>
                <span>{percent}%</span>
              </div>
              <div className="w-full h-2 bg-background rounded-full overflow-hidden border border-border">
                <div
                  className={`h-full transition-all duration-300 ${
                    isRateLimited ? "bg-yellow-500" : "bg-green-500"
                  }`}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="pt-3 border-t border-border space-y-3">
              <p className="text-xs text-red-400 break-words leading-relaxed">{error}</p>
              <button
                onClick={triggerIndexing}
                disabled={retrying}
                className="w-full py-2.5 px-4 bg-foreground text-background rounded-lg font-medium text-sm flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                {retrying ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RotateCcw className="w-4 h-4" />
                )}
                Resume Indexing
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function Step({
  active,
  done,
  icon,
  text,
}: {
  active: boolean;
  done: boolean;
  icon: React.ReactNode;
  text: string;
}) {
  return (
    <div
      className={`flex items-center gap-4 transition-opacity duration-500 ${
        active ? "opacity-100" : "opacity-30"
      }`}
    >
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0
        ${
          done
            ? "bg-green-500/10 text-green-500"
            : active
            ? "bg-foreground text-background"
            : "bg-muted text-accent"
        }`}
      >
        {done ? <CheckCircle2 className="w-5 h-5" /> : icon}
      </div>
      <span
        className={`font-medium text-sm ${
          done ? "text-green-500" : active ? "text-foreground" : "text-muted"
        }`}
      >
        {text}
      </span>
    </div>
  );
}
