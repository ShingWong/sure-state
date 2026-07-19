/**
 * Pre-publish security check.
 * Scans source files for common leakage patterns and exits non-zero if found.
 *
 * Run via: `npx tsx scripts/security-check.ts`
 * Or as part of `prepublishOnly` in package.json.
 */

import { readFileSync, existsSync } from 'fs'
import { readdirSync, statSync } from 'fs'
import { join, extname } from 'path'

const SRC = join(import.meta.dirname, '..', 'src')

const LEAK_PATTERNS: { regex: RegExp; label: string }[] = [
  { regex: /(?:AKIA[0-9A-Z]{16}|sk-[a-zA-Z0-9]{32,})/, label: 'AWS secret key or OpenAI token' },
  { regex: /(?:ghp_|gho_|github_pat_)[a-zA-Z0-9_]{36,}/, label: 'GitHub token' },
  { regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, label: 'Private key' },
  { regex: /password\s*[:=]\s*['"][^'"]+['"]/i, label: 'Hardcoded password' },
  { regex: /(?:info@|@\w+\.\w{2,})/, label: 'Email address' },
  { regex: /\/usr\/local\/devel\//, label: 'Internal filesystem path' },
  { regex: /(?:192\.168\.|10\.\d+\.|172\.(?:1[6-9]|2\d|3[01])\.)/, label: 'Internal IP address' },
]

interface Finding {
  file: string
  line: number
  label: string
}

const findings: Finding[] = []

function walk(dir: string) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue
      walk(full)
      continue
    }

    const ext = extname(full)
    if (!['.ts', '.tsx', '.js', '.json', '.md', '.yml', '.yaml'].includes(ext)) continue

    const content = readFileSync(full, 'utf-8')
    const lines = content.split('\n')

    for (const pattern of LEAK_PATTERNS) {
      for (let i = 0; i < lines.length; i++) {
        if (pattern.regex.test(lines[i]!)) {
          findings.push({ file: full.replace(SRC + '/', ''), line: i + 1, label: pattern.label })
        }
      }
    }
  }
}

walk(SRC)

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
