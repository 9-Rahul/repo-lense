export default function RepoLoading() {
  return (
    <main className="min-h-screen p-8 md:p-16 max-w-6xl mx-auto flex flex-col gap-12 animate-pulse">
      <header className="flex items-center justify-between">
        <div className="h-5 w-36 bg-accent rounded" />
        <div className="h-8 w-32 bg-accent rounded" />
      </header>
      <section className="space-y-4">
        <div className="w-12 h-12 bg-accent rounded-xl border border-border" />
        <div className="h-10 w-72 bg-accent rounded" />
        <div className="h-5 w-96 bg-accent rounded" />
      </section>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-8">
          <div className="grid grid-cols-2 gap-4">
            <div className="h-32 rounded-xl border border-border bg-accent/40" />
            <div className="h-32 rounded-xl border border-border bg-accent/40" />
          </div>
          <div className="h-[600px] rounded-xl border border-border bg-accent/20" />
        </div>
        <div className="h-48 rounded-xl border border-border bg-accent/40" />
      </div>
    </main>
  );
}

