import { NextResponse } from 'next/server';
import { prisma } from '@/infrastructure/database/prisma';
import { getIndexingProgress, clearIndexingProgress, stopIndexing } from '@/features/indexing/embedder';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Repository ID is required' }, { status: 400 });
    }

    // Immediately stop any active or queued indexing operations
    stopIndexing(id);

    // PostgreSQL database foreign keys are configured with ON DELETE CASCADE:
    // "File" -> "Repository" (ON DELETE CASCADE)
    // "Chunk" -> "File" (ON DELETE CASCADE)
    // Deleting the repository row atomically cascades and cleans up all Files and Chunks in <200ms.
    const result = await prisma.repository.deleteMany({
      where: { id },
    });

    return NextResponse.json({
      message: 'Repository deleted successfully',
      deleted: result.count > 0,
    });
  } catch (error: any) {
    console.error('[Delete Repo] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete repository' },
      { status: 500 }
    );
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
