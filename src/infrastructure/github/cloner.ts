import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

const ALLOWED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.md', '.json'];
const IGNORED_DIRS = ['node_modules', 'build', 'dist', '.next', 'coverage', '.git', '.github', '.idea', '.vscode'];
const IGNORED_FILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'tsconfig.tsbuildinfo'];

export interface RepoFile {
  path: string;
  content: string;
}

export async function cloneAndReadRepo(githubUrl: string): Promise<RepoFile[]> {
  // CRITICAL SECURITY FIX: Strict regex validation to prevent command injection
  // Allow optional trailing slash
  const urlPattern = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/;
  const cleanUrl = githubUrl.trim();
  if (!urlPattern.test(cleanUrl)) {
    throw new Error('Invalid GitHub URL format for cloning.');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repolense-'));
  
  try {
    console.log(`[GitHub] Cloning ${cleanUrl} into ${tempDir}...`);
    // Perform a shallow clone to massively speed up the download
    await execAsync(`git clone --depth 1 "${cleanUrl}" "${tempDir}"`);
    
    console.log(`[GitHub] Reading file tree from ${tempDir}...`);
    const files = readDirectory(tempDir, tempDir);
    return files;
  } catch (error: any) {
    console.error(`[GitHub] Clone error:`, error);
    const details = error.stderr || error.message || String(error);
    throw new Error(`Failed to clone repository: ${details}`);
  } finally {
    // Always cleanup the temp directory to prevent disk leaks
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function readDirectory(dir: string, baseDir: string): RepoFile[] {
  let results: RepoFile[] = [];
  const list = fs.readdirSync(dir);
  
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      if (!IGNORED_DIRS.includes(file)) {
        results = results.concat(readDirectory(filePath, baseDir));
      }
    } else {
      if (IGNORED_FILES.includes(file)) continue;
      const ext = path.extname(file);
      if (ALLOWED_EXTENSIONS.includes(ext)) {
        const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/');
        const content = fs.readFileSync(filePath, 'utf-8');
        results.push({ path: relativePath, content });
      }
    }
  }
  
  return results;
}
