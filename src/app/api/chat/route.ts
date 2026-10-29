import { NextResponse } from 'next/server';
import { prisma, ensureVectorIndexes } from '@/infrastructure/database/prisma';
import { generateEmbedding, parseGeminiError } from '@/features/indexing/embedder';

export async function POST(req: Request) {
  try {
    const { repositoryId, question, history = [], stream = false } = await req.json();

    if (!repositoryId || !question) {
      return NextResponse.json({ error: 'Repository ID and question are required' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    const baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash';

    // Ensure pgvector HNSW index exists (idempotent, runs once per server lifecycle)
    ensureVectorIndexes().catch(() => {});

    // Use RETRIEVAL_QUERY taskType (+ in-memory LRU cache for repeated queries)
    const queryVector = await generateEmbedding(question, 5, 3000, 'RETRIEVAL_QUERY');
    const vectorString = `[${queryVector.join(',')}]`;

    // pgvector cosine distance operator (<=>), top 6 most relevant chunks
    const chunks = await prisma.$queryRaw<{ content: string; path: string }[]>`
      SELECT 
        c.content, 
        f.path 
      FROM "Chunk" c
      JOIN "File" f ON c."fileId" = f.id
      WHERE f."repositoryId" = ${repositoryId}
      ORDER BY c.embedding <=> ${vectorString}::vector
      LIMIT 6;
    `;

    const typedChunks = chunks as { content: string; path: string }[];
    const uniquePaths = Array.from(new Set(typedChunks.map((c) => c.path)));

    const contextStrings = typedChunks.map(
      (c) => `File: ${c.path}\nContent:\n${c.content}\n`
    );
    const aggregatedContext = contextStrings.join('\n---\n');

    // Format recent conversation history (up to last 4 turns) for follow-up context
    const recentHistory = Array.isArray(history)
      ? history
          .slice(-5, -1)
          .map((m: { role: string; content: string }) => `${m.role.toUpperCase()}: ${m.content}`)
          .join('\n\n')
      : '';

    const prompt = `You are a senior codebase intelligence assistant.
Answer the user's question about their codebase using ONLY the provided context blocks.
When you explain how something works, YOU MUST CITE THE EXACT FILE PATHS used in your answer.
Do not make up file paths.

${recentHistory ? `RECENT CONVERSATION HISTORY:\n${recentHistory}\n\n` : ''}CONTEXT:
${aggregatedContext}

QUESTION:
${question}`;

    const requestBody = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    // Real-time Server-Sent Events (SSE) Streaming Mode
    if (stream) {
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          const sendEvent = (payload: Record<string, unknown>) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          };

          try {
            // Immediately send matched file citations to the UI while LLM starts generating
            sendEvent({ sources: uniquePaths });

            let response: Response | null = null;
            let delayMs = 2000;
            const maxRetries = 4;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              response = await fetch(
                `${baseUrl}:streamGenerateContent?alt=sse&key=${apiKey}`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: requestBody,
                }
              );

              if (response.ok) break;

              const errText = await response.text();
              const { cleanMessage, retryAfterMs } = parseGeminiError(response.status, errText);

              if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
                await new Promise((r) => setTimeout(r, retryAfterMs ?? delayMs));
                delayMs *= 2;
                continue;
              }

              throw new Error(cleanMessage);
            }

            if (!response || !response.body) {
              throw new Error('Empty stream from Gemini API');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
              const { value, done } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const jsonStr = trimmed.slice(5).trim();
                if (!jsonStr || jsonStr === '[DONE]') continue;

                try {
                  const parsed = JSON.parse(jsonStr);
                  const tokenText = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                  if (tokenText) {
                    sendEvent({ token: tokenText });
                  }
                } catch {
                  // Ignore partial JSON line
                }
              }
            }

            sendEvent({ done: true });
            controller.close();
          } catch (streamErr: any) {
            sendEvent({ error: streamErr.message || 'Streaming failed' });
            controller.close();
          }
        },
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      });
    }

    // Standard JSON fallback mode
    let answerText = "I couldn't generate an answer.";
    const retries = 5;
    let delayMs = 3000;

    for (let attempt = 1; attempt <= retries; attempt++) {
      const response = await fetch(
        `${baseUrl}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody,
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        const { cleanMessage, retryAfterMs } = parseGeminiError(response.status, errText);
        if ((response.status === 429 || response.status >= 500) && attempt < retries) {
          console.warn(
            `[Chat] Gemini 2.5 Flash ${response.status} received. Retrying in ${
              retryAfterMs ?? delayMs
            }ms (Attempt ${attempt}/${retries})...`
          );
          await new Promise((resolve) => setTimeout(resolve, retryAfterMs ?? delayMs));
          delayMs *= 2;
          continue;
        }
        throw new Error(cleanMessage);
      }

      const data = await response.json();
      answerText =
        data.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't generate an answer.";
      break;
    }

    return NextResponse.json({
      answer: answerText,
      sources: uniquePaths,
    });
  } catch (error: any) {
    console.error('Chat API Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
