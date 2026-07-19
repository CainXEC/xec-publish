// =============================================================================
//  Hermetic test for the house/AI-account exclusion in the ranking signals:
//    • sql/feed_engagement_signal.sql  — is_ai SUPPORTERS (a herald's likes /
//      reposts / paid replies) must add neither breadth nor amount to a post's
//      engagement signal, exactly like a self/alt-ring reaction.
//    • sql/rpc_get_unlock_counts.sql   — is_ai UNLOCKERS (a patron's grants) must
//      NOT inflate a post's public reader count …
//    • sql/rpc_get_unlock_earnings.sql — … while earnings KEEP them, because that
//      is real money the author received. Reach is filtered; money is not.
//
//  Runs the REAL migration files against a scratch Postgres cluster spun up with
//  the locally installed Postgres (initdb/pg_ctl/psql), so it never touches
//  Supabase. If no Postgres >= 15 is installed the suite skips (install with:
//  brew install postgresql@16 — no service needed, the binaries are enough).
//  The harness mirrors tests/integration/searchDb.test.js.
// =============================================================================

import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { execFileSync, execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO_ROOT = process.cwd()
const MIN_SCHEMA = path.join(REPO_ROOT, 'tests/sql/engagement-min-schema.sql')
const MIGRATIONS = [
  path.join(REPO_ROOT, 'sql/feed_engagement_signal.sql'),
  path.join(REPO_ROOT, 'sql/rpc_get_unlock_counts.sql'),
  path.join(REPO_ROOT, 'sql/rpc_get_unlock_earnings.sql'),
]
const DB = 'pow_engagement_test'

// ---------------------------------------------------------------------------
//  Locate a Postgres >= 15 (matches Supabase; same probe as searchDb.test.js).
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
const enabled = Boolean(PG_BIN) && process.env.SKIP_ENGAGEMENT_DB_TESTS !== '1'
if (!enabled) {
  console.warn(
    '[feedEngagementSignalDb.test] skipped: no local Postgres >= 15 found. ' +
      'Install binaries with `brew install postgresql@16` (no service needed), ' +
      'or point PG_TEST_BIN_DIR at a Postgres bin directory.',
  )
}

describe.skipIf(!enabled)('house/AI exclusion from ranking signals (hermetic scratch Postgres)', () => {
  let tmpDir
  let dataDir
  let sockDir
  let port
  const psqlBin = PG_BIN ? path.join(PG_BIN, 'psql') : null

  // Pin the C locale, or macOS locale APIs make the postmaster multithreaded and
  // it aborts on startup (same guard as searchDb.test.js).
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
  const textArray = (arr) => `ARRAY[${arr.map(lit).join(',')}]::text[]`
  const uuidArray = (arr) => `ARRAY[${arr.map(lit).join(',')}]::uuid[]`

  // -- RPC call helpers (invoked exactly as the app calls them) --------------
  const signal = (txids) =>
    rows(`SELECT * FROM public.get_feed_engagement_signal(${textArray(txids)})`)
  const unlockCounts = (ids) =>
    rows(`SELECT * FROM public.get_unlock_counts(${uuidArray(ids)}, NULL)`)
  const unlockEarnings = (ids) =>
    rows(`SELECT * FROM public.get_unlock_earnings(${uuidArray(ids)}, NULL)`)

  // -- Fixture ids (readable suffixes) ---------------------------------------
  const AUTH = {
    a:  '00000000-0000-4000-8000-0000000000a1', // post author (human)
    b:  '00000000-0000-4000-8000-0000000000a2', // real supporter #1
    h:  '00000000-0000-4000-8000-0000000000a3', // herald  (is_ai)
    h2: '00000000-0000-4000-8000-0000000000a4', // herald2 (is_ai)
    c:  '00000000-0000-4000-8000-0000000000a5', // real supporter #2
    r:  '00000000-0000-4000-8000-0000000000a6', // real reader (address-linked)
    p:  '00000000-0000-4000-8000-0000000000a7', // patron  (is_ai, linked wallet)
    p2: '00000000-0000-4000-8000-0000000000a8', // patron2 (is_ai, payout wallet only)
  }
  const ACC = {
    a:  '00000000-0000-4000-8000-0000000000b1',
    b:  '00000000-0000-4000-8000-0000000000b2',
    h:  '00000000-0000-4000-8000-0000000000b3',
    h2: '00000000-0000-4000-8000-0000000000b4',
    c:  '00000000-0000-4000-8000-0000000000b5',
    r:  '00000000-0000-4000-8000-0000000000b6',
    p:  '00000000-0000-4000-8000-0000000000b7',
    // AUTH.p2 has NO account — its address lives only in authors.xec_address.
  }
  const POST0 = 'post00000000000000000000000000000000000000000000000000000000post'
  const PID = '00000000-0000-4000-8000-0000000000d1' // an article id (unlocks.post_id)

  // Realistic wallet forms: unlocks.payer_address always arrives 'ecash:'-prefixed
  // (encodeOutputScript), while account_addresses may store either form — so the
  // patron's linked wallet is stored BARE on purpose, to exercise normalization.
  const ADDR = {
    realReader:   'ecash:qrealreader00000000000000000000000000000',
    patronBare:   'qpatronwallet000000000000000000000000000000',       // stored bare
    patronPaid:   'ecash:qpatronwallet000000000000000000000000000000', // paid prefixed
    patron2Payout:'ecash:qpatrontwopayout00000000000000000000000',
    realReader2:  'ecash:qrealreadertwo0000000000000000000000000',     // never account-linked
  }

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pow-engagement-pg-'))
    dataDir = path.join(tmpDir, 'data')
    port = 20000 + ((process.pid + 7) % 20000) // offset from searchDb's port
    sockDir =
      Buffer.byteLength(path.join(tmpDir, `.s.PGSQL.${port}`)) <= 100
        ? tmpDir
        : fs.mkdtempSync('/tmp/pow-pg-')

    run('initdb', ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '--no-sync', '--encoding=UTF8', '--no-locale'])
    run('pg_ctl', ['-D', dataDir, '-l', path.join(tmpDir, 'pg.log'), '-w', 'start',
      '-o', `-p ${port} -k ${sockDir} -c listen_addresses=`])

    sql(`CREATE DATABASE ${DB};`, { db: 'postgres' })
    sql(MIN_SCHEMA, { file: true })
    // Apply each migration TWICE — repo convention is that sql/ files are safe to
    // re-run against a live schema, and re-application is part of what we assert.
    for (const m of MIGRATIONS) {
      sql(m, { file: true })
      sql(m, { file: true })
    }

    // -- Static fixtures: identities + the post being reacted to --------------
    sql(`
      INSERT INTO public.authors (id, xec_address, is_ai) VALUES
        (${lit(AUTH.a)},  NULL,                       false),
        (${lit(AUTH.b)},  NULL,                       false),
        (${lit(AUTH.h)},  NULL,                       true),
        (${lit(AUTH.h2)}, NULL,                       true),
        (${lit(AUTH.c)},  NULL,                       false),
        (${lit(AUTH.r)},  NULL,                       false),
        (${lit(AUTH.p)},  NULL,                       true),
        (${lit(AUTH.p2)}, ${lit(ADDR.patron2Payout)}, true);

      INSERT INTO public.accounts (id, author_id) VALUES
        (${lit(ACC.a)},  ${lit(AUTH.a)}),
        (${lit(ACC.b)},  ${lit(AUTH.b)}),
        (${lit(ACC.h)},  ${lit(AUTH.h)}),
        (${lit(ACC.h2)}, ${lit(AUTH.h2)}),
        (${lit(ACC.c)},  ${lit(AUTH.c)}),
        (${lit(ACC.r)},  ${lit(AUTH.r)}),
        (${lit(ACC.p)},  ${lit(AUTH.p)});

      INSERT INTO public.account_addresses (account_id, address, is_primary) VALUES
        (${lit(ACC.r)}, ${lit(ADDR.realReader)}, true),
        (${lit(ACC.p)}, ${lit(ADDR.patronBare)}, true);

      INSERT INTO public.feed_posts (txid, action, author_account_id, amount_sats) VALUES
        (${lit(POST0)}, 1, ${lit(ACC.a)}, 0);
    `)
  })

  afterAll(() => {
    try {
      if (PG_BIN && dataDir) run('pg_ctl', ['-D', dataDir, '-m', 'immediate', '-w', 'stop'])
    } catch {
      /* already down */
    }
    try {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
    if (sockDir && sockDir.startsWith('/tmp/pow-pg-')) {
      try {
        fs.rmSync(sockDir, { recursive: true, force: true })
      } catch {
        /* best-effort */
      }
    }
  })

  // Insert a paid like (feed_events, action 5) targeting POST0.
  const like = (txid, actorAccountId, amount) =>
    sql(`INSERT INTO public.feed_events (txid, action, target_txid, actor_account_id, amount_sats)
         VALUES (${lit(txid)}, 5, ${lit(POST0)}, ${lit(actorAccountId)}, ${amount});`)
  // Insert a paid reply (feed_posts, action 2) whose parent is POST0.
  const reply = (txid, authorAccountId, amount) =>
    sql(`INSERT INTO public.feed_posts (txid, action, parent_txid, author_account_id, amount_sats)
         VALUES (${lit(txid)}, 2, ${lit(POST0)}, ${lit(authorAccountId)}, ${amount});`)
  // Insert an article unlock (unlocks) for PID.
  const unlock = (txid, payer, amount) =>
    sql(`INSERT INTO public.unlocks (post_id, txid, payer_address, amount_xec)
         VALUES (${lit(PID)}, ${lit(txid)}, ${lit(payer)}, ${amount});`)

  const one = (arr) => (arr.length === 1 ? arr[0] : null)

  it('feed engagement signal: is_ai supporters (likes/reposts/replies) add no breadth or amount', () => {
    // No reactions yet → the post is simply absent from the signal.
    expect(signal([POST0])).toEqual([])

    // A real supporter likes it (100 sats): breadth 1, amount 100.
    like('evt-b-like', ACC.b, 100)
    let s = one(signal([POST0]))
    expect(s).not.toBeNull()
    expect(Number(s.distinct_supporters)).toBe(1)
    expect(Number(s.total_amount_sats)).toBe(100)

    // The herald (is_ai) likes it too — a REAL 100-sat payment, visible on-chain.
    // The signal must NOT move: still breadth 1, amount 100.
    like('evt-h-like', ACC.h, 100)
    s = one(signal([POST0]))
    expect(Number(s.distinct_supporters)).toBe(1)
    expect(Number(s.total_amount_sats)).toBe(100)

    // A second is_ai herald piles on. Still no movement — the whole house cluster
    // is invisible to rank no matter how many agents react.
    like('evt-h2-like', ACC.h2, 100)
    s = one(signal([POST0]))
    expect(Number(s.distinct_supporters)).toBe(1)
    expect(Number(s.total_amount_sats)).toBe(100)

    // Guard against a vacuous test: a NEW HUMAN supporter DOES move it (breadth 2).
    like('evt-c-like', ACC.c, 100)
    s = one(signal([POST0]))
    expect(Number(s.distinct_supporters)).toBe(2)
    expect(Number(s.total_amount_sats)).toBe(200)

    // The exclusion also covers the paid-reply/quote branch of the signal.
    // An is_ai reply (250 sats) adds nothing…
    reply('reply-h-onpost', ACC.h, 250)
    s = one(signal([POST0]))
    expect(Number(s.distinct_supporters)).toBe(2)
    expect(Number(s.total_amount_sats)).toBe(200)

    // …while a human reply (50 sats) counts as both breadth (3) and amount (250).
    reply('reply-r-onpost', ACC.r, 50)
    s = one(signal([POST0]))
    expect(Number(s.distinct_supporters)).toBe(3)
    expect(Number(s.total_amount_sats)).toBe(250)
  })

  it('unlock counts exclude is_ai readers (reach), while earnings keep them (money)', () => {
    // A real reader unlocks (500 XEC): 1 reader, 500 earned.
    unlock('unlk-r', ADDR.realReader, 500)
    expect(Number(one(unlockCounts([PID])).count)).toBe(1)
    expect(Number(one(unlockEarnings([PID])).total_amount)).toBe(500)

    // The patron (is_ai, linked wallet stored BARE, paid 'ecash:'-prefixed) grants
    // a 700-XEC unlock. Reader count must NOT move (still 1) — normalization must
    // still resolve the prefixed payer to the bare linked address …
    unlock('unlk-p', ADDR.patronPaid, 700)
    expect(Number(one(unlockCounts([PID])).count)).toBe(1)
    // … but earnings DO include it: the author really received 500 + 700.
    expect(Number(one(unlockEarnings([PID])).total_amount)).toBe(1200)

    // A second patron whose address lives only in authors.xec_address (no account
    // link) is excluded too — proving the payout-wallet fallback branch.
    unlock('unlk-p2', ADDR.patron2Payout, 900)
    expect(Number(one(unlockCounts([PID])).count)).toBe(1)
    expect(Number(one(unlockEarnings([PID])).total_amount)).toBe(2100)

    // Guard against a vacuous test: another HUMAN reader (unlinked payer, treated
    // as non-AI) DOES bump the count to 2.
    unlock('unlk-r2', ADDR.realReader2, 300)
    expect(Number(one(unlockCounts([PID])).count)).toBe(2)
    expect(Number(one(unlockEarnings([PID])).total_amount)).toBe(2400)
  })
})
