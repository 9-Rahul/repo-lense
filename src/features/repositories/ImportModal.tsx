"use client";

import { useState } from "react";
import { Plus, GitPullRequest, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

export default function ImportModal({ variant = "default" }: { variant?: "default" | "large" }) {
  const [isOpen, setIsOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.includes("github.com")) {
      setError("Please enter a valid GitHub URL");
      return;
    }
    
    setIsLoading(true);
    setError("");

    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to import");

      setIsOpen(false);
      // Kick off indexing asynchronously in the background
      fetch("/api/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId: data.repository.id }),
      });

      router.push(`/repo/${data.repository.id}/indexing`);
    } catch (err: any) {
      setError(err.message);
      setIsLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`flex items-center gap-2 font-medium transition-colors border border-border shadow-sm
          ${variant === "large" 
            ? "px-6 py-3 bg-foreground text-background rounded-full hover:bg-gray-200" 
            : "px-4 py-2 bg-accent text-foreground rounded-lg hover:bg-[#333]"}`}
      >
        <Plus className={variant === "large" ? "w-5 h-5" : "w-4 h-4"} />
        Import Repository
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-background border border-border rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <GitPullRequest className="w-5 h-5" /> Import GitHub Repo
              </h2>
              <button 
                onClick={() => setIsOpen(false)}
                className="text-muted hover:text-foreground transition-colors p-1"
              >
                ✕
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
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full bg-accent border border-border rounded-lg px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-muted transition-shadow"
                  required
                />
              </div>

              {error && <p className="text-red-400 text-sm">{error}</p>}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-foreground text-background font-medium rounded-lg px-4 py-3 flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Cloning Repository...
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
