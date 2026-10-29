import { exec } from 'child_process';
import { promisify } from 'util';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as tar from 'tar';

const execAsync = promisify(exec);

const ALLOWED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.md', '.json']);
const IGNORED_DIRS = new Set([
  'node_modules',
  'build',
  'dist',
  '.next',
  'coverage',
  '.git',
  '.github',
  '.idea',
  '.vscode',
  'out',
  'vendor',
  '__tests__',
  'test',
  'tests',
  'e2e',
  'cypress',
  'playwright',
  'fixtures',
  'mocks',
  'examples',
  'docs',
  'public',
  'assets',
  'migrations',
]);
const IGNORED_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'tsconfig.tsbuildinfo',
  'skills-lock.json',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'LICENSE.md',
  'SECURITY.md',
]);
const MAX_FILE_SIZE_BYTES = 128 * 1024; // 128KB max per file to skip large fixtures/bundles

export interface RepoFile {
  path: string;
  content: string;
}

export class RepoImportError extends Error {
  public userMessage: string;
  public statusCode: number;

  constructor(userMessage: string, statusCode = 400, internalDetails?: string) {
    super(internalDetails || userMessage);
    this.name = 'RepoImportError';
    this.userMessage = userMessage;
    this.statusCode = statusCode;
  }
}

/**
 * Resilient GitHub fetch helper:
 * Tries with GITHUB_TOKEN first if configured. If GitHub returns 401 (e.g. expired or invalid token),
 * it automatically retries unauthenticated so public repositories still succeed!
 */
export async function fetchFromGitHub(
  url: string,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  const baseHeaders: Record<string, string> = {
    'User-Agent': 'RepoLense-Importer',
    ...extraHeaders,
  };

  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    baseHeaders['Authorization'] = `Bearer ${token}`;
  }

  let response = await fetch(url, { headers: baseHeaders });

  // If token was rejected with 401 Unauthorized, retry without token for public repos
  if (response.status === 401 && token) {
    console.warn('[GitHub] Configured GITHUB_TOKEN was rejected with 401. Retrying unauthenticated...');
    delete baseHeaders['Authorization'];
    response = await fetch(url, { headers: baseHeaders });
  }

  return response;
}

export async function cloneAndReadRepo(githubUrl: string): Promise<RepoFile[]> {
  const urlPattern = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/tree\/[A-Za-z0-9_./-]+)?\/?$/;
  const cleanUrl = githubUrl.trim();
  if (!urlPattern.test(cleanUrl)) {
    throw new RepoImportError(
      'Invalid repository URL. Please enter a valid GitHub URL (e.g. https://github.com/owner/repo).',
      400
    );
  }

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'repolense-'));

  try {
    const isBranch = cleanUrl.includes('/tree/');
    const baseRepoUrl = isBranch ? cleanUrl.split('/tree/')[0] : cleanUrl;
    const branchName = isBranch ? cleanUrl.split('/tree/')[1].replace(/\/$/, '') : '';

    const urlParts = cleanUrl.replace('https://github.com/', '').split('/');
    const owner = urlParts[0];
    const repo = urlParts[1].replace(/\/$/, '');
    let branch = '';
    if (urlParts.length >= 4 && urlParts[2] === 'tree') {
      branch = urlParts.slice(3).join('/').replace(/\/$/, '');
    }

    // In serverless environments (Vercel, AWS Lambda), git binary is not installed.
    // Skip git clone and download the tarball stream directly.
    const isServerless = Boolean(
      process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NEXT_RUNTIME === 'edge'
    );

    let clonedSuccessfully = false;

    if (!isServerless) {
      try {
        console.log(`[GitHub] Attempting shallow clone of ${cleanUrl}...`);
        const branchFlag = branchName ? `-b "${branchName}" ` : '';
        await execAsync(
          `git clone ${branchFlag}--depth 1 --single-branch --filter=blob:none --no-tags "${baseRepoUrl}" "${tempDir}"`,
          { timeout: 30000 }
        );
        clonedSuccessfully = true;
      } catch (gitErr: any) {
        console.warn(`[GitHub] git clone failed on host, switching to HTTPS tarball stream: ${gitErr.message}`);
      }
    }

    if (clonedSuccessfully) {
      console.log(`[GitHub] Reading file tree from ${tempDir}...`);
      return await readDirectoryAsync(tempDir, tempDir);
    }

    // Fallback or Serverless path: Stream and extract tarball from GitHub REST API
    try {
      const tarballUrl = branch
        ? `https://api.github.com/repos/${owner}/${repo}/tarball/${branch}`
        : `https://api.github.com/repos/${owner}/${repo}/tarball`;
      console.log(`[GitHub] Downloading tarball stream from ${tarballUrl}...`);

      const response = await fetchFromGitHub(tarballUrl);

      if (!response.ok) {
        if (response.status === 404) {
          throw new RepoImportError(
            'Repository not found or is private. Please ensure the repository is public and the branch exists.',
            404
          );
        }
        if (response.status === 403) {
          throw new RepoImportError(
            'GitHub API rate limit reached. Please wait a few minutes before trying again.',
            429
          );
        }
        throw new RepoImportError(
          'Unable to download repository files from GitHub. Please check if the repository is accessible.',
          response.status
        );
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const tarballPath = path.join(tempDir, 'repo.tar.gz');
      await fsp.writeFile(tarballPath, buffer);

      console.log(`[GitHub] Extracting tarball...`);
      await tar.x({
        file: tarballPath,
        cwd: tempDir,
      });
      await fsp.unlink(tarballPath);

      const list = await fsp.readdir(tempDir, { withFileTypes: true });
      const firstDir = list.find((d) => d.isDirectory());
      if (list.length === 1 && firstDir) {
        const nestedDir = path.join(tempDir, firstDir.name);
        console.log(`[GitHub] Reading files from extracted folder: ${nestedDir}`);
        return await readDirectoryAsync(nestedDir, nestedDir);
      }

      return await readDirectoryAsync(tempDir, tempDir);
    } catch (fallbackError: any) {
      if (fallbackError instanceof RepoImportError) {
        throw fallbackError;
      }
      console.error('[GitHub] Tarball extraction failed:', fallbackError);
      throw new RepoImportError(
        'Unable to unpack repository archive. Please verify the repository has valid source files.',
        500
      );
    }
  } finally {
    try {
      await fsp.rm(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error(`[GitHub] Cleanup error:`, cleanupError);
    }
  }
}

async function readDirectoryAsync(dir: string, baseDir: string): Promise<RepoFile[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });

  const tasks = entries.map(async (entry): Promise<RepoFile[]> => {
    const fileName = entry.name;
    const filePath = path.join(dir, fileName);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(fileName) || fileName.startsWith('.')) {
        return [];
      }
      return readDirectoryAsync(filePath, baseDir);
    }

    if (!entry.isFile()) return [];
    if (IGNORED_FILES.has(fileName)) return [];
    if (
      fileName.endsWith('.min.js') ||
      fileName.endsWith('.bundle.js') ||
      fileName.endsWith('.map') ||
      fileName.endsWith('.d.ts') ||
      fileName.endsWith('.test.ts') ||
      fileName.endsWith('.test.tsx') ||
      fileName.endsWith('.spec.ts') ||
      fileName.endsWith('.spec.tsx') ||
      fileName.endsWith('.test.js') ||
      fileName.endsWith('.spec.js') ||
      fileName.endsWith('.stories.tsx')
    ) {
      return [];
    }

    const ext = path.extname(fileName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) return [];

    // Only keep package.json and tsconfig.json among .json files (skip data/locale/schema dumps)
    if (ext === '.json' && fileName !== 'package.json' && fileName !== 'tsconfig.json') {
      return [];
    }
    // Only keep README.md among markdown files to preserve Free Tier embedding quota for code
    if (ext === '.md' && fileName.toLowerCase() !== 'readme.md') {
      return [];
    }

    try {
      const stat = await fsp.stat(filePath);
      if (stat.size === 0 || stat.size > MAX_FILE_SIZE_BYTES) {
        return [];
      }
      const content = await fsp.readFile(filePath, 'utf-8');
      if (content.includes('\0')) return [];

      const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/');
      return [{ path: relativePath, content }];
    } catch {
      return [];
    }
  });

  const nestedResults = await Promise.all(tasks);
  return nestedResults.flat();
}
