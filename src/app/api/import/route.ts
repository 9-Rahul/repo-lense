import { NextResponse } from 'next/server';
import { prisma } from '@/infrastructure/database/prisma';
import { cloneAndReadRepo, fetchFromGitHub, RepoImportError } from '@/infrastructure/github/cloner';

export async function POST(req: Request) {
  let repository: any = null;
  try {
    let { url } = await req.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'Please enter a valid repository URL.' },
        { status: 400 }
      );
    }

    url = url.trim();

    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.hostname !== 'github.com') {
        return NextResponse.json(
          { error: 'Only GitHub repositories are supported (e.g. https://github.com/owner/repo).' },
          { status: 400 }
        );
      }

      const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
      if (pathParts.length < 2) {
        return NextResponse.json(
          { error: 'Invalid GitHub URL format. Please use https://github.com/owner/repository.' },
          { status: 400 }
        );
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
      return NextResponse.json(
        { error: 'Invalid URL format. Please check the repository link.' },
        { status: 400 }
      );
    }

    const name = url.replace('https://github.com/', '');
    const repoIdentifier = name.split('/tree/')[0];

    repository = await prisma.repository.findUnique({
      where: { url },
    });

    if (repository) {
      return NextResponse.json({ message: 'Repository already imported', repository });
    }

    // Limit repo size (default 30MB for Free Tier efficiency, configurable via MAX_REPO_SIZE_MB)
    const maxRepoSizeMb = Number(process.env.MAX_REPO_SIZE_MB || 30);
    const maxRepoSizeKb = maxRepoSizeMb * 1024;

    let description: string | null = null;
    let detectedLanguage: string | null = null;

    const githubApiResponse = await fetchFromGitHub(`https://api.github.com/repos/${repoIdentifier}`);
    if (githubApiResponse.ok) {
      const repoData = await githubApiResponse.json();
      if (repoData.size > maxRepoSizeKb) {
        return NextResponse.json(
          {
            error: `Repository is too large (${Math.round(
              repoData.size / 1024
            )}MB). Maximum allowed size is ${maxRepoSizeMb}MB.`,
          },
          { status: 413 }
        );
      }
      description = repoData.description ?? null;
      detectedLanguage = repoData.language ?? null;
    } else if (githubApiResponse.status === 404) {
      return NextResponse.json(
        { error: 'Repository not found or is private. Please verify the URL and ensure the repo is public.' },
        { status: 404 }
      );
    } else if (githubApiResponse.status === 403) {
      return NextResponse.json(
        { error: 'GitHub API rate limit reached. Please wait a few minutes before trying again.' },
        { status: 429 }
      );
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

    if (files.length === 0) {
      throw new RepoImportError(
        'No indexable source code files (.ts, .js, .tsx, .jsx, etc.) were found in this repository.',
        400
      );
    }

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

    // Batch inserts in safe sequential chunks (50 files per batch)
    // to avoid socket payload exhaustion or connection drops over remote Supabase poolers
    const CHUNK_SIZE = 50;
    for (let i = 0; i < fileInserts.length; i += CHUNK_SIZE) {
      const batch = fileInserts.slice(i, i + CHUNK_SIZE);
      let inserted = false;
      for (let attempt = 1; attempt <= 2 && !inserted; attempt++) {
        try {
          await prisma.file.createMany({
            data: batch,
            skipDuplicates: true,
          });
          inserted = true;
        } catch (insertErr: any) {
          if (attempt === 2) throw insertErr;
          console.warn(`[Import API] Batch ${Math.floor(i / CHUNK_SIZE) + 1} insert retry after connection reset...`);
          await new Promise((r) => setTimeout(r, 600));
        }
      }
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
    // Log complete internal error for server monitoring / Vercel runtime logs
    console.error('[Import API] Detailed error:', error);

    // Clean up partial db record if cloning failed
    if (repository && repository.id) {
      try {
        await prisma.repository.delete({
          where: { id: repository.id },
        });
      } catch (dbError) {
        console.error('[Import API] Failed to clean up repository record after error:', dbError);
      }
    }

    // Security practice (CWE-209): Never expose raw shell output, stack traces,
    // or internal system paths to the client.
    if (error instanceof RepoImportError) {
      return NextResponse.json(
        { error: error.userMessage },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { error: 'Failed to import repository. Please verify the repository is public and accessible.' },
      { status: 500 }
    );
  }
}
