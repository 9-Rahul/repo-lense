export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-embedding-2',
        content: { parts: [{ text }] },
        outputDimensionality: 768,
        // Optional: Task type can improve retrieval performance
        taskType: 'RETRIEVAL_DOCUMENT' 
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini Embedding API Error: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    return data.embedding.values;
  } catch (error) {
    console.error('[Embedder] Failed to generate embedding via Gemini:', error);
    throw error;
  }
}

export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: texts.map(text => ({
          model: 'models/gemini-embedding-2',
          content: { parts: [{ text }] },
          outputDimensionality: 768,
          taskType: 'RETRIEVAL_DOCUMENT' 
        }))
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini Batch Embedding API Error: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    return data.embeddings.map((e: any) => e.values);
  } catch (error) {
    console.error('[Embedder] Failed to generate batched embeddings via Gemini:', error);
    throw error;
  }
}

// A simple recursive chunker to break files into manageable pieces
export function chunkCode(content: string, maxTokens = 1500): string[] {
  // Rough heuristic: 1 token ~= 4 characters
  // Gemini embedding limit is much higher (2048 tokens), but 800 keeps semantic contexts tight
  const blocks = content.split('\n\n');
  const chunks: string[] = [];
  
  let currentChunk = '';
  
  for (const block of blocks) {
    if ((currentChunk.length + block.length) / 4 > maxTokens) {
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = block;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + block;
    }
  }
  
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}
