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

export async function cloneAndReadRepo(githubUrl: string): Promise<RepoFile[]> {
  const urlPattern = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/tree\/[A-Za-z0-9_./-]+)?\/?$/;
  const cleanUrl = githubUrl.trim();
  if (!urlPattern.test(cleanUrl)) {
    throw new Error('Invalid GitHub URL format for cloning.');
  }

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'repolense-'));

  try {
    const isBranch = cleanUrl.includes('/tree/');
    const baseRepoUrl = isBranch ? cleanUrl.split('/tree/')[0] : cleanUrl;
    const branchName = isBranch ? cleanUrl.split('/tree/')[1].replace(/\/$/, '') : '';

    console.log(`[GitHub] Attempting shallow clone of ${cleanUrl}...`);
    const branchFlag = branchName ? `-b "${branchName}" ` : '';
    await execAsync(
      `git clone ${branchFlag}--depth 1 --single-branch --filter=blob:none --no-tags "${baseRepoUrl}" "${tempDir}"`
    );

    console.log(`[GitHub] Reading file tree asynchronously from ${tempDir}...`);
    return await readDirectoryAsync(tempDir, tempDir);
  } catch (gitError: any) {
    console.warn(`[GitHub] git clone failed, trying tarball fallback. Error: ${gitError.message || gitError}`);

    // fallback to tarball download if git binary is unavailable or clone fails
    try {
      const urlParts = cleanUrl.replace('https://github.com/', '').split('/');
      const owner = urlParts[0];
      const repo = urlParts[1].replace(/\/$/, '');

      let branch = '';
      if (urlParts.length >= 4 && urlParts[2] === 'tree') {
        branch = urlParts.slice(3).join('/').replace(/\/$/, '');
      }

      const tarballUrl = branch
        ? `https://api.github.com/repos/${owner}/${repo}/tarball/${branch}`
        : `https://api.github.com/repos/${owner}/${repo}/tarball`;
      console.log(`[GitHub] Downloading tarball from ${tarballUrl}...`);

      const headers: Record<string, string> = {
        'User-Agent': 'RepoLense-Importer',
      };
      if (process.env.GITHUB_TOKEN) {
        headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
      }

      const response = await fetch(tarballUrl, { headers });

      if (!response.ok) {
        throw new Error(`GitHub API returned status ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const tarballPath = path.join(tempDir, 'repo.tar.gz');
      await fsp.writeFile(tarballPath, buffer);

      console.log(`[GitHub] Extracting tarball using tar module...`);
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
      console.error(`[GitHub] Tarball fallback also failed:`, fallbackError);
      const details = fallbackError.message || String(fallbackError);
      throw new Error(
        `Failed to clone repository: git clone failed (${gitError.message || gitError}), and tarball fallback failed (${details})`
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
