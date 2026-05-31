import { NextResponse } from 'next/server';
import { prisma } from '@/infrastructure/database/prisma';
import { generateEmbedding } from '@/features/indexing/embedder';

export async function POST(req: Request) {
  try {
    const { repositoryId, question, history = [] } = await req.json();

    if (!repositoryId || !question) {
      return NextResponse.json({ error: 'Repository ID and question are required' }, { status: 400 });
    }

    // 1. Generate an embedding for the user's question
    const queryVector = await generateEmbedding(question, 5, 3000);
    const vectorString = `[${queryVector.join(',')}]`;

    // 2. Perform Cosine Similarity Search using pgvector
    const chunks = await prisma.$queryRaw<{ content: string, path: string }[]>`
      SELECT 
        c.content, 
        f.path 
      FROM "Chunk" c
      JOIN "File" f ON c."fileId" = f.id
      WHERE f."repositoryId" = ${repositoryId}
      ORDER BY c.embedding <=> ${vectorString}::vector
      LIMIT 10;
    `;

    // 3. Format context for Gemini
    const typedChunks = chunks as { content: string, path: string }[];
    const contextStrings = typedChunks.map((c: { content: string, path: string }) => `File: ${c.path}\nContent:\n${c.content}\n`);
    const aggregatedContext = contextStrings.join('\n---\n');

    const prompt = `
You are a senior codebase intelligence assistant.
Answer the user's question about their codebase using ONLY the provided context blocks.
When you explain how something works, YOU MUST CITE THE EXACT FILE PATHS used in your answer.
Do not make up file paths.

CONTEXT:
${aggregatedContext}

QUESTION:
${question}
`;

    // 4. Send to Gemini 2.5 Flash
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 }
      })
    });

    const data = await response.json();
    const answerText = data.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't generate an answer.";

    // 5. Extract unique sources to return alongside the text
    const uniquePaths = Array.from(new Set(typedChunks.map((c: { path: string }) => c.path)));

    return NextResponse.json({ 
      answer: answerText,
      sources: uniquePaths
    });

  } catch (error: any) {
    console.error('Chat API Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
