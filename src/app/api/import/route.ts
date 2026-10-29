import { NextResponse } from 'next/server';
import { prisma, ensureVectorIndexes } from '@/infrastructure/database/prisma';
import { cloneAndReadRepo } from '@/infrastructure/github/cloner';

export async function POST(req: Request) {
  let repository: any = null;
  try {
    let { url } = await req.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'Invalid URL provided' }, { status: 400 });
    }

    url = url.trim();

    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.hostname !== 'github.com') {
        return NextResponse.json({ error: 'Only GitHub URLs are supported' }, { status: 400 });
      }

      const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
      if (pathParts.length < 2) {
        return NextResponse.json({ error: 'Invalid GitHub URL format' }, { status: 400 });
      }

      const owner = pathParts[0];
      const repo = pathParts[1].replace(/\.git$/, '');
      let name = `${owner}/${repo}`;

      if (pathParts.length >= 4 && pathParts[2] === 'tree') {
        const branch = pathParts.slice(3).join('/');
        name = `${owner}/${repo}/tree/${branch}`;
      }

      url = `https://github.com/${name}`;
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    const name = url.replace('https://github.com/', '');
    const repoIdentifier = name.split('/tree/')[0];

    repository = await prisma.repository.findUnique({
      where: { url },
    });

    if (repository) {
      return NextResponse.json({ message: 'Repository already imported', repository });
    }

    // Ensure pgvector HNSW and FK indexes exist in background
    ensureVectorIndexes().catch(() => {});

    // Check repo size (<200MB) via GitHub API
    const ghHeaders: Record<string, string> = {
      'User-Agent': 'RepoLense-Importer',
    };
    if (process.env.GITHUB_TOKEN) {
      ghHeaders['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    let description: string | null = null;
    let detectedLanguage: string | null = null;

    // Limit repo size (default 30MB for Free Tier efficiency, configurable via MAX_REPO_SIZE_MB)
    const maxRepoSizeMb = Number(process.env.MAX_REPO_SIZE_MB || 30);
    const maxRepoSizeKb = maxRepoSizeMb * 1024;

    const githubApiResponse = await fetch(`https://api.github.com/repos/${repoIdentifier}`, {
      headers: ghHeaders,
    });
    if (githubApiResponse.ok) {
      const repoData = await githubApiResponse.json();
      if (repoData.size > maxRepoSizeKb) {
        return NextResponse.json(
          {
            error: `Repository is too large (${Math.round(
              repoData.size / 1024
            )}MB). Maximum size is ${maxRepoSizeMb}MB to stay within Gemini Free Tier limits.`,
          },
          { status: 413 }
        );
      }
      description = repoData.description ?? null;
      detectedLanguage = repoData.language ?? null;
    } else if (githubApiResponse.status === 404) {
      return NextResponse.json({ error: 'Repository not found or is private.' }, { status: 404 });
    }

    repository = await prisma.repository.create({
      data: {
        url,
        name,
        description,
        language: detectedLanguage,
        isIndexed: false,
      },
    });

    const files = await cloneAndReadRepo(url);

    // Infer language & framework from file tree if not set
    const filePaths = files.map((f) => f.path);
    const hasTs = filePaths.some((p) => p.endsWith('.ts') || p.endsWith('.tsx'));
    const hasNext = filePaths.some((p) => p.includes('next.config'));
    const hasReact = filePaths.some((p) => p.endsWith('.tsx') || p.endsWith('.jsx'));

    const language = detectedLanguage || (hasTs ? 'TypeScript' : 'JavaScript');
    const framework = hasNext ? 'Next.js' : hasReact ? 'React' : null;

    const fileInserts = files.map((file) => ({
      repositoryId: repository!.id,
      path: file.path,
      content: file.content,
    }));

    // Batch inserts in moderate chunks (250 files per batch, 2 concurrent batches)
    // to avoid oversized SQL packets over remote Postgres connections
    const CHUNK_SIZE = 250;
    const CONCURRENCY = 2;
    const batches: typeof fileInserts[] = [];
    for (let i = 0; i < fileInserts.length; i += CHUNK_SIZE) {
      batches.push(fileInserts.slice(i, i + CHUNK_SIZE));
    }

    for (let i = 0; i < batches.length; i += CONCURRENCY) {
      const slice = batches.slice(i, i + CONCURRENCY);
      await Promise.all(
        slice.map((batch) =>
          prisma.file.createMany({
            data: batch,
            skipDuplicates: true,
          })
        )
      );
    }

    repository = await prisma.repository.update({
      where: { id: repository.id },
      data: {
        fileCount: files.length,
        language,
        framework,
      },
    });

    return NextResponse.json({
      message: 'Repository cloned and files stored successfully',
      repository,
    });
  } catch (error: any) {
    console.error('Import error:', error);

    // clean up partial db record if cloning failed
    if (repository && repository.id) {
      try {
        await prisma.repository.delete({
          where: { id: repository.id },
        });
      } catch (dbError) {
        console.error('Failed to clean up repository record after error:', dbError);
      }
    }

    return NextResponse.json({ error: error.message || 'Failed to import repository' }, { status: 500 });
  }
}
