import { existsSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const INDICATORS: Array<{ name: string; files: string[]; extensions: string[] }> = [
  {
    name: 'typescript',
    files: ['tsconfig.json', 'package.json'],
    extensions: ['.ts', '.tsx'],
  },
  {
    name: 'clojure',
    files: ['deps.edn', 'project.clj', 'shadow-cljs.edn', 'bb.edn'],
    extensions: ['.clj', '.cljs', '.cljc'],
  },
];

export function detectLanguages(root: string): string[] {
  const detected: string[] = [];

  for (const lang of INDICATORS) {
    // Check indicator files first (cheap)
    const hasFile = lang.files.some((f) => existsSync(join(root, f)));
    if (hasFile) {
      detected.push(lang.name);
      continue;
    }

    // Fall back to scanning top-level files for known extensions
    try {
      const entries = readdirSync(root, { withFileTypes: true });
      const hasExt = entries.some(
        (e) => e.isFile() && lang.extensions.includes(extname(e.name))
      );
      if (hasExt) detected.push(lang.name);
    } catch {
      // ignore unreadable dirs
    }
  }

  // Default to TypeScript if nothing detected
  return detected.length > 0 ? detected : ['typescript'];
}
