import { NextResponse } from 'next/server';
import { prisma } from '@/infrastructure/database/prisma';
import { generateEmbedding } from '@/features/indexing/embedder';

export async function POST(req: Request) {
  try {
    const { repositoryId, question, history = [] } = await req.json();

    if (!repositoryId || !question) {
      return NextResponse.json({ error: 'Repository ID and question are required' }, { status: 400 });
    }

    const queryVector = await generateEmbedding(question, 5, 3000);
    const vectorString = `[${queryVector.join(',')}]`;

    // pgvector cosine distance operator (<=>)
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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

    let answerText = "I couldn't generate an answer.";
    let retries = 5;
    let delayMs = 3000;

    // Retry with backoff if API throttles
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2 }
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          if (response.status === 429 && attempt < retries) {
            console.warn(`[Chat] Gemini 2.5 Flash 429 received. Retrying in ${delayMs}ms (Attempt ${attempt}/${retries})...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            delayMs *= 2;
            continue;
          }
          throw new Error(`Gemini GenerateContent API Error: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        
        if (data.error && data.error.code === 429) {
          if (attempt < retries) {
            console.warn(`[Chat] Gemini internal 429 received. Retrying in ${delayMs}ms (Attempt ${attempt}/${retries})...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            delayMs *= 2;
            continue;
          }
          throw new Error(`Gemini Internal Error: ${data.error.message}`);
        }

        answerText = data.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't generate an answer.";
        break;
      } catch (error) {
        if (attempt === retries) {
          console.error('[Chat] Failed to generate content via Gemini:', error);
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs *= 2;
      }
    }

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
