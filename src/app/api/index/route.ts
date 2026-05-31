import { NextResponse } from 'next/server';
import { prisma } from '@/infrastructure/database/prisma';
import { chunkCode, generateEmbeddingsBatch } from '@/features/indexing/embedder';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

    // Gather all valid chunks across all files
    const allFileChunks: { fileId: string; text: string }[] = [];
    
    for (const file of repository.files) {
      const textChunks = chunkCode(file.content);
      for (const text of textChunks) {
        if (text.trim().length >= 10) {
          allFileChunks.push({ fileId: file.id, text: text.trim() });
        }
      }
    }

    // Process in batches of 100 to stay within Gemini rate limits and payload sizes
    const BATCH_SIZE = 100;
    for (let i = 0; i < allFileChunks.length; i += BATCH_SIZE) {
      const batch = allFileChunks.slice(i, i + BATCH_SIZE);
      
      const embeddings = await generateEmbeddingsBatch(batch.map(b => b.text), 5, 3000);
      
      // Insert into PostgreSQL
      for (let j = 0; j < batch.length; j++) {
        const chunkData = batch[j];
        const vector = embeddings[j];
        
        if (!vector) continue; // Skip if embedding failed for some reason
        
        const vectorString = `[${vector.join(',')}]`;

        await prisma.$executeRaw`
          INSERT INTO "Chunk" (id, "fileId", content, "startIndex", "endIndex", embedding)
          VALUES (
            gen_random_uuid(), 
            ${chunkData.fileId}, 
            ${chunkData.text}, 
            0, 
            ${chunkData.text.length}, 
            ${vectorString}::vector
          )
        `;
        totalChunks++;
      }
      
      // Small delay between batches to respect rate limits
      if (i + BATCH_SIZE < allFileChunks.length) {
        await delay(3000); 
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
