import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as tar from 'tar';

const execAsync = promisify(exec);

const ALLOWED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.md', '.json'];
const IGNORED_DIRS = ['node_modules', 'build', 'dist', '.next', 'coverage', '.git', '.github', '.idea', '.vscode'];
const IGNORED_FILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'tsconfig.tsbuildinfo'];

export interface RepoFile {
  path: string;
  content: string;
}

export async function cloneAndReadRepo(githubUrl: string): Promise<RepoFile[]> {
  // Allow optional trailing slash and optional branch paths
  const urlPattern = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/tree\/[A-Za-z0-9_./-]+)?\/?$/;
  const cleanUrl = githubUrl.trim();
  if (!urlPattern.test(cleanUrl)) {
    throw new Error('Invalid GitHub URL format for cloning.');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repolense-'));

  try {
    const isBranch = cleanUrl.includes('/tree/');
    const baseRepoUrl = isBranch ? cleanUrl.split('/tree/')[0] : cleanUrl;
    const branchName = isBranch ? cleanUrl.split('/tree/')[1].replace(/\/$/, '') : '';

    console.log(`[GitHub] Attempting to clone ${cleanUrl} via git clone...`);
    if (branchName) {
      await execAsync(`git clone -b "${branchName}" --depth 1 "${baseRepoUrl}" "${tempDir}"`);
    } else {
      await execAsync(`git clone --depth 1 "${baseRepoUrl}" "${tempDir}"`);
    }

    console.log(`[GitHub] Reading file tree from ${tempDir}...`);
    const files = readDirectory(tempDir, tempDir);
    return files;
  } catch (gitError: any) {
    console.warn(`[GitHub] git clone failed, trying tarball fallback. Error: ${gitError.message || gitError}`);

    // Fallback: Download and extract tarball via GitHub API
    try {
      const urlParts = cleanUrl.replace('https://github.com/', '').split('/');
      const owner = urlParts[0];
      const repo = urlParts[1].replace(/\/$/, ''); // strip trailing slash if any

      let branch = '';
      if (urlParts.length >= 4 && urlParts[2] === 'tree') {
        branch = urlParts.slice(3).join('/').replace(/\/$/, '');
      }

      const tarballUrl = branch
        ? `https://api.github.com/repos/${owner}/${repo}/tarball/${branch}`
        : `https://api.github.com/repos/${owner}/${repo}/tarball`;
      console.log(`[GitHub] Downloading tarball from ${tarballUrl}...`);

      const response = await fetch(tarballUrl, {
        headers: {
          'User-Agent': 'RepoLense-Importer'
        }
      });

      if (!response.ok) {
        throw new Error(`GitHub API returned status ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const tarballPath = path.join(tempDir, 'repo.tar.gz');
      fs.writeFileSync(tarballPath, buffer);

      console.log(`[GitHub] Extracting tarball using tar module...`);
      await tar.x({
        file: tarballPath,
        cwd: tempDir
      });
      fs.unlinkSync(tarballPath);

      const list = fs.readdirSync(tempDir);
      if (list.length === 1 && fs.statSync(path.join(tempDir, list[0])).isDirectory()) {
        const nestedDir = path.join(tempDir, list[0]);
        console.log(`[GitHub] Reading files from extracted folder: ${nestedDir}`);
        return readDirectory(nestedDir, nestedDir);
      }

      return readDirectory(tempDir, tempDir);
    } catch (fallbackError: any) {
      console.error(`[GitHub] Tarball fallback also failed:`, fallbackError);
      const details = fallbackError.message || String(fallbackError);
      throw new Error(`Failed to clone repository: git clone failed (${gitError.message || gitError}), and tarball fallback failed (${details})`);
    }
  } finally {
    // Always cleanup the temp directory to prevent disk leaks
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error(`[GitHub] Cleanup error:`, cleanupError);
    }
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
