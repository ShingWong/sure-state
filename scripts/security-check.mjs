/**
 * Pre-publish security check.
 * Scans what ships — src/ plus the root files npm always includes
 * (README.md, LICENSE, package.json) — for common leakage patterns and
 * exits non-zero if any are found.
 *
 * Run via: `node scripts/security-check.mjs`
 * Or as part of `prepublishOnly` in package.json.
 *
 * Dependency-free on purpose: `prepublishOnly` must not fetch from the
 * registry, so this runs under plain `node` (no `npx tsx` on a fresh clone).
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname, relative, sep } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const SRC = join(ROOT, 'src')

/** Root files that ship in the tarball but live outside src/. */
const ROOT_FILES = ['README.md', 'LICENSE', 'package.json']

const SCAN_EXTENSIONS = ['.ts', '.tsx', '.js', '.json', '.md', '.yml', '.yaml']
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git'])
// Test files carry synthetic fixtures (fake passwords/emails) by design — not secrets.
// Covers *.test.ts(x), *.spec.ts(x), *.spec.js, etc.
const TEST_FILE = /\.(?:test|spec)\.\w+$/

const LEAK_PATTERNS = [
  { regex: /(?:AKIA[0-9A-Z]{16}|sk-[a-zA-Z0-9]{32,})/, label: 'AWS secret key or OpenAI token' },
  { regex: /(?:ghp_|gho_|github_pat_)[a-zA-Z0-9_]{36,}/, label: 'GitHub token' },
  { regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, label: 'Private key' },
  { regex: /password\s*[:=]\s*['"][^'"]+['"]/i, label: 'Hardcoded password' },
  // Requires a non-empty local part before '@' so npm scoped package names
  // (@shing.wong/…) and @handle.mentions are not mistaken for addresses.
  { regex: /(?:info@|[\w.+-]+@[\w-]+\.[a-zA-Z]{2,})/, label: 'Email address' },
  { regex: /\/usr\/local\/devel\//, label: 'Internal filesystem path' },
  // Private ranges require four octets so semver strings like "10.2.3"
  // or "192.168.1" cannot match.
  {
    regex: /(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})/,
    label: 'Internal IP address',
  },
]
// Global clones so every match on a line is evaluated, not just the first.
for (const p of LEAK_PATTERNS) p.global = new RegExp(p.regex, p.regex.flags + 'g')

/**
 * Explicit allow-list: known-benign matches in shipped files.
 * Every entry MUST carry a reason. Patterns are never loosened to make the
 * check pass — placeholders are allowed, real addresses/secrets are not.
 * Keyed by file + label + exact matched text, so renumbering README lines
 * cannot silently extend an exemption to different content.
 */
const ALLOW = [
  {
    file: 'README.md',
    label: 'Hardcoded password',
    match: "password: 'StrongPass1!'",
    reason: 'Doc example for createSimpleAuth — placeholder credential in a code snippet, not a real secret',
  },
  {
    file: 'README.md',
    label: 'Email address',
    match: 'user@example.com',
    reason: 'RFC 2606 reserved example address in doc snippet, not a real inbox',
  },
  {
    file: 'README.md',
    label: 'Email address',
    match: 'git@github.com',
    reason: 'git-over-SSH clone URL (git clone git@github.com:…), not a contact address',
  },
]

const findings = []
const usedAllow = new Set()

/** Display path relative to the repo root (src/foo.ts, README.md, …). */
function relPath(full) {
  return relative(ROOT, full).split(sep).join('/')
}

function scanFile(full) {
  const file = relPath(full)
  const isRootFile = ROOT_FILES.includes(file)
  if (!isRootFile) {
    if (!SCAN_EXTENSIONS.includes(extname(full))) return
    if (TEST_FILE.test(full)) return
  }

  const lines = readFileSync(full, 'utf-8').split('\n')
  for (const pattern of LEAK_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const seen = new Set()
      for (const m of lines[i].matchAll(pattern.global)) {
        if (seen.has(m[0])) continue
        seen.add(m[0])

        const allowIdx = ALLOW.findIndex(
          (a) => a.file === file && a.label === pattern.label && m[0].includes(a.match),
        )
        if (allowIdx !== -1) {
          usedAllow.add(allowIdx)
          continue
        }
        findings.push({ file, line: i + 1, label: pattern.label })
      }
    }
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue
      walk(full)
      continue
    }
    scanFile(full)
  }
}

walk(SRC)
// Root files npm always ships regardless of the "files" allowlist.
for (const name of ROOT_FILES) {
  const full = join(ROOT, name)
  if (existsSync(full)) scanFile(full)
}

const unusedAllow = ALLOW.filter((_, i) => !usedAllow.has(i))
if (unusedAllow.length > 0) {
  console.warn(`⚠ ${unusedAllow.length} allow-list entr${unusedAllow.length === 1 ? 'y' : 'ies'} no longer matched (stale exemption?):`)
  for (const a of unusedAllow) console.warn(`  ${a.file} — ${a.label} — "${a.match}"`)
}

if (findings.length > 0) {
  console.error('\n❌ SECURITY CHECK FAILED — potential leak detected:\n')
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line} — ${f.label}`)
  }
  console.error('\nFix these before publishing.\n')
  process.exit(1)
} else {
  console.log('✅ Security check passed — no leaks detected.\n')
}
