# RepoLens

RepoLens is a tool to explore and understand GitHub codebases. You drop in a repository URL, it clones the files, generates vector embeddings for code chunks using Google Gemini, and stores them in PostgreSQL with `pgvector`. From there, you can chat with the codebase in natural language and get answers with direct file citations.

It also includes an interactive attack surface visualizer built with React Flow to map entry points, services, and data stores.

![RepoLens Dashboard](./public/dashboard.png)

## What it does

- **Clones GitHub repositories**: Performs a shallow clone of public repositories, with an automatic tarball fallback via GitHub's API if `git` isn't installed in the environment.
- **Indexes source files**: Filters for code files (`.ts`, `.tsx`, `.js`, `.jsx`, `.md`, `.json`), chunks them, and stores 768-dimensional embeddings using `pgvector`.
- **Answers codebase questions**: Uses cosine similarity search (`<=>`) to fetch the top 10 relevant code snippets, then feeds them to Gemini 2.5 Flash to answer questions with file citations.
- **Handles API rate limits**: Built-in exponential backoff retries when encountering 429 status codes during batch embedding or chat generation.
- **Visualizes attack surface**: Node-based graph to model services, databases, and potential threat paths.

## Tech Stack

- **Framework**: Next.js 15 (App Router), React 19, TypeScript
- **Styling**: Tailwind CSS
- **Database**: PostgreSQL with `pgvector`
- **ORM**: Prisma
- **AI / Embeddings**: Google Gemini (`gemini-embedding-2`, `gemini-2.5-flash`)
- **Graph Visualization**: `@xyflow/react` (React Flow)
- **Icons**: Lucide React

## Getting Started

### Prerequisites

- Node.js 18 or newer
- A PostgreSQL database with `pgvector` extension enabled (e.g., [Supabase](https://supabase.com/))
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

# Direct URL for Prisma migrations if using a connection pooler
DIRECT_URL="postgresql://user:password@host:5432/dbname"

# Gemini API key
GEMINI_API_KEY="your-gemini-api-key"
```

### 3. Initialize the database

Generate the Prisma client and push the schema to PostgreSQL:

```bash
npx prisma generate
npx prisma db push
```

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## How it works

1. **Importing**: Checks repo size (<200MB) via GitHub API. Clones shallowly or downloads the tarball archive. Ignores lockfiles, test coverage, and build outputs.
2. **Chunking & Embedding**: Code files are broken into blocks (~1500 tokens max) and embedded in batches of 100 via `gemini-embedding-2`. The vectors are saved to the `Chunk` table using raw SQL for `::vector` casting.
3. **Retrieval & Q&A**: When you ask a question, the question is converted into an embedding. A cosine distance query (`<=>`) grabs the 10 closest chunks across the repo, constructs a context block, and Gemini 2.5 Flash produces a response referencing the matching source files.
4. **Threat Graph**: Visualizes architecture nodes and risk indicators on an interactive canvas.
