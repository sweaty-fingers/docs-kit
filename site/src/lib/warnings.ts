// Build warnings (prd.md FR-ARC-3): every format problem is one line `WARNING <tab>: <file>: <text>`.
// Printed once when found (so `docs.sh build 2>&1 | grep -iE "warn|error"` sees it) and appended to
// build/.kit/warnings.txt, which the integration counts at the end of the build (and fails on with --strict).
import fs from 'node:fs';
import path from 'node:path';
import { WORK_DIR } from '../config/paths.ts';

const seen = new Set<string>();
export const WARN_FILE = path.join(WORK_DIR, 'warnings.txt');

export function warn(tab: string, file: string | null, text: string): void {
	const line = `WARNING ${tab}: ${file ? file + ': ' : ''}${text}`;
	if (seen.has(line)) return;
	seen.add(line);
	console.log(line);
	try {
		fs.mkdirSync(WORK_DIR, { recursive: true });
		fs.appendFileSync(WARN_FILE, line + '\n');
	} catch {
		/* the warning was printed; the summary may miss it */
	}
}

/** Forget what was printed (start of a dev rebuild, so a fixed problem disappears and a new one shows). */
export function resetWarnings(): void {
	seen.clear();
}

export function readWarnings(): string[] {
	try {
		return [...new Set(fs.readFileSync(WARN_FILE, 'utf-8').split('\n').filter(Boolean))];
	} catch {
		return [];
	}
}

export function clearWarningFile(): void {
	try {
		fs.rmSync(WARN_FILE, { force: true });
	} catch {
		/* nothing to clear */
	}
}
