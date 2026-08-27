// =============================================================================
//  lib/notifFormat.js
//  Pure formatting/grouping helpers shared by the header bell badge and the
//  /notifications page. No React, no fetching — just shape the rows that
//  lib/feedNotifications.js -> /api/feed/notifications already returns.
// =============================================================================

import { computePaymentSplit } from '@/lib/paymentSplit'

/** The NET XEC the recipient EARNED from a paid action: gross minus the 6%
 *  platform fee, shown with a leading "+". Null for an unpaid/older row. */
export function earnedLabel(amountSats) {
  if (amountSats == null) return null
  const grossXec = Number(amountSats) / 100
  const net = grossXec > 0 ? computePaymentSplit(grossXec)?.authorAmount : null
  return net != null && net > 0 ? `+${net.toLocaleString()} XEC` : null
}

/** The FULL XEC earned, no platform-fee deduction — for actions that pay the
 *  recipient 100% (a direct profile tip). Shown with a leading "+". */
export function grossLabel(amountSats) {
  if (amountSats == null) return null
  const xec = Number(amountSats) / 100
  return xec > 0 ? `+${xec.toLocaleString()} XEC` : null
}

/** The right earned-amount label for a notification type: tips pay 100% (gross),
 *  every other paid action nets out the 6% platform fee. */
export function amountLabelForType(type, amountSats) {
  return type === 'tip' ? grossLabel(amountSats) : earnedLabel(amountSats)
}

export function timeAgo(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function truncateAddress(addr) {
  const t = String(addr ?? '').trim()
  if (t.length <= 16) return t
  return `${t.slice(0, 10)}…${t.slice(-4)}`
}

/** "@handle" shows as-is; a raw address is truncated for the byline. */
export function actorLabel(identity) {
  const id = typeof identity === 'string' ? identity.trim() : ''
  return id.startsWith('@') ? id : truncateAddress(id)
}

const VERB = {
  reply: 'replied to your post',
  quote: 'quoted your post',
  like: 'reacted to your post',
  repost: 'reposted your post',
  follow: 'followed you',
  tip: 'tipped you',
  unlock: 'unlocked your article',
  comment: 'commented on your article',
  comment_like: 'liked your comment',
  mention: 'mentioned you',
}

// The "someone is talking TO you" types: they carry new words aimed at you and
// invite a response. Differentiated in the UI (glyph + accent) from the "someone
// acknowledged you" types (reactions, reposts, likes) which are just a nod.
// The types that populate the "Mentions" notifications tab — someone directed
// words AT you, so they invite a response. Shared by the API route (server-side
// filter) and the client. A 'comment' row covers both a top-level article
// comment and a reply to your comment (isCommentReply), so it needs no separate
// type here.
export const CONVERSATIONAL_TYPES = ['reply', 'quote', 'mention', 'comment']
const CONVERSATIONAL = new Set(CONVERSATIONAL_TYPES)

/** True when the notification is directed AT the recipient with words (a reply,
 *  quote, @mention, or article comment) — as opposed to a reaction/repost/like or
 *  a social/economic event (follow/tip/unlock). Drives the conversational accent. */
export function isConversationalNotif(type) {
  return CONVERSATIONAL.has(type)
}

// A leading gutter glyph per type, so the list scans at a glance. The
// conversational types use "writing" marks (↳ ❝ @); reactions/reposts a lighter
// nod (♡ ↻); the rest a neutral mark. Kept to mono glyphs to fit the terminal
// look (reactions already show their own emoji in the verb line).
const GLYPH = {
  reply: '↳',
  comment: '↳',
  quote: '❝',
  mention: '@',
  like: '♡',
  comment_like: '♡',
  repost: '↻',
  follow: '+',
  tip: '✦',
  unlock: '🔓',
  forum_fee: '◈',
}

/** The gutter glyph for a notification type (falls back to a neutral dot). */
export function notifGlyph(type) {
  return GLYPH[type] ?? '•'
}

/** The verb/action line for one notification (or a group's representative row). */
export function notifText(n) {
  if (n.type === 'offer') {
    const name = n.handle ? `@${n.handle}` : 'your handle'
    return n.offerAmountXec != null
      ? `offered ${Number(n.offerAmountXec).toLocaleString()} XEC for ${name}`
      : `made an offer on ${name}`
  }
  if (n.type === 'offer_listed') {
    const name = n.handle ? `@${n.handle}` : 'a handle you offered on'
    return n.offerAmountXec != null
      ? `listed ${name} at your offer of ${Number(n.offerAmountXec).toLocaleString()} XEC — buy it now`
      : `listed ${name} — buy it now`
  }
  // A "like" is now an emoji reaction. Show the emoji on a single row
  // ("reacted 🔥 to your post"); grouped rows drop it ("… reacted to your post").
  if (n.type === 'like') {
    return n.emoji ? `reacted ${n.emoji} to your post` : 'reacted to your post'
  }
  if (n.type === 'repost') return VERB[n.type]
  if (n.type === 'tip') return VERB.tip
  if (n.type === 'reply') return VERB.reply
  // The runner's forum-engagement earning — a reaction (emoji set) or a reply
  // (no emoji) to a post in their forum. The "· N XEC" amount line shows the cut.
  if (n.type === 'forum_fee') {
    return n.emoji ? `reacted ${n.emoji} in your forum` : 'replied in your forum'
  }
  // Comment vs. a reply to an existing comment thread — isCommentReply is
  // decorated server-side (comments.parent_id present).
  if (n.type === 'comment') {
    if (n.isCommentReply) return 'replied to your comment'
    return n.articleTitle ? `commented on “${n.articleTitle}”` : VERB.comment
  }
  if (n.type === 'comment_like') {
    return n.articleTitle ? `liked your comment on “${n.articleTitle}”` : VERB.comment_like
  }
  if (n.type === 'unlock') {
    return n.articleTitle ? `unlocked “${n.articleTitle}”` : VERB.unlock
  }
  // A mention in an article names it ("mentioned you in <Title>"); a mention in a
  // COMMENT (article-decorated AND carrying the comment's action_txid) says so; a
  // feed mention shows the post text inline below, so the verb stays bare.
  if (n.type === 'mention') {
    if (n.articleTitle || n.articleHref) {
      if (n.action_txid) {
        return n.articleTitle
          ? `mentioned you in a comment on “${n.articleTitle}”`
          : 'mentioned you in a comment'
      }
      return n.articleTitle ? `mentioned you in “${n.articleTitle}”` : VERB.mention
    }
    return VERB.mention
  }
  return VERB[n.type] ?? 'interacted with your post'
}

// Reply/quote/like/repost open the target post's thread; a follow opens the
// follower's profile; an offer opens the marketplace on that handle's card.
export function targetHref(n) {
  // Follow and tip both come FROM a person with no post to open — link to the
  // actor's profile so the recipient can see (and thank / tip back) who it was.
  if (n.type === 'follow' || n.type === 'tip') {
    const id = String(n.actor_identity ?? '').replace(/^@/, '').trim()
    return id ? `/@${encodeURIComponent(id)}` : '#'
  }
  if (n.type === 'offer') {
    return n.handle
      ? `/marketplace?view=all&q=${encodeURIComponent(n.handle)}`
      : '/marketplace?view=all'
  }
  // "Your offer was listed" opens the FOR-SALE view on that handle — the card
  // there carries the Buy button, so the bidder can complete the purchase.
  if (n.type === 'offer_listed') {
    return n.handle
      ? `/marketplace?view=forsale&q=${encodeURIComponent(n.handle)}`
      : '/marketplace?view=forsale'
  }
  if (n.type === 'comment_like') {
    return n.articleHref ? `${n.articleHref}#comments` : '#'
  }
  if (n.type === 'unlock' || n.type === 'comment') {
    return n.articleHref ?? '#'
  }
  // A mention: a COMMENT mention opens the article's comments (articleHref +
  // action_txid); an article-BODY mention opens the article; a feed mention opens
  // the feed post (post_txid is the post's own 64-hex txid). articleHref is only
  // set for article-context mentions.
  if (n.type === 'mention') {
    if (n.articleHref) return n.action_txid ? `${n.articleHref}#comments` : n.articleHref
    return n.post_txid && /^[0-9a-f]{64}$/i.test(n.post_txid) ? `/feed/${n.post_txid}` : '#'
  }
  return n.post_txid ? `/feed/${n.post_txid}` : '#'
}

/** Types with no unique per-row payload worth collapsing — X-style "A, B and 3
 *  others liked your post" instead of a flooded list. Reply/quote/comment/offer
 *  each carry their own text or amount, so they always stay one row. */
const GROUPABLE_TYPES = new Set(['like', 'repost', 'follow'])

/**
 * Collapse consecutive groupable rows (same type, and — except 'follow', which
 * has no target — the same post_txid) into one group. Every OTHER row becomes
 * its own single-item group. Only merges ADJACENT rows (the list is already
 * newest-first), so a like from an hour ago never jumps into today's group.
 * @param {object[]} items
 * @returns {{ id: string, type: string, post_txid: string|null, read: boolean,
 *             created_at: string, items: object[] }[]}
 */
export function groupNotifications(items) {
  const groups = []
  for (const n of items ?? []) {
    const groupable = GROUPABLE_TYPES.has(n.type)
    const last = groups[groups.length - 1]
    const sameBucket =
      groupable &&
      last &&
      last.type === n.type &&
      (n.type === 'follow' || last.post_txid === n.post_txid) &&
      last.read === n.read
    if (sameBucket) {
      last.items.push(n)
    } else {
      groups.push({
        id: n.id,
        type: n.type,
        post_txid: n.post_txid ?? null,
        targetContent: n.targetContent,
        read: n.read,
        created_at: n.created_at,
        items: [n],
      })
    }
  }
  return groups
}
