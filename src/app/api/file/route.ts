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

    const file = await prisma.file.findFirst({
      where: {
        repositoryId,
        path
      },
      select: { content: true }
    });

    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    return NextResponse.json({ content: file.content });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
