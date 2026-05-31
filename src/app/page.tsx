import { prisma } from '@/infrastructure/database/prisma';
import Link from 'next/link';
import { GitPullRequest, ArrowRight, Code2 } from 'lucide-react';
import ImportModal from '@/features/repositories/ImportModal';
import DeleteRepoButton from '@/features/repositories/DeleteRepoButton';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const repositories = await prisma.repository.findMany({
    orderBy: { createdAt: 'desc' }
  });

  return (
    <main className="min-h-screen p-8 md:p-24 max-w-5xl mx-auto flex flex-col">
      <div className="flex items-center justify-between mb-16">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
          <Code2 className="w-6 h-6 text-muted" />
          RepoLens
        </h1>
        {repositories.length > 0 && <ImportModal />}
      </div>

      {repositories.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-8 mt-12">
          <div className="w-16 h-16 bg-accent rounded-2xl flex items-center justify-center border border-border shadow-xl">
            <GitPullRequest className="w-8 h-8 text-foreground" />
          </div>
          <div className="space-y-4">
            <h2 className="text-4xl font-medium tracking-tight text-foreground">
              Understand any codebase.
            </h2>
            <p className="text-muted text-lg max-w-md mx-auto leading-relaxed">
              Import a repository and understand how it works instantly through AI-powered contextual search.
            </p>
          </div>
          <ImportModal variant="large" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {repositories.map(repo => (
            <Link 
              key={repo.id} 
              href={repo.isIndexed ? `/repo/${repo.id}` : `/repo/${repo.id}/indexing`}
              className="p-6 rounded-xl border border-border bg-background hover:bg-accent hover:border-muted transition-all group flex flex-col shadow-sm"
            >
              <div className="flex items-start justify-between mb-6 gap-2">
                <h3 className="font-medium text-lg text-foreground truncate max-w-[85%]">{repo.name}</h3>
                <div className="flex items-center gap-1">
                  <DeleteRepoButton repositoryId={repo.id} />
                  <ArrowRight className="w-4 h-4 text-muted group-hover:text-foreground transition-colors ml-1" />
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted mt-auto">
                <span className="flex items-center gap-1.5 bg-accent px-2.5 py-1 rounded-md border border-border">
                  <div className={`w-2 h-2 rounded-full ${repo.isIndexed ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
                  {repo.isIndexed ? 'Ready' : 'Indexing'}
                </span>
                <span className="flex items-center gap-1">
                  <Code2 className="w-3.5 h-3.5" />
                  {repo.fileCount} files
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
