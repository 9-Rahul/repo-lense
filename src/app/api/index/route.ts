import { NextResponse } from 'next/server';
import { prisma } from '@/infrastructure/database/prisma';
import { chunkCode, generateEmbeddingsBatch } from '@/features/indexing/embedder';

export async function POST(req: Request) {
  try {
    const { repositoryId } = await req.json();

    if (!repositoryId) {
      return NextResponse.json({ error: 'Repository ID is required' }, { status: 400 });
    }

    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      include: { files: true }
    });

    if (!repository) {
      return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
    }

    if (repository.isIndexed) {
      return NextResponse.json({ message: 'Repository is already indexed' });
    }

    let totalChunks = 0;

    const allFileChunks: { fileId: string; text: string }[] = [];
    
    for (const file of repository.files) {
      const textChunks = chunkCode(file.content);
      for (const text of textChunks) {
        if (text.trim().length >= 10) {
          allFileChunks.push({ fileId: file.id, text: text.trim() });
        }
      }
    }

    // batch embedding calls to keep payload sizes reasonable
    const BATCH_SIZE = 100;
    for (let i = 0; i < allFileChunks.length; i += BATCH_SIZE) {
      const batch = allFileChunks.slice(i, i + BATCH_SIZE);
      
      const embeddings = await generateEmbeddingsBatch(batch.map(b => b.text), 5, 3000);
      
      // bulk insert chunks with pgvector cast
      const valuesStr = [];
      const params = [];
      let paramIndex = 1;

      for (let j = 0; j < batch.length; j++) {
        const chunkData = batch[j];
        const vector = embeddings[j];
        
        if (!vector) continue;
        
        valuesStr.push(`(gen_random_uuid(), $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}::vector)`);
        params.push(
          chunkData.fileId,
          chunkData.text,
          0,
          chunkData.text.length,
          `[${vector.join(',')}]`
        );
        totalChunks++;
      }

      if (valuesStr.length > 0) {
        const query = `
          INSERT INTO "Chunk" (id, "fileId", content, "startIndex", "endIndex", embedding)
          VALUES ${valuesStr.join(', ')}
        `;
        await prisma.$executeRawUnsafe(query, ...params);
      }
    }

    await prisma.repository.update({
      where: { id: repository.id },
      data: { isIndexed: true }
    });

    return NextResponse.json({ 
      message: 'Repository indexed successfully',
      chunksCreated: totalChunks
    });

  } catch (error: any) {
    console.error('Indexing error:', error);
    return NextResponse.json({ error: error.message || 'Failed to index repository' }, { status: 500 });
  }
}
