// =============================================================================
//  Hermetic tests for sql/search.sql — the search migration and its ONE
//  non-negotiable invariant: text after the paywall marker is physically never
//  written into the search index (otherwise search is a paywall oracle: query
//  distinctive phrases to confirm/reconstruct locked content without paying).
//
//  These tests run the REAL migration file against a scratch Postgres cluster
//  spun up with the locally installed Postgres (initdb/pg_ctl/psql), so they
//  never touch Supabase. If no Postgres >= 15 is installed the suite skips
//  (install with: brew install postgresql@16 — no service needed, the binaries
//  are enough). The address-paste short-circuit is API-layer logic and is
//  covered in tests/unit/searchApi.test.js instead.
// =============================================================================

import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { execFileSync, execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO_ROOT = process.cwd()
const MIN_SCHEMA = path.join(REPO_ROOT, 'tests/sql/search-min-schema.sql')
const MIGRATION = path.join(REPO_ROOT, 'sql/search.sql')

const PAYWALL_MARKER = '<div data-paywall-break="true"></div>'
const DB = 'pow_search_test'

// ---------------------------------------------------------------------------
//  Locate a Postgres >= 15 (regexp_instr requires 15+; Supabase is 15+ too).
// ---------------------------------------------------------------------------
function findPgBinDir() {
  const candidates = []
  if (process.env.PG_TEST_BIN_DIR) candidates.push(process.env.PG_TEST_BIN_DIR)
  try {
    const found = execSync('command -v initdb', { encoding: 'utf8', shell: '/bin/sh' }).trim()
    if (found) candidates.push(path.dirname(found))
  } catch {
    /* not on PATH */
  }
  for (const root of ['/opt/homebrew/opt', '/usr/local/opt']) {
    let entries = []
    try {
      entries = fs.readdirSync(root).filter((n) => n.startsWith('postgresql'))
    } catch {
      continue
    }
    entries.sort().reverse() // highest version first
    for (const name of entries) candidates.push(path.join(root, name, 'bin'))
  }
  try {
    const versions = '/Applications/Postgres.app/Contents/Versions'
    for (const v of fs.readdirSync(versions).sort().reverse()) {
      candidates.push(path.join(versions, v, 'bin'))
    }
  } catch {
    /* no Postgres.app */
  }

  for (const dir of candidates) {
    const hasAll = ['initdb', 'pg_ctl', 'psql'].every((b) => fs.existsSync(path.join(dir, b)))
    if (!hasAll) continue
    try {
      // e.g. "initdb (PostgreSQL) 16.13 (Homebrew)" — take the first number
      // after the product name; suffixes like "(Homebrew)" may follow.
      const out = execFileSync(path.join(dir, 'initdb'), ['--version'], { encoding: 'utf8' })
      const major = parseInt(/\(PostgreSQL\)\s+(\d+)/.exec(out)?.[1] ?? '0', 10)
      if (major >= 15) return dir
    } catch {
      /* try next */
    }
  }
  return null
}

const PG_BIN = findPgBinDir()
const enabled = Boolean(PG_BIN) && process.env.SKIP_SEARCH_DB_TESTS !== '1'
if (!enabled) {
  console.warn(
    '[searchDb.test] skipped: no local Postgres >= 15 found. ' +
      'Install binaries with `brew install postgresql@16` (no service needed), ' +
      'or point PG_TEST_BIN_DIR at a Postgres bin directory.',
  )
}

describe.skipIf(!enabled)('sql/search.sql (hermetic scratch Postgres)', () => {
  let tmpDir
  let dataDir
  let sockDir
  let port
  const psqlBin = PG_BIN ? path.join(PG_BIN, 'psql') : null

  // Without a valid locale in the environment, macOS locale APIs spawn a
  // thread inside the postmaster and it aborts with "postmaster became
  // multithreaded during startup". Pin the C locale for every Postgres call.
  const pgEnv = { ...process.env, LC_ALL: 'C', LANG: 'C' }
  const run = (bin, args) =>
    execFileSync(path.join(PG_BIN, bin), args, { stdio: 'pipe', env: pgEnv, encoding: 'utf8' })

  const baseArgs = () => [
    '-h', sockDir,
    '-p', String(port),
    '-U', 'postgres',
    '-X',
    '-v', 'ON_ERROR_STOP=1',
  ]

  /** Run a SQL string (or apply a file with {file}) against the test DB. */
  function sql(command, { db = DB, file = false } = {}) {
    const args = [...baseArgs(), '-d', db, '-A', '-t', file ? '-f' : '-c', command]
    return execFileSync(psqlBin, args, { encoding: 'utf8', env: pgEnv })
  }

  /** Run a SELECT and get its rows back as parsed JSON objects. */
  function rows(select) {
    const out = sql(`SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (${select}) t;`)
    return JSON.parse(out.trim() || '[]')
  }

  const lit = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`)

  /** Call the unified RPC exactly as the API route does. */
  function searchSite(query, type = null, limit = 20) {
    return rows(
      `SELECT * FROM public.search_site(${lit(query)}, ${lit(type)}, ${Number(limit)})`,
    )
  }

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pow-search-pg-'))
    dataDir = path.join(tmpDir, 'data')
    port = 20000 + (process.pid % 20000)
    // Unix socket paths are capped at ~103 bytes; if the tmpdir is too deep,
    // put just the socket in /tmp (short and world-writable) instead.
    sockDir =
      Buffer.byteLength(path.join(tmpDir, `.s.PGSQL.${port}`)) <= 100
        ? tmpDir
        : fs.mkdtempSync('/tmp/pow-pg-')

    run('initdb', ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '--no-sync', '--encoding=UTF8', '--no-locale'])
    run('pg_ctl', ['-D', dataDir, '-l', path.join(tmpDir, 'pg.log'), '-w', 'start',
      '-o', `-p ${port} -k ${sockDir} -c listen_addresses=`])

    sql(`CREATE DATABASE ${DB};`, { db: 'postgres' })
    sql(MIN_SCHEMA, { file: true })
    // Apply the real migration TWICE: the repo convention is that sql/ files
    // are safe to re-run against a live schema, so re-application is part of
    // what we assert.
    sql(MIGRATION, { file: true })
    sql(MIGRATION, { file: true })

    // -- Fixtures ----------------------------------------------------------
    // Distinctive nonsense phrases so a hit can only come from the intended
    // row: "luminous aurifex canticle" (free) vs "obsidian crypt sigil"
    // (locked) on the same article.
    sql(`
      INSERT INTO public.posts (id, author_id, title, slug, body, published, legacy, price_xec, reading_time_minutes, published_at) VALUES
      ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a1',
       'The Aurifex Chronicle', 'aurifex-chronicle',
       $fix$<p>The luminous aurifex canticle rings at dawn over the rooftops.</p>${PAYWALL_MARKER}<p>The obsidian crypt sigil is buried beneath the chapel floor.</p>$fix$,
       true, false, 500, 3, now()),
      ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000a2',
       'Free Gardening Notes', 'kumquat-notes',
       $fix$<p>Plain public gardening notes about kumquat pruning in winter.</p>$fix$,
       true, false, 0, 1, now()),
      ('00000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-0000000000a3',
       'Unpublished Draft', 'secret-draft',
       $fix$<p>The draftonlyphrase lives in an unpublished draft body.</p>$fix$,
       false, false, 100, 1, NULL),
      ('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-0000000000a4',
       'Vintage Typewriter Ribbons', 'legacy-ribbons',
       $fix$<p>A legacy archive piece about vintage typewriter ribbons.</p>$fix$,
       true, true, 100, 1, now()),
      ('00000000-0000-4000-8000-00000000000e', '00000000-0000-4000-8000-0000000000a5',
       'Quantum Bees Manifesto', 'quantum-bees',
       $fix$<p>Short intro.</p>${PAYWALL_MARKER}<p>sentinelleak hexagon dance protocol continues here.</p>$fix$,
       true, false, 250, 2, now());

      INSERT INTO public.feed_posts (txid, action, content, author_account_id, author_identity, deleted_at) VALUES
      ('feedtx000000000000000000000000000000000000000000000000000000full', 1,
       'stacking sats while drafting aurifex essays on chain', '00000000-0000-4000-8000-0000000000c1', '@aurifex', NULL),
      ('feedtxdead00000000000000000000000000000000000000000000000000gone', 1,
       'deletedghost phrase that must never surface', NULL, 'ecash:qqdeleted', now());

      INSERT INTO public.accounts (id, author_id, display_handle, handle_color) VALUES
      ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', 'aurifex', '#3df0ff'),
      ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000a6', 'simon', NULL),
      ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000a7', 'indonesia', NULL),
      ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000a8', 'rosalind', NULL),
      ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-4000-8000-0000000000a9', NULL, NULL);
    `)
  }, 120_000)

  afterAll(() => {
    try {
      run('pg_ctl', ['-D', dataDir, '-m', 'immediate', 'stop'])
    } catch {
      /* already down */
    }
    for (const dir of new Set([tmpDir, sockDir])) {
      try {
        if (dir) fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        /* tmp cleanup is best-effort */
      }
    }
  })

  // -------------------------------------------------------------------------
  //  1. The paywall-oracle invariant
  // -------------------------------------------------------------------------
  it('indexes the pre-paywall phrase and finds the article', () => {
    const results = searchSite('luminous aurifex canticle')
    const article = results.find((r) => r.result_type === 'article')
    expect(article).toBeDefined()
    expect(article.id).toBe('00000000-0000-4000-8000-00000000000a')
    expect(article.title).toBe('The Aurifex Chronicle')
    expect(article.slug).toBe('aurifex-chronicle')
    expect(article.locked).toBe(true)
  })

  it('returns ZERO results for the post-paywall phrase (RPC level)', () => {
    expect(searchSite('obsidian crypt sigil')).toEqual([])
    expect(searchSite('obsidian')).toEqual([])
    expect(searchSite('"crypt sigil"')).toEqual([])
  })

  it('never writes locked lexemes into the stored tsvector (index level)', () => {
    // Stronger than the RPC assertion: the lexemes are absent from the index
    // itself, so no query path — present or future — can ever surface them.
    const [row] = rows(
      `SELECT search_tsv::text AS tsv FROM public.posts WHERE slug = 'aurifex-chronicle'`,
    )
    expect(row.tsv).toBeTruthy()
    for (const lockedWord of ['obsidian', 'crypt', 'sigil', 'chapel', 'buri']) {
      expect(row.tsv.toLowerCase()).not.toContain(lockedWord)
    }
    expect(row.tsv).toContain('aurifex') // sanity: the free portion IS there

    const [{ n }] = rows(
      `SELECT count(*)::int AS n FROM public.posts
        WHERE search_tsv @@ websearch_to_tsquery('english', 'obsidian crypt sigil')`,
    )
    expect(n).toBe(0)
  })

  it('marks paywalled articles locked and free articles unlocked', () => {
    const [free] = searchSite('kumquat pruning', 'articles')
    expect(free.locked).toBe(false)
    const [paid] = searchSite('aurifex canticle', 'articles')
    expect(paid.locked).toBe(true)
  })

  it('does not surface unpublished drafts', () => {
    expect(searchSite('draftonlyphrase')).toEqual([])
  })

  // -------------------------------------------------------------------------
  //  2. Snippets (ts_headline) run over the free portion only
  // -------------------------------------------------------------------------
  it('ts_headline highlights the hit and never contains post-paywall text', () => {
    const [article] = searchSite('aurifex canticle', 'articles')
    expect(article.snippet).toContain('⟦') // highlight markers present
    expect(article.snippet.toLowerCase()).not.toContain('obsidian')
    expect(article.snippet.toLowerCase()).not.toContain('sigil')
  })

  it('title-only matches still cannot leak the locked body into the snippet', () => {
    // "Quantum Bees Manifesto" matches on the title; the free body is two
    // words; the locked body carries the sentinel. The headline source is the
    // free text, so the sentinel must be unreachable.
    const results = searchSite('quantum bees', 'articles')
    const article = results.find((r) => r.slug === 'quantum-bees')
    expect(article).toBeDefined()
    expect(article.locked).toBe(true)
    expect(String(article.snippet).toLowerCase()).not.toContain('sentinelleak')
  })

  // -------------------------------------------------------------------------
  //  3. Feed posts
  // -------------------------------------------------------------------------
  it('finds feed posts by content and excludes soft-deleted ones', () => {
    const [post] = searchSite('stacking sats', 'posts')
    expect(post).toBeDefined()
    expect(post.id).toBe('feedtx000000000000000000000000000000000000000000000000000000full')
    expect(post.author_identity).toBe('@aurifex')
    expect(searchSite('deletedghost')).toEqual([])
  })

  // -------------------------------------------------------------------------
  //  4. People: fuzzy current-handle matching
  // -------------------------------------------------------------------------
  it('finds a handle through a typo via pg_trgm', () => {
    const typod = searchSite('simmon', 'people')
    expect(typod.map((r) => r.title)).toContain('simon')
    const dropped = searchSite('indonesa', 'people')
    expect(dropped.map((r) => r.title)).toContain('indonesia')
  })

  it('ranks the exact handle first', () => {
    const results = searchSite('simon', 'people')
    expect(results[0].title).toBe('simon')
    expect(results[0].account_id).toBe('00000000-0000-4000-8000-0000000000c2')
  })

  it('stops matching a handle the account no longer displays (former handles are not indexed)', () => {
    // rosalind rebinds to a new handle; the old string must go dark — search
    // follows the CURRENT identity, never the identity history.
    sql(`UPDATE public.accounts SET display_handle = 'walsingham'
          WHERE id = '00000000-0000-4000-8000-0000000000c4'`)
    expect(searchSite('rosalind', 'people')).toEqual([])
    expect(searchSite('rosalind')).toEqual([]) // grouped search: gone everywhere
    const renamed = searchSite('walsingham', 'people')
    expect(renamed.map((r) => r.title)).toContain('walsingham')
  })

  // -------------------------------------------------------------------------
  //  5. Type filters and grouped results
  // -------------------------------------------------------------------------
  it('returns each type only under its filter, and all three grouped by default', () => {
    // 'aurifex' exists as article text, feed content, and a handle.
    const grouped = searchSite('aurifex')
    const types = new Set(grouped.map((r) => r.result_type))
    expect(types).toEqual(new Set(['article', 'post', 'person']))

    for (const [filter, only] of [
      ['articles', 'article'],
      ['posts', 'post'],
      ['people', 'person'],
    ]) {
      const filtered = searchSite('aurifex', filter)
      expect(filtered.length).toBeGreaterThan(0)
      expect(filtered.every((r) => r.result_type === only)).toBe(true)
    }
  })

  it('exposes the legacy flag so the API can route /{slug} vs /posts/{slug}', () => {
    const [legacyHit] = searchSite('vintage typewriter ribbons', 'articles')
    expect(legacyHit.is_legacy).toBe(true)
    const [modernHit] = searchSite('kumquat pruning', 'articles')
    expect(modernHit.is_legacy).toBe(false)
  })

  // -------------------------------------------------------------------------
  //  6. Query-string edge cases
  // -------------------------------------------------------------------------
  it('handles empty, whitespace, and operator-soup queries without erroring', () => {
    expect(searchSite('')).toEqual([])
    expect(searchSite('   ')).toEqual([])
    expect(Array.isArray(searchSite('"unbalanced OR -('))).toBe(true)
    expect(Array.isArray(searchSite("odd'quote %_ \\ chars"))).toBe(true)
  })
})
