import { prisma } from '@/infrastructure/database/prisma';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Code2, FolderTree, Cpu, ArrowLeft, ArrowRight, MessageSquare, Terminal } from 'lucide-react';
import ChatInterface from '@/features/chat/ChatInterface';
import DeleteRepoButton from '@/features/repositories/DeleteRepoButton';

export const dynamic = 'force-dynamic';

export default async function RepositoryOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  
  const repository = await prisma.repository.findUnique({
    where: { id },
    include: {
      files: {
        select: { path: true }
      }
    }
  });

  if (!repository) {
    return notFound();
  }

  if (!repository.isIndexed) {
    redirect(`/repo/${id}/indexing`);
  }

  const filePaths = repository.files.map(f => f.path);
  const isTypeScript = filePaths.some(p => p.endsWith('.ts') || p.endsWith('.tsx'));
  const isReact = filePaths.some(p => p.endsWith('.tsx') || p.endsWith('.jsx'));
  const hasPrisma = filePaths.some(p => p.includes('schema.prisma'));
  const isNextJs = filePaths.some(p => p.includes('next.config'));

  const technologies = [
    isTypeScript && 'TypeScript',
    isReact && 'React',
    isNextJs && 'Next.js',
    hasPrisma && 'Prisma',
    'PostgreSQL'
  ].filter(Boolean) as string[];

  const folders = new Set<string>();
  filePaths.forEach(p => {
    const parts = p.split('/');
    if (parts.length > 1) folders.add(parts[0]);
  });
  const topFolders = Array.from(folders).slice(0, 8);

  const suggestedQuestions = [
    "Where is the main entry point of the application?",
    "How does authentication and authorization work?",
    "Where are the database models defined?",
    "How is routing configured?"
  ];

  return (
    <main className="min-h-screen p-8 md:p-16 max-w-6xl mx-auto flex flex-col gap-12">
      <header className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-muted hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </Link>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
            <span className="text-sm font-medium text-muted hidden sm:inline-block">Indexed & Ready</span>
          </div>
          <div className="w-px h-6 bg-border mx-1"></div>
          <DeleteRepoButton repositoryId={repository.id} />
        </div>
      </header>

      <section className="space-y-4">
        <div className="inline-flex items-center justify-center p-3 bg-accent rounded-xl border border-border mb-4">
          <Terminal className="w-6 h-6 text-foreground" />
        </div>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          {repository.name}
        </h1>
        <p className="text-lg text-muted max-w-2xl leading-relaxed">
          {repository.description || "An imported repository codebase ready for contextual search and exploration."}
        </p>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-8">
          
          <div className="grid grid-cols-2 gap-4">
            <div className="p-6 rounded-xl border border-border bg-background flex flex-col gap-3">
              <Cpu className="w-5 h-5 text-muted" />
              <h3 className="font-medium">Technologies</h3>
              <div className="flex flex-wrap gap-2 mt-auto">
                {technologies.length > 0 ? technologies.map(tech => (
                  <span key={tech} className="px-2.5 py-1 text-xs font-medium bg-accent border border-border rounded-md">
                    {tech}
                  </span>
                )) : (
                  <span className="text-muted text-sm">Various</span>
                )}
              </div>
            </div>

            <div className="p-6 rounded-xl border border-border bg-background flex flex-col gap-3">
              <FolderTree className="w-5 h-5 text-muted" />
              <h3 className="font-medium">Architecture</h3>
              <div className="flex flex-wrap gap-2 mt-auto">
                {topFolders.map(folder => (
                  <span key={folder} className="px-2.5 py-1 text-xs font-medium bg-accent border border-border rounded-md font-mono">
                    /{folder}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <ChatInterface 
            repositoryId={repository.id} 
            suggestedQuestions={suggestedQuestions} 
          />

        </div>

        <div className="space-y-6">
          <div className="p-6 rounded-xl border border-border bg-background">
            <h3 className="font-medium mb-4 flex items-center gap-2">
              <Code2 className="w-4 h-4 text-muted" /> Repository Stats
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center pb-3 border-b border-border/50">
                <span className="text-muted text-sm">Files Indexed</span>
                <span className="font-medium">{repository.fileCount}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-border/50">
                <span className="text-muted text-sm">Language</span>
                <span className="font-medium">TypeScript</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted text-sm">Status</span>
                <span className="font-medium text-green-500">Active</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}
