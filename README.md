# RepoLens

RepoLens is an AI-powered codebase intelligence and RAG (Retrieval-Augmented Generation) platform for exploring and understanding GitHub repositories. Drop in a repository URL and RepoLens clones the source tree, chunks code with file-path metadata, generates 768-dimensional semantic embeddings via Google Gemini, indexes them in PostgreSQL using `pgvector` HNSW indexes, and lets you chat with the codebase in real time with clickable file citations.

It also includes an interactive attack surface visualizer built with React Flow to map entry points, services, and critical data stores.

![RepoLens Dashboard](./public/dashboard.png)

## Key Capabilities

- **Fast GitHub Ingestion**: Performs shallow, blob-filtered clones (`--depth 1 --single-branch --filter=blob:none --no-tags`) with an automatic GitHub tarball fallback if `git` is unavailable. Traverses directories asynchronously (`fs.promises`) while filtering out lockfiles, build artifacts, binaries, and oversized fixtures (>256KB).
- **Context-Aware Code Chunking & Parallel Indexing**: Splits source files (`.ts`, `.tsx`, `.js`, `.jsx`, `.md`, `.json`) into ~1,200-token chunks prefixed with file-path headers (`// File: path/to/file.ts`) and embeds them in parallel windows (`3 x 100` chunks per batch) using `gemini-embedding-2`.
- **HNSW Vector Search (`pgvector`)**: Automatically provisions a `pgvector` HNSW index (`vector_cosine_ops`) on `Chunk.embedding` and a B-tree index on `Chunk.fileId` for sub-10ms approximate nearest neighbor (ANN) cosine similarity search (`<=>`).
- **Real-Time SSE Streaming Q&A**: Uses asymmetric embeddings (`RETRIEVAL_DOCUMENT` for code chunks, `RETRIEVAL_QUERY` with LRU caching for user questions) and streams answers token-by-token via Server-Sent Events (`:streamGenerateContent?alt=sse`) from `gemini-2.5-flash` with `thinkingBudget: 0` for `<1s` Time-To-First-Token.
- **Instant Source Code Inspection**: Click any referenced file pill in the chat to inspect its full source code in a slide-over drawer backed by HTTP `Cache-Control` and client-side in-memory caching.
- **Attack Surface Visualizer**: Interactive node graph (`/security`) built with `@xyflow/react` to model gateways, services, and threat paths.

## Tech Stack

- **Framework**: Next.js 16 (App Router, React Compiler), React 19, TypeScript
- **Styling**: Tailwind CSS v4
- **Database**: PostgreSQL with `pgvector` (HNSW cosine index)
- **ORM & Driver**: Prisma 7 with `@prisma/adapter-pg` (`pg.Pool` singleton)
- **AI / Embeddings**: Google Gemini (`gemini-embedding-2` @ 768 dims, `gemini-2.5-flash` SSE streaming)
- **Graph Visualization**: `@xyflow/react` (React Flow)
- **Icons**: Lucide React

## Architecture & Performance Engineering

1. **Ingestion (`/api/import`)**:
   - Validates repository size (<200MB) via the GitHub REST API (supports optional `GITHUB_TOKEN` to raise rate limits from 60 to 5,000 req/hr).
   - Clones via shallow `git clone` or tarball stream and asynchronously reads source files in parallel.
   - Inserts files in bounded batches (`250` rows per batch, concurrency `2`) to prevent oversized SQL packets over remote database connections.
2. **Vector Indexing (`/api/index`)**:
   - Chunks code with fallback line/window splitting so single-line or dense JSON files never exceed embedding token limits.
   - Executes `batchEmbedContents` (`100` chunks/request) with a concurrency window of `3` and smart retry backoff (retrying only `429` and `5xx` errors while failing fast on `4xx` configuration errors).
   - Streams live chunk progress (`processedChunks / totalChunks`) to the indexing UI (`/repo/[id]/indexing`).
3. **Retrieval & Streaming Synthesis (`/api/chat`)**:
   - Embeds the user's question with `taskType: 'RETRIEVAL_QUERY'` (cached in an in-memory LRU map for repeated queries).
   - Queries the top 6 closest chunks using the `pgvector` `<=>` cosine distance operator backed by an HNSW index.
   - Immediately emits matched file citations over SSE (`data: {"sources": [...]}`), then streams LLM tokens in real time (`data: {"token": "..."}`).

## Getting Started

### Prerequisites

- Node.js 18+
- A PostgreSQL database with the `pgvector` extension enabled (e.g., [Supabase](https://supabase.com/) or Neon)
- A Google Gemini API key

### 1. Clone & install dependencies

```bash
git clone https://github.com/9-Rahul/repo-lense.git
cd repo-lense
npm install
```

### 2. Set up environment variables

Create a `.env.local` file in the project root:

```env
# Database connection string with pgvector enabled
DATABASE_URL="postgresql://user:password@host:5432/dbname"

# Direct URL for Prisma migrations if using a connection pooler (e.g., Supabase port 5432)
DIRECT_URL="postgresql://user:password@host:5432/dbname"

# Gemini API key (required)
GEMINI_API_KEY="your-gemini-api-key"

# Optional: GitHub Personal Access Token for higher import rate limits
GITHUB_TOKEN="ghp_your_optional_token"
```

### 3. Initialize the database

Generate the Prisma client and push the schema to PostgreSQL:

```bash
npx prisma generate
npx prisma db push
```

*(Note: RepoLens also automatically ensures the `Chunk_fileId_idx` B-tree index and `Chunk_embedding_hnsw_idx` HNSW vector index exist at runtime.)*

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.
