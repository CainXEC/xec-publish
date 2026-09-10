// =============================================================================
//  Hermetic test for sql/forum_deep_reply_count.sql — a forum post's
//  reply_count must be the DEEP total (every nested reply anywhere under it),
//  matching what the forum thread page renders via getFeedThread's `deep`
//  flat descendant list; a plain (non-forum) feed reply keeps the original
//  direct-children-only count, since a feed thread page only ever shows one
//  level of replies.
//
//  Runs the REAL migration files (feed_reaction_counts.sql, then this one —
//  the true production upgrade order) against a scratch Postgres cluster, so
//  it never touches Supabase. Mirrors tests/integration/searchDb.test.js.
// =============================================================================

import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { execFileSync, execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO_ROOT = process.cwd()
const MIN_SCHEMA = path.join(REPO_ROOT, 'tests/sql/forum-reply-count-min-schema.sql')
const MIGRATIONS = [
  path.join(REPO_ROOT, 'sql/feed_reaction_counts.sql'),
  path.join(REPO_ROOT, 'sql/forum_deep_reply_count.sql'),
]
const DB = 'pow_forum_reply_count_test'

// ---------------------------------------------------------------------------
//  Locate a Postgres >= 15 (same probe as searchDb.test.js).
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
    entries.sort().reverse()
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
const enabled = Boolean(PG_BIN) && process.env.SKIP_FORUM_REPLY_COUNT_DB_TESTS !== '1'
if (!enabled) {
  console.warn(
    '[forumReplyCountDb.test] skipped: no local Postgres >= 15 found. ' +
      'Install binaries with `brew install postgresql@16` (no service needed), ' +
      'or point PG_TEST_BIN_DIR at a Postgres bin directory.',
  )
}

describe.skipIf(!enabled)('sql/forum_deep_reply_count.sql (hermetic scratch Postgres)', () => {
  let tmpDir
  let dataDir
  let sockDir
  let port
  const psqlBin = PG_BIN ? path.join(PG_BIN, 'psql') : null

  const pgEnv = { ...process.env, LC_ALL: 'C', LANG: 'C' }
  const run = (bin, args) =>
    execFileSync(path.join(PG_BIN, bin), args, { stdio: 'pipe', env: pgEnv, encoding: 'utf8' })

  const baseArgs = () => ['-h', sockDir, '-p', String(port), '-U', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1']

  function sql(command, { db = DB, file = false } = {}) {
    const args = [...baseArgs(), '-d', db, '-A', '-t', file ? '-f' : '-c', command]
    return execFileSync(psqlBin, args, { encoding: 'utf8', env: pgEnv })
  }

  function rows(select) {
    const out = sql(`SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (${select}) t;`)
    return JSON.parse(out.trim() || '[]')
  }

  const replyCountOf = (txid) => rows(`SELECT reply_count FROM public.feed_posts WHERE txid = '${txid}'`)[0]?.reply_count

  // -- Fixture forum + a 4-deep chain (R -> A -> B -> C) with a sibling D off
  //    R, and an E that's already deleted at insert time. Plus a parallel
  //    non-forum chain (R2 -> A2 -> B2) to prove that path is unchanged. --
  const FORUM_ID = '00000000-0000-4000-8000-00000000f001'
  const R = 'r'.repeat(64), A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64)
  const D = 'd'.repeat(64), E = 'e'.repeat(64)
  const R2 = '2'.repeat(64), A2 = '3'.repeat(64), B2 = '4'.repeat(64)

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pow-forum-reply-pg-'))
    dataDir = path.join(tmpDir, 'data')
    port = 21000 + (process.pid % 10000)
    sockDir =
      Buffer.byteLength(path.join(tmpDir, `.s.PGSQL.${port}`)) <= 100
        ? tmpDir
        : fs.mkdtempSync('/tmp/pow-forum-reply-pg-')

    run('initdb', ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '--no-sync', '--encoding=UTF8', '--no-locale'])
    run('pg_ctl', ['-D', dataDir, '-l', path.join(tmpDir, 'pg.log'), '-w', 'start',
      '-o', `-p ${port} -k ${sockDir} -c listen_addresses=`])

    sql(`CREATE DATABASE ${DB};`, { db: 'postgres' })
    sql(MIN_SCHEMA, { file: true })
    for (const m of MIGRATIONS) sql(m, { file: true })

    sql(`
      INSERT INTO public.feed_posts (txid, action, parent_txid, forum_id, deleted_at) VALUES
      ('${R}', 1, NULL, '${FORUM_ID}', NULL),
      ('${A}', 2, '${R}', '${FORUM_ID}', NULL),
      ('${B}', 2, '${A}', '${FORUM_ID}', NULL),
      ('${C}', 2, '${B}', '${FORUM_ID}', NULL),
      ('${D}', 2, '${R}', '${FORUM_ID}', NULL),
      ('${E}', 2, '${A}', '${FORUM_ID}', now()),
      ('${R2}', 1, NULL, NULL, NULL),
      ('${A2}', 2, '${R2}', NULL, NULL),
      ('${B2}', 2, '${A2}', NULL, NULL);
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
        /* best-effort */
      }
    }
  })

  it('counts a forum post\'s WHOLE nested subtree, not just direct children', () => {
    expect(replyCountOf(R)).toBe(4) // A, B, C, D (E is already-deleted, excluded)
    expect(replyCountOf(A)).toBe(2) // B, C
    expect(replyCountOf(B)).toBe(1) // C
    expect(replyCountOf(C)).toBe(0)
    expect(replyCountOf(D)).toBe(0)
  })

  it('keeps a plain feed reply chain on direct-children-only counting', () => {
    expect(replyCountOf(R2)).toBe(1) // A2 only — B2 doesn't count toward the grandparent
    expect(replyCountOf(A2)).toBe(1) // B2
    expect(replyCountOf(B2)).toBe(0)
  })

  it('soft-deleting a leaf reply refreshes every ancestor up to the root', () => {
    sql(`UPDATE public.feed_posts SET deleted_at = now() WHERE txid = '${C}';`)
    expect(replyCountOf(B)).toBe(0)
    expect(replyCountOf(A)).toBe(1) // B only, C excluded
    expect(replyCountOf(R)).toBe(3) // A, B, D
  })

  it('undeleting restores the whole ancestor chain', () => {
    sql(`UPDATE public.feed_posts SET deleted_at = NULL WHERE txid = '${C}';`)
    expect(replyCountOf(B)).toBe(1)
    expect(replyCountOf(A)).toBe(2)
    expect(replyCountOf(R)).toBe(4)
  })

  it('hard-deleting a reply refreshes its ancestors, leaving an unrelated subtree untouched', () => {
    sql(`DELETE FROM public.feed_posts WHERE txid = '${D}';`)
    expect(replyCountOf(R)).toBe(3) // A, B, C — D is gone
    expect(replyCountOf(A)).toBe(2) // unaffected — D was R's child, not A's
    expect(replyCountOf(B)).toBe(1)
    expect(replyCountOf(C)).toBe(0)
  })

  it('the backfill is idempotent and self-heals corrupted counters', () => {
    // Corrupt every counter directly (bypasses the trigger — it only fires on
    // INSERT/DELETE/UPDATE OF deleted_at, never on a bare reply_count write).
    sql(`UPDATE public.feed_posts SET reply_count = 999;`)
    expect(replyCountOf(R)).toBe(999)

    sql(MIGRATIONS[1], { file: true }) // re-apply just the new migration
    expect(replyCountOf(R)).toBe(3)
    expect(replyCountOf(A)).toBe(2)
    expect(replyCountOf(B)).toBe(1)
    expect(replyCountOf(C)).toBe(0)
    expect(replyCountOf(R2)).toBe(1)
    expect(replyCountOf(A2)).toBe(1)
    expect(replyCountOf(B2)).toBe(0)
  })
})
