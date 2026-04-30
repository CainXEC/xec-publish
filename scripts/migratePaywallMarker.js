import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const MARKER = '<div data-paywall-break="true"></div>'

async function migrate() {
  const { data: posts, error } = await supabase
    .from('posts')
    .select('id, title, teaser, body')
    .not('teaser', 'is', null)
    .neq('teaser', '')

  if (error) {
    console.error(error)
    process.exit(1)
  }

  console.log(`Migrating ${posts.length} posts...`)

  for (const post of posts) {
    if (post.body?.includes('data-paywall-break')) {
      console.log(`Skipping ${post.id} — already has marker`)
      continue
    }

    const teaser = typeof post.teaser === 'string' ? post.teaser.trim() : ''
    const teaserHtml = teaser.startsWith('<') ? teaser : `<p>${teaser}</p>`
    const newBody = `${teaserHtml}${MARKER}${post.body ?? ''}`

    const { error: updateError } = await supabase
      .from('posts')
      .update({ body: newBody })
      .eq('id', post.id)

    if (updateError) {
      console.error(`Failed to migrate ${post.id}:`, updateError.message)
    } else {
      console.log(`Migrated: ${post.title}`)
    }
  }

  console.log('Migration complete.')
}

migrate()
