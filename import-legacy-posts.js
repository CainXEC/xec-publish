#!/usr/bin/env node
/**
 * Legacy post importer for proofofwriting.com
 * 
 * Usage:
 *   1. Place this file in the root of your xec-publish project
 *   2. Place legacy_posts.json (or legacy_posts_test.json) in the same directory
 *   3. Make sure your .env.local has NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *   4. Run: node import-legacy-posts.js [filename]
 *      - Defaults to legacy_posts.json if no filename given
 *      - Use: node import-legacy-posts.js legacy_posts_test.json for a test run
 */

const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

require('dotenv').config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const AUTHOR_ID = '5aa2c328-94f8-4b42-bf44-c2a1ae4db674'

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  const filename = process.argv[2] || 'legacy_posts.json'
  const postsPath = path.join(__dirname, filename)
  
  if (!fs.existsSync(postsPath)) {
    console.error(`${filename} not found in current directory`)
    process.exit(1)
  }

  const posts = JSON.parse(fs.readFileSync(postsPath, 'utf8'))
  console.log(`Loaded ${posts.length} posts from ${filename}`)

  let inserted = 0
  let skipped = 0
  let errors = 0

  for (const post of posts) {
    // Check if slug already exists to avoid duplicates on re-run
    const { data: existing } = await supabase
      .from('posts')
      .select('id')
      .eq('slug', post.slug)
      .maybeSingle()

    if (existing) {
      console.log(`  SKIP (already exists): ${post.slug}`)
      skipped++
      continue
    }

    const { error } = await supabase.from('posts').insert({
      author_id: AUTHOR_ID,
      title: post.title,
      slug: post.slug,
      body: post.body,
      teaser: post.teaser,
      price_xec: post.price_xec,
      reading_time_minutes: post.reading_time_minutes,
      published: true,
      legacy: true,
      published_at: post.published_at,
      created_at: post.published_at,
    })

    if (error) {
      console.error(`  ERROR inserting slug "${post.slug}": ${error.message}`)
      errors++
    } else {
      console.log(`  OK: ${post.slug} — ${post.title}`)
      inserted++
    }
  }

  console.log(`\nDone. Inserted: ${inserted}, Skipped: ${skipped}, Errors: ${errors}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
