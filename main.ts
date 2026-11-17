// Token radar for make.fun's token-radar-01 (Node 22, standard library only).
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), ranks every pre-token protocol
// with the model in lib/model.ts, and writes to /output (MAKEFUN_OUTPUT_DIR or --output stands in for it
// outside the grader):
//   board.json    the ranked board, one row per protocol with its implied value and farm steps
//   data.js       the same figures plus the model's comparables, read by the dashboard
//   dashboard/    this repository's static page (no network, no framework)
//   screenshots/  this repository's three screenshots of that page
//   dossier.json  what the judge reads, written last by the vendored make.fun library
//
// Nothing here reads a clock or a random source: the grader runs the program twice and compares bytes.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's caps: the text cap shapes the dossier's bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> or --name=<value> from the arguments, else the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

/** Stop with a message and a status: 1 for a board or page the gate would refuse, 2 for a missing input. */
function fail(message: string, status: number): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(status);
}

/** Copy a directory's regular files into `to`, skipping names that start with a dot; the names copied. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.') || !statSync(join(from, name)).isFile()) continue;
    copyFileSync(join(from, name), join(to, name));
    copied.push(name);
  }
  return copied;
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`, 1);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));
const pages = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} images: hand in 3, the board, a detail view and a filtered view`, 1);
for (const name of shots) if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);

// The dossier goes last: the scorer rebuilds it from this /output and compares the bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${radar.pre_token_count} record no token, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows ranked\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${pages.length} files), screenshots/ (${shots.length} images) and dossier.json to ${out}\n`,
);
