"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, Code2, Database, Search } from "lucide-react";

export default function IndexingPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);
  
  const [step, setStep] = useState(0);

  useEffect(() => {
    // Artificial step progression for visual feedback while polling
    const timer1 = setTimeout(() => setStep(1), 1500); // Files discovered
    const timer2 = setTimeout(() => setStep(2), 3500); // Code processed
    const timer3 = setTimeout(() => setStep(3), 6000); // Embeddings

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, []);

  useEffect(() => {
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/repo/${id}`);
        if (res.ok) {
          const data = await res.json();
          if (data.isIndexed) {
            clearInterval(pollInterval);
            router.push(`/repo/${id}`);
          }
        }
      } catch (e) {
        console.error("Polling error", e);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [id, router]);

  return (
    <main className="min-h-screen p-8 md:p-24 flex items-center justify-center bg-background">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center space-y-2">
          <Loader2 className="w-10 h-10 animate-spin text-muted mx-auto mb-6" />
          <h1 className="text-2xl font-semibold tracking-tight">Indexing Repository</h1>
          <p className="text-muted">This takes about 30 seconds for an average codebase.</p>
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
            icon={<Loader2 className="w-4 h-4 animate-spin" />} 
            text="Generating semantic embeddings" 
          />
        </div>
      </div>
    </main>
  );
}

function Step({ active, done, icon, text }: { active: boolean, done: boolean, icon: React.ReactNode, text: string }) {
  return (
    <div className={`flex items-center gap-4 transition-opacity duration-500 ${active ? 'opacity-100' : 'opacity-30'}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center
        ${done ? 'bg-green-500/10 text-green-500' : active ? 'bg-foreground text-background' : 'bg-muted text-accent'}`}
      >
        {done ? <CheckCircle2 className="w-5 h-5" /> : icon}
      </div>
      <span className={`font-medium ${done ? 'text-green-500' : active ? 'text-foreground' : 'text-muted'}`}>
        {text}
      </span>
    </div>
  );
}
