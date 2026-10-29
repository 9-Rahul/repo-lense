"use client";

import { useState, useEffect } from "react";
import { ArrowRight, MessageSquare, Loader2, FileCode2, User, Bot } from "lucide-react";

type Message = { role: "user" | "assistant"; content: string; sources?: string[] };

// Client-side memory cache so re-opening any cited file is instantaneous (0ms)
const fileContentCache = new Map<string, string>();

export default function ChatInterface({
  repositoryId,
  suggestedQuestions,
}: {
  repositoryId: string;
  suggestedQuestions: string[];
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isTyping) return;

    const userMessage: Message = { role: "user", content: text };
    const updatedHistory = [...messages, userMessage];
    setMessages([
      ...updatedHistory,
      { role: "assistant", content: "", sources: [] },
    ]);
    setInput("");
    setIsTyping(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repositoryId,
          question: text,
          history: updatedHistory,
          stream: true,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Request failed (${res.status})`);
      }

      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream") && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamedText = "";
        let streamedSources: string[] = [];

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payloadStr = trimmed.slice(5).trim();
            if (!payloadStr) continue;

            const payload = JSON.parse(payloadStr);
            if (payload.error) {
              throw new Error(payload.error);
            }
            if (payload.sources) {
              streamedSources = payload.sources;
            }
            if (payload.token) {
              streamedText += payload.token;
            }

            setMessages([
              ...updatedHistory,
              {
                role: "assistant",
                content: streamedText,
                sources: streamedSources,
              },
            ]);
          }
        }
      } else {
        const data = await res.json();
        setMessages([
          ...updatedHistory,
          { role: "assistant", content: data.answer, sources: data.sources },
        ]);
      }
    } catch (err: any) {
      setMessages([
        ...updatedHistory,
        { role: "assistant", content: `Error: ${err.message}` },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex flex-col h-[600px] border border-border bg-background rounded-xl overflow-hidden shadow-sm relative">
      {selectedFile && (
        <FileViewerPanel
          repositoryId={repositoryId}
          path={selectedFile}
          onClose={() => setSelectedFile(null)}
        />
      )}

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-6 max-w-md mx-auto animate-in fade-in zoom-in-95">
            <MessageSquare className="w-10 h-10 text-muted opacity-50" />
            <div>
              <h3 className="text-xl font-medium text-foreground mb-2">Source-Backed Q&A</h3>
              <p className="text-muted leading-relaxed">
                Ask anything about this codebase. Answers are streamed in real time using RAG and strictly cite their source files.
              </p>
            </div>
            <div className="w-full space-y-3">
              {suggestedQuestions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q)}
                  className="w-full text-left p-4 rounded-xl border border-border bg-accent/50 hover:bg-accent transition-all text-sm font-medium"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className="space-y-3 animate-in slide-in-from-bottom-2 fade-in">
              <div className="flex items-start gap-3">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border border-border shadow-sm
                  ${msg.role === "user" ? "bg-foreground text-background" : "bg-accent text-foreground"}`}
                >
                  {msg.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>
                <div className="flex-1 space-y-4 pt-1 min-w-0">
                  {msg.content ? (
                    <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-accent prose-pre:border prose-pre:border-border whitespace-pre-wrap break-words">
                      {msg.content}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-muted animate-pulse">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>
                        {msg.sources && msg.sources.length > 0
                          ? "Synthesizing answer from matched files..."
                          : "Scanning vectors..."}
                      </span>
                    </div>
                  )}

                  {msg.sources && msg.sources.length > 0 && (
                    <div className="pt-3 border-t border-border/50">
                      <p className="text-xs font-medium text-muted mb-2 uppercase tracking-wider">
                        Referenced Files
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {msg.sources.map((src) => (
                          <button
                            key={src}
                            onClick={() => setSelectedFile(src)}
                            className="text-xs font-medium bg-background border border-border px-2 py-1.5 rounded flex items-center gap-1.5 hover:bg-accent transition-colors"
                          >
                            <FileCode2 className="w-3 h-3 text-muted" /> {src.split("/").pop()}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-4 border-t border-border bg-background">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage(input);
          }}
          className="relative"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isTyping}
            placeholder="Where is authentication handled?"
            className="w-full bg-accent border border-border rounded-xl pl-4 pr-12 py-4 text-foreground focus:outline-none focus:ring-2 focus:ring-muted shadow-sm transition-shadow disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isTyping}
            className="absolute right-2 top-2 p-2 bg-foreground text-background rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            {isTyping ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
          </button>
        </form>
      </div>
    </div>
  );
}

function FileViewerPanel({
  repositoryId,
  path,
  onClose,
}: {
  repositoryId: string;
  path: string;
  onClose: () => void;
}) {
  const cacheKey = `${repositoryId}:${path}`;
  const [content, setContent] = useState<string | null>(() => fileContentCache.get(cacheKey) ?? null);
  const [loading, setLoading] = useState<boolean>(() => !fileContentCache.has(cacheKey));

  useEffect(() => {
    const cached = fileContentCache.get(cacheKey);
    if (cached !== undefined) {
      setContent(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetch(`/api/file?repositoryId=${repositoryId}&path=${encodeURIComponent(path)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const fileText = data.content ?? "";
        fileContentCache.set(cacheKey, fileText);
        setContent(fileText);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [repositoryId, path, cacheKey]);

  return (
    <div className="absolute inset-y-0 right-0 w-full sm:w-3/4 md:w-2/3 bg-[#0a0a0a] border-l border-border z-20 flex flex-col animate-in slide-in-from-right shadow-2xl">
      <div className="flex items-center justify-between p-4 border-b border-border/50 bg-background/80 backdrop-blur-sm">
        <h3 className="font-medium flex items-center gap-2 truncate text-sm">
          <FileCode2 className="w-4 h-4 text-muted shrink-0" /> {path}
        </h3>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-border rounded-md text-muted transition-colors"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading source...
          </div>
        ) : (
          <pre className="text-xs font-mono text-muted whitespace-pre-wrap break-words">
            {content || "Empty file."}
          </pre>
        )}
      </div>
    </div>
  );
}
