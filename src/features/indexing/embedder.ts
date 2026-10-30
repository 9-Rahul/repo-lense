import * as fs from 'fs';
import * as path from 'path';

export type EmbeddingTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

export interface IndexingProgressState {
  status: 'indexing' | 'completed' | 'failed';
  phase: 'discovering' | 'chunking' | 'embedding' | 'rate_limited' | 'completed' | 'failed';
  processedChunks: number;
  totalChunks: number;
  waitSeconds?: number;
  error?: string;
  updatedAt: number;
}

const globalForIndexing = globalThis as unknown as {
  indexingProgressMap: Map<string, IndexingProgressState> | undefined;
  activeIndexingSet: Set<string> | undefined;
  workingEmbeddingModel: string | undefined;
};

const progressMap =
  globalForIndexing.indexingProgressMap ?? new Map<string, IndexingProgressState>();

// Clear any stale errors from previous HMR code versions
for (const [repoId, state] of progressMap.entries()) {
  if (state.status === 'failed') {
    progressMap.delete(repoId);
  }
}

export const activeIndexingRepos =
  globalForIndexing.activeIndexingSet ?? new Set<string>();

if (process.env.NODE_ENV !== 'production') {
  globalForIndexing.indexingProgressMap = progressMap;
  globalForIndexing.activeIndexingSet = activeIndexingRepos;
}

export function setIndexingProgress(
  repositoryId: string,
  state: Omit<IndexingProgressState, 'updatedAt'>
): void {
  progressMap.set(repositoryId, {
    ...state,
    updatedAt: Date.now(),
  });
}

export function getIndexingProgress(
  repositoryId: string
): IndexingProgressState | null {
  return progressMap.get(repositoryId) ?? null;
}

export function clearIndexingProgress(repositoryId: string): void {
  progressMap.delete(repositoryId);
}

export function stopIndexing(repositoryId: string): void {
  activeIndexingRepos.delete(repositoryId);
  progressMap.delete(repositoryId);
}

const MAX_CACHE_ENTRIES = 200;
const queryEmbeddingCache = new Map<string, number[]>();

class NonRetryableApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableApiError';
  }
}

/**
 * Extracts a clean, human-readable error message, optional retryDelay (in ms),
 * and quota exhaustion flag from a Gemini REST API error payload.
 */
export function parseGeminiError(status: number, rawText: string): {
  cleanMessage: string;
  retryAfterMs: number | null;
  isQuotaExhausted: boolean;
} {
  let retryAfterMs: number | null = null;
  const isQuota =
    status === 429 ||
    rawText.includes('RESOURCE_EXHAUSTED') ||
    rawText.toLowerCase().includes('quota exceeded') ||
    rawText.toLowerCase().includes('rate limit');

  // Match "Please retry in 22.37s" or "retryDelay": "22s"
  const retryMatch =
    rawText.match(/retry in (\d+(?:\.\d+)?)s/i) ||
    rawText.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i);
  if (retryMatch) {
    retryAfterMs = Math.ceil(parseFloat(retryMatch[1]) * 1000) + 2000; // +2s safety buffer
  }

  let cleanMessage = '';
  if (isQuota) {
    cleanMessage =
      'Free Gemini quota is exhausted. Please add a new API key or wait a few minutes for the quota to reset.';
  } else {
    try {
      const parsed = JSON.parse(rawText);
      const msg: string = parsed?.error?.message || rawText;
      const firstLine = msg.split('\n')[0].trim();
      cleanMessage = firstLine || `Gemini API Error (${status})`;
    } catch {
      cleanMessage = rawText.slice(0, 200) || `Gemini API Error (${status})`;
    }
  }

  return {
    cleanMessage,
    retryAfterMs,
    isQuotaExhausted: isQuota,
  };
}

let keyRotationIndex = 0;

export function getApiKeys(): string[] {
  const keys: string[] = [];

  const addKeys = (raw?: string) => {
    if (!raw) return;
    for (const k of raw.split(',')) {
      const trimmed = k.trim();
      if (trimmed && !keys.includes(trimmed)) {
        keys.push(trimmed);
      }
    }
  };

  // 1. Case-insensitively check process.env
  for (const [name, val] of Object.entries(process.env)) {
    if (/^gemini_api_key(_\d+)?$/i.test(name) || /^gemini_api_keys$/i.test(name)) {
      addKeys(val);
    }
  }

  // 2. Also read directly from .env.local on disk so newly added keys take effect INSTANTLY without server restarts
  try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const varName = trimmed.slice(0, eqIdx).trim();
          let varVal = trimmed.slice(eqIdx + 1).trim();
          if (
            (varVal.startsWith('"') && varVal.endsWith('"')) ||
            (varVal.startsWith("'") && varVal.endsWith("'"))
          ) {
            varVal = varVal.slice(1, -1);
          }
          if (/^gemini_api_key(_\d+)?$/i.test(varName) || /^gemini_api_keys$/i.test(varName)) {
            addKeys(varVal);
          }
        }
      }
    }
  } catch {
    // Non-fatal if running in an environment where file read is disallowed
  }

  if (keys.length === 0) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  return keys;
}

export function getNextApiKey(): string {
  const keys = getApiKeys();
  const key = keys[keyRotationIndex % keys.length];
  keyRotationIndex = (keyRotationIndex + 1) % keys.length;
  return key;
}

const CANDIDATE_EMBEDDING_MODELS = [
  process.env.GEMINI_EMBEDDING_MODEL,
  'gemini-embedding-2',
  'gemini-embedding-2-preview',
  'gemini-embedding-001',
].filter(Boolean) as string[];

export async function generateEmbedding(
  text: string,
  retries = 6,
  delayMs = 4000,
  taskType: EmbeddingTaskType = 'RETRIEVAL_QUERY'
): Promise<number[]> {
  const cacheKey = `${taskType}:${text.trim()}`;
  if (taskType === 'RETRIEVAL_QUERY') {
    const cached = queryEmbeddingCache.get(cacheKey);
    if (cached) return cached;
  }

  const keys = getApiKeys(); // Validate at least one key exists

  const modelsToTry = globalForIndexing.workingEmbeddingModel
    ? [globalForIndexing.workingEmbeddingModel]
    : CANDIDATE_EMBEDDING_MODELS;

  for (const modelName of modelsToTry) {
    let currentDelay = delayMs;
    let consecutiveQuotaHits = 0;

    for (let attempt = 1; attempt <= retries; attempt++) {
      const apiKey = getNextApiKey();
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:embedContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({
              model: `models/${modelName}`,
              content: { parts: [{ text }] },
              outputDimensionality: 768,
              taskType,
            }),
          }
        );

        if (!response.ok) {
          const errText = await response.text();
          if (response.status === 404 && !globalForIndexing.workingEmbeddingModel) {
            console.warn(`[Embedder] Model ${modelName} returned 404, trying next fallback model...`);
            break;
          }

          const { cleanMessage, retryAfterMs, isQuotaExhausted } = parseGeminiError(
            response.status,
            errText
          );

          const isDailyLimit =
            errText.toLowerCase().includes('per day limit exceeded') ||
            (retryAfterMs !== null && retryAfterMs > 300_000);
          if (isDailyLimit && !globalForIndexing.workingEmbeddingModel) {
            console.warn(
              `[Embedder] Model ${modelName} daily quota exhausted, immediately switching to next model...`
            );
            break;
          }

          if (isQuotaExhausted) {
            consecutiveQuotaHits++;
            // If multiple keys are available and we haven't cycled through all of them, switch immediately without delay
            if (keys.length > 1 && consecutiveQuotaHits < keys.length) {
              console.warn(
                `[Embedder] Key quota hit. Failing over to next Gemini API key (${consecutiveQuotaHits}/${keys.length})...`
              );
              continue;
            }

            const waitMs = retryAfterMs ?? currentDelay;
            console.warn(
              `[Embedder] Gemini quota exhausted across ${keys.length} key(s). Waiting ${Math.round(
                waitMs / 1000
              )}s before retry (Attempt ${attempt}/${retries})...`
            );
            if (attempt === retries) {
              throw new NonRetryableApiError(cleanMessage);
            }
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            consecutiveQuotaHits = 0;
            currentDelay = Math.min(65_000, currentDelay * 2);
            continue;
          }

          if (response.status >= 500 && attempt < retries) {
            await new Promise((resolve) => setTimeout(resolve, currentDelay));
            currentDelay = Math.min(65_000, currentDelay * 2);
            continue;
          }

          throw new NonRetryableApiError(cleanMessage);
        }

        const data = await response.json();
        const values: number[] = data.embedding.values;
        globalForIndexing.workingEmbeddingModel = modelName;

        if (taskType === 'RETRIEVAL_QUERY' && values) {
          if (queryEmbeddingCache.size >= MAX_CACHE_ENTRIES) {
            const oldestKey = queryEmbeddingCache.keys().next().value;
            if (oldestKey) queryEmbeddingCache.delete(oldestKey);
          }
          queryEmbeddingCache.set(cacheKey, values);
        }

        return values;
      } catch (error) {
        if (error instanceof NonRetryableApiError || attempt === retries) {
          console.error('[Embedder] Failed to generate embedding via Gemini:', error);
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, currentDelay));
        currentDelay = Math.min(65_000, currentDelay * 2);
      }
    }
  }
  throw new Error('Free Gemini quota is exhausted. Please add a new API key or wait a few minutes for the quota to reset.');
}

export async function generateEmbeddingsBatch(
  texts: string[],
  retries = 8,
  delayMs = 5000,
  onRateLimitWait?: (waitSeconds: number) => void
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const keys = getApiKeys(); // Validate at least one key exists

  const modelsToTry = globalForIndexing.workingEmbeddingModel
    ? [globalForIndexing.workingEmbeddingModel]
    : CANDIDATE_EMBEDDING_MODELS;

  for (const modelName of modelsToTry) {
    let currentDelay = delayMs;
    let consecutiveQuotaHits = 0;

    for (let attempt = 1; attempt <= retries; attempt++) {
      const apiKey = getNextApiKey();
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:batchEmbedContents?key=${apiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({
              requests: texts.map((text) => ({
                model: `models/${modelName}`,
                content: { parts: [{ text }] },
                outputDimensionality: 768,
                taskType: 'RETRIEVAL_DOCUMENT',
              })),
            }),
          }
        );

        if (!response.ok) {
          const errText = await response.text();
          if (response.status === 404 && !globalForIndexing.workingEmbeddingModel) {
            console.warn(`[Embedder] Batch model ${modelName} returned 404, trying next fallback model...`);
            break;
          }

          const { cleanMessage, retryAfterMs, isQuotaExhausted } = parseGeminiError(
            response.status,
            errText
          );

          const isDailyLimit =
            errText.toLowerCase().includes('per day limit exceeded') ||
            (retryAfterMs !== null && retryAfterMs > 300_000);
          if (isDailyLimit && !globalForIndexing.workingEmbeddingModel) {
            console.warn(
              `[Embedder] Batch model ${modelName} daily quota exhausted, immediately switching to next model...`
            );
            break;
          }

          if (isQuotaExhausted) {
            consecutiveQuotaHits++;
            // If multiple keys are available and we haven't cycled through all of them, switch immediately without delay
            if (keys.length > 1 && consecutiveQuotaHits < keys.length) {
              console.warn(
                `[Embedder] Key quota hit. Immediately failing over to next Gemini API key (${consecutiveQuotaHits}/${keys.length})...`
              );
              continue;
            }

            // Respect Google's exact retryDelay (e.g., 22s for Free Tier 100 chunks/min reset)
            const waitMs = retryAfterMs ?? currentDelay;
            const waitSec = Math.ceil(waitMs / 1000);
            console.warn(
              `[Embedder] Free Gemini quota exhausted across all ${keys.length} key(s). Waiting ${waitSec}s for quota reset (Attempt ${attempt}/${retries})...`
            );
            if (onRateLimitWait) {
              onRateLimitWait(waitSec);
            }

            if (attempt === retries) {
              throw new NonRetryableApiError(cleanMessage);
            }

            await new Promise((resolve) => setTimeout(resolve, waitMs));
            consecutiveQuotaHits = 0;
            currentDelay = Math.min(65_000, currentDelay * 1.5);
            continue;
          }

          if (response.status >= 500 && attempt < retries) {
            await new Promise((resolve) => setTimeout(resolve, currentDelay));
            currentDelay = Math.min(65_000, currentDelay * 1.5);
            continue;
          }

          throw new NonRetryableApiError(cleanMessage);
        }

        const data = await response.json();
        globalForIndexing.workingEmbeddingModel = modelName;
        return data.embeddings.map((e: any) => e.values);
      } catch (error) {
        if (error instanceof NonRetryableApiError || attempt === retries) {
          console.error('[Embedder] Failed to generate batched embeddings via Gemini:', error);
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, currentDelay));
        currentDelay = Math.min(65_000, currentDelay * 1.5);
      }
    }
  }
  throw new Error('Free Gemini quota is exhausted. Please add a new API key or wait a few minutes for the quota to reset.');
}

export function chunkCode(content: string, filePath?: string, maxTokens = 2000): string[] {
  // ~4 chars per token heuristic (2000 tokens ~= 8000 chars per chunk to minimize Free Tier quota usage)
  const maxChars = maxTokens * 4;
  const header = filePath ? `// File: ${filePath}\n` : '';
  const effectiveMaxChars = Math.max(1000, maxChars - header.length);

  const rawBlocks = content.replace(/\r\n/g, '\n').split('\n\n');
  const normalizedBlocks: string[] = [];

  for (const block of rawBlocks) {
    if (block.length <= effectiveMaxChars) {
      normalizedBlocks.push(block);
    } else {
      const lines = block.split('\n');
      let lineAccumulator = '';
      for (const line of lines) {
        if (line.length > effectiveMaxChars) {
          if (lineAccumulator.trim()) {
            normalizedBlocks.push(lineAccumulator);
            lineAccumulator = '';
          }
          for (let k = 0; k < line.length; k += effectiveMaxChars) {
            normalizedBlocks.push(line.slice(k, k + effectiveMaxChars));
          }
        } else if (lineAccumulator.length + line.length + 1 > effectiveMaxChars) {
          if (lineAccumulator.trim()) {
            normalizedBlocks.push(lineAccumulator);
          }
          lineAccumulator = line;
        } else {
          lineAccumulator += (lineAccumulator ? '\n' : '') + line;
        }
      }
      if (lineAccumulator.trim()) {
        normalizedBlocks.push(lineAccumulator);
      }
    }
  }

  const chunks: string[] = [];
  let currentChunk = '';

  for (const block of normalizedBlocks) {
    if (currentChunk.length + block.length + 2 > effectiveMaxChars) {
      if (currentChunk.trim().length > 0) {
        chunks.push(`${header}${currentChunk.trim()}`);
      }
      currentChunk = block;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + block;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(`${header}${currentChunk.trim()}`);
  }

  return chunks;
}
