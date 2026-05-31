import { NextResponse } from 'next/server';
import { prisma } from '@/infrastructure/database/prisma';
import { cloneAndReadRepo } from '@/infrastructure/github/cloner';

export async function POST(req: Request) {
  let repository: any = null;
  try {
    const { url } = await req.json();

    if (!url || !url.startsWith('https://github.com/')) {
      return NextResponse.json({ error: 'Invalid GitHub URL' }, { status: 400 });
    }

    // Extract owner/repo name
    const urlParts = url.replace('https://github.com/', '').split('/');
    if (urlParts.length < 2) {
      return NextResponse.json({ error: 'Invalid GitHub URL format' }, { status: 400 });
    }
    const name = `${urlParts[0]}/${urlParts[1].replace('.git', '')}`;

    // Check if repo already exists
    repository = await prisma.repository.findUnique({
      where: { url }
    });

    if (repository) {
      return NextResponse.json({ message: 'Repository already imported', repository });
    }

    // Check Repository Size via GitHub API to prevent Vercel /tmp DoS (Max 200MB)
    const githubApiResponse = await fetch(`https://api.github.com/repos/${name}`);
    if (githubApiResponse.ok) {
      const repoData = await githubApiResponse.json();
      // repoData.size is in KB. 200MB = 204,800 KB
      if (repoData.size > 204800) {
        return NextResponse.json({ error: `Repository is too large (${Math.round(repoData.size / 1024)}MB). Maximum size is 200MB.` }, { status: 413 });
      }
    } else if (githubApiResponse.status === 404) {
        return NextResponse.json({ error: 'Repository not found or is private.' }, { status: 404 });
    }

    // 1. Create Repo in DB (pending state)
    repository = await prisma.repository.create({
      data: {
        url,
        name,
        isIndexed: false,
      }
    });

    // 2. Clone and Read files
    const files = await cloneAndReadRepo(url);

    // 3. Save files to database
    const fileInserts = files.map(file => ({
      repositoryId: repository!.id,
      path: file.path,
      content: file.content
    }));

    // Batch insert files in chunks to prevent PostgreSQL parameter limits (65,535 max)
    const CHUNK_SIZE = 1000;
    for (let i = 0; i < fileInserts.length; i += CHUNK_SIZE) {
      await prisma.file.createMany({
        data: fileInserts.slice(i, i + CHUNK_SIZE),
        skipDuplicates: true
      });
    }

    // 4. Update file count
    repository = await prisma.repository.update({
      where: { id: repository.id },
      data: { fileCount: files.length }
    });

    // Note: Embeddings and Chunking will be triggered from here next!
    
    return NextResponse.json({ 
      message: 'Repository cloned and files stored successfully',
      repository
    });

  } catch (error: any) {
    console.error('Import error:', error);
    
    // Clean up database if we created the repository record but cloning/storing failed
    if (repository && repository.id) {
      try {
        await prisma.repository.delete({
          where: { id: repository.id }
        });
      } catch (dbError) {
        console.error('Failed to clean up repository record after error:', dbError);
      }
    }
    
    return NextResponse.json({ error: error.message || 'Failed to import repository' }, { status: 500 });
  }
}
