import { NextResponse } from 'next/server';
import { prisma } from '@/infrastructure/database/prisma';
import { chunkCode, generateEmbedding } from '@/features/indexing/embedder';

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

    // Process each file
    for (const file of repository.files) {
      const chunks = chunkCode(file.content);
      
      for (const chunkText of chunks) {
        // Skip empty or extremely small chunks
        if (chunkText.trim().length < 10) continue;

        // Generate the 384-dimensional vector using BAAI/bge-small-en-v1.5
        const vector = await generateEmbedding(chunkText);
        
        // Convert the vector array to a PostgreSQL vector string format: '[1.23, 4.56, ...]'
        const vectorString = `[${vector.join(',')}]`;

        // Insert the chunk and vector using a raw SQL query since Prisma's Unsupported type 
        // cannot be inserted using the standard ORM client methods directly yet.
        await prisma.$executeRaw`
          INSERT INTO "Chunk" (id, "fileId", content, "startIndex", "endIndex", embedding)
          VALUES (
            gen_random_uuid(), 
            ${file.id}, 
            ${chunkText}, 
            0, 
            ${chunkText.length}, 
            ${vectorString}::vector
          )
        `;
        totalChunks++;
      }
    }

    // Mark repository as indexed
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
