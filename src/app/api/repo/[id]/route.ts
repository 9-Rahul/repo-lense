import { NextResponse } from 'next/server';
import { prisma } from '@/infrastructure/database/prisma';
import { getIndexingProgress, clearIndexingProgress } from '@/features/indexing/embedder';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Repository ID is required' }, { status: 400 });
    }

    clearIndexingProgress(id);

    await prisma.repository.delete({
      where: { id },
    });

    return NextResponse.json({ message: 'Repository deleted successfully' });
  } catch (error: any) {
    console.error('Delete repo error:', error);
    return NextResponse.json({ error: error.message || 'Failed to delete repository' }, { status: 500 });
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Repository ID is required' }, { status: 400 });
    }

    const repository = await prisma.repository.findUnique({
      where: { id },
      select: {
        id: true,
        url: true,
        name: true,
        description: true,
        language: true,
        framework: true,
        fileCount: true,
        isIndexed: true,
        createdAt: true,
      },
    });

    if (!repository) {
      return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
    }

    const progress = getIndexingProgress(id);

    return NextResponse.json({
      ...repository,
      indexingProgress: progress,
    });
  } catch (error: any) {
    console.error('Get repo error:', error);
    return NextResponse.json({ error: error.message || 'Failed to get repository' }, { status: 500 });
  }
}
