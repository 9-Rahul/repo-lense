import { NextResponse } from 'next/server';
import { prisma } from '@/infrastructure/database/prisma';
import {
  chunkCode,
  generateEmbeddingsBatch,
  setIndexingProgress,
  clearIndexingProgress,
  activeIndexingRepos,
} from '@/features/indexing/embedder';

export async function POST(req: Request) {
  let targetRepoId: string | null = null;
  try {
    const { repositoryId } = await req.json();
    targetRepoId = repositoryId;

    if (!repositoryId) {
      return NextResponse.json({ error: 'Repository ID is required' }, { status: 400 });
    }

    if (activeIndexingRepos.has(repositoryId)) {
      return NextResponse.json({ message: 'Indexing is already in progress' });
    }
    activeIndexingRepos.add(repositoryId);

    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      select: {
        id: true,
        isIndexed: true,
        files: {
          select: {
            id: true,
            path: true,
            content: true,
            _count: {
              select: { chunks: true },
            },
          },
        },
      },
    });

    if (!repository) {
      return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
    }

    if (repository.isIndexed) {
      clearIndexingProgress(repository.id);
      return NextResponse.json({ message: 'Repository is already indexed' });
    }

    setIndexingProgress(repository.id, {
      status: 'indexing',
      phase: 'chunking',
      processedChunks: 0,
      totalChunks: 0,
    });

    // Prioritize core source files first and cap total chunks at MAX_CHUNKS_PER_REPO (default 90)
    // so indexing completes in a single <100-item batch without hitting Gemini Free Tier's 100 RPM limit!
    const maxChunksPerRepo = Number(process.env.MAX_CHUNKS_PER_REPO || 90);

    const scoreFilePriority = (filePath: string): number => {
      const lower = filePath.toLowerCase();
      if (lower === 'readme.md' || lower === 'package.json') return 1;
      if (lower.includes('prisma/schema.prisma')) return 2;
      if (lower.startsWith('src/app/') || lower.startsWith('app/')) return 3;
      if (lower.startsWith('src/') || lower.startsWith('lib/') || lower.startsWith('server/')) return 4;
      return 5;
    };

    const sortedFiles = [...repository.files].sort(
      (a, b) => scoreFilePriority(a.path) - scoreFilePriority(b.path)
    );

    let alreadySavedChunks = 0;
    const pendingFileChunks: { fileId: string; text: string }[] = [];

    for (const file of sortedFiles) {
      const existingCount = file._count.chunks;
      if (existingCount > 0) {
        alreadySavedChunks += existingCount;
        continue;
      }

      if (alreadySavedChunks + pendingFileChunks.length >= maxChunksPerRepo) {
        break;
      }

      // Use larger 3000-token (~12KB) chunks so most files fit in 1 chunk
      const textChunks = chunkCode(file.content, file.path, 3000);
      for (const text of textChunks) {
        if (text.trim().length >= 10) {
          pendingFileChunks.push({ fileId: file.id, text: text.trim() });
          if (alreadySavedChunks + pendingFileChunks.length >= maxChunksPerRepo) {
            break;
          }
        }
      }
    }

    const totalChunks = alreadySavedChunks + pendingFileChunks.length;
    let processedChunks = alreadySavedChunks;

    setIndexingProgress(repository.id, {
      status: 'indexing',
      phase: 'embedding',
      processedChunks,
      totalChunks,
    });

    // Send 15 chunks per batch (well within Google AI Studio's 20-chunk burst limit per key)
    // Rotating across configured keys gives smooth, lightning-fast embedding in seconds without 429 delays!
    const BATCH_SIZE = 15;

    for (let i = 0; i < pendingFileChunks.length; i += BATCH_SIZE) {
      if (!activeIndexingRepos.has(repository.id)) {
        console.log(`[Indexing] Cancelled for repository ${repository.id}`);
        return NextResponse.json({ message: 'Indexing was cancelled' });
      }

      const batch = pendingFileChunks.slice(i, i + BATCH_SIZE);

      setIndexingProgress(repository.id, {
        status: 'indexing',
        phase: 'embedding',
        processedChunks,
        totalChunks,
      });

      const embeddings = await generateEmbeddingsBatch(
        batch.map((b) => b.text),
        8,
        5000,
        (waitSeconds) => {
          setIndexingProgress(repository.id, {
            status: 'indexing',
            phase: 'rate_limited',
            processedChunks,
            totalChunks,
            waitSeconds,
          });
        }
      );

      const valuesStr: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      for (let j = 0; j < batch.length; j++) {
        const chunkData = batch[j];
        const vector = embeddings[j];
        if (!vector) continue;

        valuesStr.push(
          `(gen_random_uuid(), $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}::vector)`
        );
        params.push(
          chunkData.fileId,
          chunkData.text,
          0,
          chunkData.text.length,
          `[${vector.join(',')}]`
        );
        processedChunks++;
      }

      if (valuesStr.length > 0) {
        const query = `
          INSERT INTO "Chunk" (id, "fileId", content, "startIndex", "endIndex", embedding)
          VALUES ${valuesStr.join(', ')}
        `;
        await prisma.$executeRawUnsafe(query, ...params);
      }

      setIndexingProgress(repository.id, {
        status: 'indexing',
        phase: 'embedding',
        processedChunks,
        totalChunks,
      });

      if (i + BATCH_SIZE < pendingFileChunks.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    await prisma.repository.update({
      where: { id: repository.id },
      data: { isIndexed: true },
    });

    setIndexingProgress(repository.id, {
      status: 'completed',
      phase: 'completed',
      processedChunks,
      totalChunks,
    });

    return NextResponse.json({
      message: 'Repository indexed successfully',
      chunksCreated: processedChunks,
    });
  } catch (error: any) {
    console.error('Indexing error:', error);
    if (targetRepoId) {
      setIndexingProgress(targetRepoId, {
        status: 'failed',
        phase: 'failed',
        processedChunks: 0,
        totalChunks: 0,
        error: error.message || 'Failed to index repository',
      });
    }
    return NextResponse.json({ error: error.message || 'Failed to index repository' }, { status: 500 });
  } finally {
    if (targetRepoId) {
      activeIndexingRepos.delete(targetRepoId);
    }
  }
}
