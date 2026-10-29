"use client";

import { useState, useEffect } from "react";
import { Plus, GitPullRequest, Loader2, AlertCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";

export default function ImportModal({ variant = "default" }: { variant?: "default" | "large" }) {
  const [isOpen, setIsOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isLoading) {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isLoading]);

  const handleOpen = () => {
    setError(null);
    setIsOpen(true);
  };

  const handleClose = () => {
    if (isLoading) return;
    setIsOpen(false);
    setError(null);
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = url.trim();

    if (!cleanUrl.includes("github.com")) {
      setError("Please enter a valid GitHub repository URL.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: cleanUrl }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Failed to import repository.");
      }

      setIsOpen(false);

      // Trigger background indexing and navigate to the indexing view
      fetch("/api/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId: data.repository.id }),
      }).catch((e) => console.warn("Background indexing trigger:", e));

      router.push(`/repo/${data.repository.id}/indexing`);
    } catch (err: any) {
      setError(err.message || "Unable to import repository. Please verify the URL is public and accessible.");
      setIsLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={handleOpen}
        className={`flex items-center gap-2 font-medium transition-colors border border-border shadow-sm
          ${
            variant === "large"
              ? "px-6 py-3 bg-foreground text-background rounded-full hover:bg-gray-200"
              : "px-4 py-2 bg-accent text-foreground rounded-lg hover:bg-[#333]"
          }`}
      >
        <Plus className={variant === "large" ? "w-5 h-5" : "w-4 h-4"} />
        Import Repository
      </button>

      {isOpen && (
        <div
          onClick={handleClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-background border border-border rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in zoom-in-95 duration-150 relative text-left"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold flex items-center gap-2 text-foreground">
                <GitPullRequest className="w-5 h-5 text-muted" /> Import GitHub Repo
              </h2>
              <button
                onClick={handleClose}
                disabled={isLoading}
                className="text-muted hover:text-foreground transition-colors p-1 rounded-md disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleImport} className="space-y-4">
              <div>
                <label className="block text-sm text-muted mb-2 font-medium">Repository URL</label>
                <input
                  autoFocus
                  type="url"
                  placeholder="https://github.com/owner/project"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    if (error) setError(null);
                  }}
                  disabled={isLoading}
                  className="w-full bg-accent border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-muted transition-shadow disabled:opacity-50 text-sm"
                  required
                />
              </div>

              {error && (
                <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-start gap-2.5 animate-in fade-in duration-150">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading || !url.trim()}
                className="w-full bg-foreground text-background font-medium rounded-xl px-4 py-3 flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm shadow-sm"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Fetching &amp; downloading repository...
                  </>
                ) : (
                  "Start Import"
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
