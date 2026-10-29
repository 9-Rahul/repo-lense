import { NextResponse } from 'next/server';
import { prisma } from '@/infrastructure/database/prisma';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const repositoryId = searchParams.get('repositoryId');
    const path = searchParams.get('path');

    if (!repositoryId || !path) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // Use the composite unique index @@unique([repositoryId, path]) directly
    const file = await prisma.file.findUnique({
      where: {
        repositoryId_path: {
          repositoryId,
          path,
        },
      },
      select: { content: true },
    });

    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    return NextResponse.json(
      { content: file.content },
      {
        headers: {
          'Cache-Control': 'private, max-age=3600, stale-while-revalidate=86400',
        },
      }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
