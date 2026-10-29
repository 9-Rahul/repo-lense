import { Code2 } from 'lucide-react';

export default function DashboardLoading() {
  return (
    <main className="min-h-screen p-8 md:p-24 max-w-5xl mx-auto flex flex-col animate-pulse">
      <div className="flex items-center justify-between mb-16">
        <div className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
          <Code2 className="w-6 h-6 text-muted" />
          RepoLens
        </div>
        <div className="h-10 w-40 bg-accent rounded-lg border border-border" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="p-6 rounded-xl border border-border bg-background h-36 flex flex-col justify-between">
            <div className="h-6 w-2/3 bg-accent rounded" />
            <div className="flex gap-3">
              <div className="h-6 w-20 bg-accent rounded" />
              <div className="h-6 w-16 bg-accent rounded" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

