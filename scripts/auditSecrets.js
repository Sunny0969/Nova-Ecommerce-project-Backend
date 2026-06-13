#!/usr/bin/env node
/**
 * Scan tracked source files for accidentally committed secrets.
 * Run: npm run audit:secrets
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const PATTERNS = [
  { name: 'MongoDB URI with credentials', re: /mongodb(\+srv)?:\/\/[^\s'"]+:[^\s'"]+@/gi },
  { name: 'Stripe secret key', re: /sk_(live|test)_[A-Za-z0-9]{16,}/g },
  { name: 'Stripe webhook secret', re: /whsec_[A-Za-z0-9]{16,}/g },
  { name: 'Resend API key', re: /re_[A-Za-z0-9]{20,}/g },
  { name: 'OpenAI API key', re: /sk-[A-Za-z0-9]{20,}/g },
  { name: 'Hugging Face API key', re: /hf_[A-Za-z0-9]{20,}/g },
  { name: 'Cloudinary API secret in code', re: /CLOUDINARY_API_SECRET\s*=\s*['"][^'"]+['"]/gi }
];

const ALLOWLIST = new Set([
  'scripts/auditSecrets.js',
  'railway.env.example',
  '.env.example'
]);

const SCAN_DIRS = ['lib', 'routes', 'services', 'middleware', 'models', 'scripts'];
const SCAN_FILES = ['server.js'];

function listFiles(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full);
      } else if (/\.(js|jsx|ts|tsx|ps1|sh|json|env)$/i.test(entry.name)) {
        out.push(path.relative(ROOT, full).replace(/\\/g, '/'));
      }
    }
  };
  walk(abs);
  return out;
}

function scanFile(relPath, content) {
  const hits = [];
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    if (re.test(content)) {
      hits.push(name);
    }
  }
  return hits;
}

function main() {
  const files = [
    ...SCAN_FILES,
    ...SCAN_DIRS.flatMap(listFiles)
  ].filter((f) => !ALLOWLIST.has(f));

  const findings = [];
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, 'utf8');
    const hits = scanFile(rel, content);
    if (hits.length) findings.push({ file: rel, hits });
  }

  let gitPs1 = [];
  try {
    const tracked = execSync('git ls-files "*.ps1"', { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    gitPs1 = tracked;
  } catch {
    /* not a git repo */
  }

  for (const rel of gitPs1) {
    if (rel.includes('node_modules')) continue;
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, 'utf8');
    const hits = scanFile(rel, content);
    if (hits.length) findings.push({ file: rel, hits });
  }

  if (!findings.length) {
    console.log('[audit:secrets] No hardcoded secrets detected in backend source.');
    process.exit(0);
  }

  console.error('[audit:secrets] Possible secrets found in code — move to Railway Variables / .env:');
  for (const { file, hits } of findings) {
    console.error(`  - ${file}: ${[...new Set(hits)].join(', ')}`);
  }
  process.exit(1);
}

main();
