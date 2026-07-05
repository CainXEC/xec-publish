import { createClient } from '@supabase/supabase-js'

// One-off cleanup: delete every object in the retired `post-audio` storage
// bucket now that the audio-narration feature has been removed.
//
// Run a DRY RUN first (lists what would be deleted, deletes nothing):
//   node --env-file=.env.local scripts/purge-audio-storage.js
//
// Then actually delete:
//   node --env-file=.env.local scripts/purge-audio-storage.js --confirm
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the env file.

const BUCKET = 'post-audio'
const PAGE_SIZE = 1000
const CONFIRM = process.argv.includes('--confirm')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Walk the bucket recursively so nested folders (if any) are covered too.
async function listAllPaths(prefix = '') {
  const paths = []
  let offset = 0
  for (;;) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: PAGE_SIZE, offset })
    if (error) throw new Error(`list "${prefix}": ${error.message}`)
    if (!data || data.length === 0) break

    for (const entry of data) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name
      // A storage "folder" has no id/metadata; recurse into it.
      if (entry.id == null) {
        const nested = await listAllPaths(full)
        paths.push(...nested)
      } else {
        paths.push(full)
      }
    }

    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return paths
}

async function main() {
  const paths = await listAllPaths()
  if (paths.length === 0) {
    console.log(`Bucket "${BUCKET}" is already empty. Nothing to do.`)
    return
  }

  console.log(`Found ${paths.length} object(s) in "${BUCKET}":`)
  for (const p of paths) console.log(`  ${p}`)

  if (!CONFIRM) {
    console.log('\nDRY RUN — nothing deleted. Re-run with --confirm to delete.')
    return
  }

  // Delete in batches of 100 to stay well within API limits.
  let deleted = 0
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100)
    const { error } = await supabase.storage.from(BUCKET).remove(batch)
    if (error) throw new Error(`remove batch @${i}: ${error.message}`)
    deleted += batch.length
    console.log(`Deleted ${deleted}/${paths.length}…`)
  }

  console.log(`\nDone. Removed ${deleted} object(s) from "${BUCKET}".`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
