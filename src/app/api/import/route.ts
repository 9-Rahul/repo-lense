import { NextResponse } from 'next/server';
import { prisma } from '@/infrastructure/database/prisma';
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
    } catch (e) {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    const name = url.replace('https://github.com/', '');
    const repoIdentifier = name.split('/tree/')[0];

    repository = await prisma.repository.findUnique({
      where: { url }
    });

    if (repository) {
      return NextResponse.json({ message: 'Repository already imported', repository });
    }

    // limit to 200MB to avoid disk/timeout issues
    const githubApiResponse = await fetch(`https://api.github.com/repos/${repoIdentifier}`);
    if (githubApiResponse.ok) {
      const repoData = await githubApiResponse.json();
      if (repoData.size > 204800) {
        return NextResponse.json({ error: `Repository is too large (${Math.round(repoData.size / 1024)}MB). Maximum size is 200MB.` }, { status: 413 });
      }
    } else if (githubApiResponse.status === 404) {
      return NextResponse.json({ error: 'Repository not found or is private.' }, { status: 404 });
    }

    repository = await prisma.repository.create({
      data: {
        url,
        name,
        isIndexed: false,
      }
    });

    const files = await cloneAndReadRepo(url);

    const fileInserts = files.map(file => ({
      repositoryId: repository!.id,
      path: file.path,
      content: file.content
    }));

    // batch inserts to stay under postgres parameter limits
    const CHUNK_SIZE = 1000;
    for (let i = 0; i < fileInserts.length; i += CHUNK_SIZE) {
      await prisma.file.createMany({
        data: fileInserts.slice(i, i + CHUNK_SIZE),
        skipDuplicates: true
      });
    }

    repository = await prisma.repository.update({
      where: { id: repository.id },
      data: { fileCount: files.length }
    });

    return NextResponse.json({
      message: 'Repository cloned and files stored successfully',
      repository
    });

  } catch (error: any) {
    console.error('Import error:', error);

    // clean up partial db record if cloning failed
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
