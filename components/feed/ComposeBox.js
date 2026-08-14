'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { priceFeedPost, FEED_MAX_CHARS } from '@/lib/feedPricing'
import QuotedEmbed from '@/components/feed/QuotedEmbed'
import EmojiPicker from '@/components/EmojiPicker'
import EcashIcon from '@/components/EcashIcon'
import { useMentionSuggest } from '@/components/feed/useMentionSuggest'
import { prewarmPaymentWatch } from '@/lib/ecash/watchPaymentAddress'
import { pollUntil } from '@/lib/ecash/pollUntil'
// Pocket-aware gateway: identical contract to the cashtabPay trio. Pocket
// eligible → local sign + instant broadcast (r.txid feeds the confirm poll);
// otherwise the exact extension/web-tab behavior this file always had.
import { beginPayment, completePayment, abortPayment } from '@/lib/pocket/payGateway'
import { getPocketSnapshot } from '@/lib/pocket/store'
import { FEED_ACTION } from '@/lib/feedProtocol'
import { confirmFeedPostInBackground } from '@/lib/feed/confirmFeedPost'

// Top-of-feed placeholders: posting here costs real XEC, so the prompts lean
// into "make it worth it" and the proof-of-writing name instead of a generic
// "what's happening?". One is picked at random per mount (see below) for a
// living-terminal feel. Reply/quote/poll composers keep their own contextual
// placeholders — this set is only the main composer's fallback.
const FEED_PLACEHOLDERS = [
  'Say something worth paying for…',
  'Prove it in writing…',
  'What’s worth writing?',
  'Pay it forward…',
  'Your words don’t go on-chain, but their proof does…',
  'Payments for likes, unlocks, replies, and reposts go 94% to the original poster…',
]

/**
 * Compose + pay flow for a feed post, reply, or quote. Shared by the top-of-feed
 * composer (action="post"), inline reply composers (action="reply"), and the
 * quote composer (action="quote", with quotedTxid + quotedPost for the preview).
 *
 * Flow: type → POST /api/feed/prepare (returns BIP21 + Cashtab link) → user pays
 * in Cashtab → we poll POST /api/feed/confirm until the on-chain payment is
 * detected and the post is recorded, then call onPosted(post).
 */
export default function ComposeBox({
  action = 'post',
  parentTxid = null,
  quotedTxid = null,
  quotedPost = null,
  onPosted,
  onCancel,
  compact = false,
  autoFocus = false,
  placeholder,
  initialContent = '',
  // Opt-in: show the post OPTIMISTICALLY the moment the payment broadcasts, before
  // the server records it. Enabled for the top-of-feed composer AND inline
  // reply/quote boxes — those unmount when they close, but the optimistic path
  // hands recording to confirmFeedPostInBackground (a DETACHED poll that survives
  // the unmount), so the reply/quote still records. Only fires when a txid is in
  // hand at broadcast (Pocket or the Cashtab extension); the web-tab path has no
  // txid until the chain shows it, so it stays on the in-component confirm poll.
  allowOptimistic = false,
}) {
  const [content, setContent] = useState(initialContent)
  // Rotating main-composer placeholder. Seed with a STABLE default so SSR and the
  // first client render agree (no hydration mismatch), then pick a random line on
  // mount. Placeholders only show on an empty field, so the swap is invisible.
  const [feedPlaceholder, setFeedPlaceholder] = useState(FEED_PLACEHOLDERS[0])
  useEffect(() => {
    setFeedPlaceholder(FEED_PLACEHOLDERS[Math.floor(Math.random() * FEED_PLACEHOLDERS.length)])
  }, [])
  const [phase, setPhase] = useState('compose') // 'compose' | 'paying'
  const [intent, setIntent] = useState(null)
  // True while a POCKET payment carries this compose: the paying screen is a
  // compact "posting…" (no Cashtab instructions), and — when allowOptimistic — the
  // post is shown the instant the pocket broadcasts. Cashtab / a pocket failure
  // flip it false so the approve + manual panel shows.
  const [payViaPocket, setPayViaPocket] = useState(false)
  // Poll composer (top-level posts only). pollRef snapshots the payload at pay
  // time so the confirm poll-loop reads a stable value, not a live closure.
  const [pollMode, setPollMode] = useState(false)
  const [pollOptions, setPollOptions] = useState(['', ''])
  const [pollEligibility, setPollEligibility] = useState('account')
  const pollRef = useRef(null)
  const composerId = useId()
  const [statusMsg, setStatusMsg] = useState('Waiting for payment…')
  const [notice, setNotice] = useState('')
  const [txidInput, setTxidInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef(null)

  const priced = priceFeedPost(content)
  const chars = priced.chars
  const overCap = chars > FEED_MAX_CHARS

  // Polls are top-level posts only. Need 2+ non-empty options to be valid.
  const pollAllowed = action === 'post'
  const pollActive = pollAllowed && pollMode
  const pollCleanOptions = pollOptions.map((o) => o.trim()).filter(Boolean)
  const pollValid = !pollActive || pollCleanOptions.length >= 2
  const canSubmit = priced.ok && pollValid && !submitting
  // The Pay control starts as a plain icon-only square; the instant you start
  // typing it lights up, widens, and reveals the amount — so it stays quiet
  // until there's actually something to pay for.
  const payActive = chars > 0

  const setOption = (i, val) =>
    setPollOptions((prev) => prev.map((o, idx) => (idx === i ? val : o)))
  const addOption = () =>
    setPollOptions((prev) => (prev.length < 4 ? [...prev, ''] : prev))
  const removeOption = (i) =>
    setPollOptions((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev))

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus()
  }, [autoFocus])

  // Auto-grow the composer to fit what you're typing (up to a cap, then scroll),
  // so long posts stay readable while composing. Runs on every content change,
  // including the initial prefill and the reset-to-empty after a successful post.
  const autosize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    // Cap the growth to what actually FITS on screen. The mobile keyboard shrinks
    // the visual viewport, so a flat 360px cap could make the box taller than the
    // visible area — the caret (and everything you were just typing) ended up
    // hidden under the keyboard, with no way to scroll it back into view. Sizing
    // off visualViewport keeps the box inside the visible strip, so it scrolls its
    // own content instead and the caret stays put. Desktop is unchanged: a tall
    // window still resolves to the same 360px ceiling.
    const vh =
      (typeof window !== 'undefined' && window.visualViewport?.height) ||
      (typeof window !== 'undefined' ? window.innerHeight : 0)
    const cap = vh ? Math.max(96, Math.min(360, Math.round(vh * 0.4))) : 360
    el.style.maxHeight = `${cap}px`
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`
  }, [])

  useEffect(() => {
    autosize()
  }, [content, autosize])

  // The keyboard opening/closing resizes the visual viewport — re-cap for the new
  // space, and keep a focused composer in view so it isn't left under the keyboard.
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    const onViewportChange = () => {
      autosize()
      if (document.activeElement === textareaRef.current) {
        textareaRef.current?.scrollIntoView({ block: 'nearest' })
      }
    }
    vv.addEventListener('resize', onViewportChange)
    return () => vv.removeEventListener('resize', onViewportChange)
  }, [autosize])

  // Insert an emoji at the textarea caret (replacing any selection), then put
  // the caret right after it and refocus — so picking an emoji feels like typing
  // one, mid-sentence, rather than always appending at the end.
  const insertEmoji = useCallback((emoji) => {
    const el = textareaRef.current
    setContent((prev) => {
      const start = el?.selectionStart ?? prev.length
      const end = el?.selectionEnd ?? prev.length
      const next = prev.slice(0, start) + emoji + prev.slice(end)
      if (el) {
        const pos = start + emoji.length
        requestAnimationFrame(() => {
          el.focus()
          try { el.setSelectionRange(pos, pos) } catch { /* noop */ }
        })
      }
      return next
    })
  }, [])

  // @handle autocomplete: type "@" + letters, pick from who matches. Applies
  // its pick the same way insertEmoji does — replace the span, refocus, put the
  // caret right after it — so it feels like an ordinary part of typing.
  const mention = useMentionSuggest(textareaRef, {
    onSelect: useCallback((next, pos) => {
      setContent(next)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        el?.focus()
        try { el?.setSelectionRange(pos, pos) } catch { /* noop */ }
      })
    }, []),
  })

  const resetToCompose = useCallback(() => {
    setPhase('compose')
    setIntent(null)
    setPayViaPocket(false)
    setNotice('')
    setTxidInput('')
    setStatusMsg('Waiting for payment…')
  }, [])

  // Shared success handler for the poll + manual-verify paths. Hands the new
  // post up and clears the composer. Where the viewer lands is the parent's call,
  // not ours: on the feed a post/quote is prepended to the top and the reply
  // nests under its parent (both stay on the page); only the thread-page composer
  // navigates, since a quote made there has nowhere on that page to appear.
  const handlePosted = useCallback(
    (post) => {
      onPosted?.(
        action === 'quote' && quotedPost ? { ...post, quoted: quotedPost } : post,
      )
      setContent('')
      setPollMode(false)
      setPollOptions(['', ''])
      setPollEligibility('account')
      pollRef.current = null
      resetToCompose()
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sessionChanged'))
      }
    },
    [action, quotedPost, onPosted, resetToCompose],
  )

  const startPayment = useCallback(async () => {
    if (!priced.ok || !pollValid) return
    // Snapshot the poll now so the confirm poll-loop records exactly what was
    // composed, even though the compose inputs are unmounted during 'paying'.
    pollRef.current = pollActive
      ? {
          eligibility: pollEligibility,
          options: pollCleanOptions.map((text) => ({ text })),
        }
      : null
    setSubmitting(true)
    setNotice('')
    // Warm the shared Chronik ws now (before /prepare + Cashtab approval) so the
    // payment-address subscription is live the moment the payment lands.
    prewarmPaymentWatch()
    // Decide pocket-vs-Cashtab AT the click gesture (never both). Pocket
    // eligible → opens nothing at all; extension → in-page popup; else
    // pre-opens about:blank so the deep link survives popup blockers once
    // /prepare returns. The client prices the post itself (priceFeedPost), so
    // eligibility is decidable synchronously.
    const handle = beginPayment({
      kind: pollActive ? 'feed-poll' : `feed-${action}`,
      amountXec: priced.costXec,
    })
    setPayViaPocket(handle.mode === 'pocket')
    try {
      const res = await fetch('/api/feed/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, action, parentTxid, quotedTxid }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        abortPayment(handle)
        setNotice(data.error || 'Could not start the payment. Try again.')
        return
      }
      // Pocket signs locally (txid feeds the confirm poll); Cashtab is the
      // extension popup or the pre-opened tab — exactly one. A rejected popup
      // drops back to the composer with the draft intact; a pocket failure
      // keeps the paying screen, whose manual Cashtab link completes it.
      void completePayment(handle, {
        bip21: data.bip21Url,
        cashtabUrl: data.cashtabUrl,
      }).then((r) => {
        if (r.ok && r.txid) {
          // A txid in hand = proof the payment broadcast: the Pocket always returns
          // one, and the Cashtab EXTENSION returns one the moment you approve — both
          // show optimistically. The web tab resolves with no txid (it can't know you
          // paid until the chain shows it), so it skips this and stays on the poll.
          setStatusMsg('Posting…')
          setIntent((prev) => (prev ? { ...prev, knownTxid: r.txid } : prev))
          const snap = getPocketSnapshot()
          // Only where the caller opted in (allowOptimistic), only for a plain post
          // (polls keep the classic flow), and only when we have a byline to render
          // (the pocket store supplies it) — else fall through so a post never blanks.
          if (allowOptimistic && !pollActive && (snap.identity || snap.primaryAddress)) {
            // Hand the RECORDING to a background confirm so the composer can be
            // dismissed the instant the post shows (waiting for the chain made the
            // box linger a beat, which felt slow) — and so posting again right away
            // can't overwrite this one's in-flight confirm. Its result is discarded;
            // the optimistic post below is what stays on screen.
            confirmFeedPostInBackground({
              txid: r.txid,
              content,
              action,
              parentTxid,
              quotedTxid,
              poll: pollRef.current,
              preparedAt: data.preparedAt,
              payAddress: data.payAddress,
            })
            // handlePosted shows the post (onPosted) AND clears the draft + poll
            // state + resets to the empty composer — the whole reason the text field
            // was left populated before was calling onPosted+resetToCompose, which
            // does NOT clear the draft.
            handlePosted({
              txid: r.txid,
              action:
                action === 'reply'
                  ? FEED_ACTION.REPLY
                  : action === 'quote'
                    ? FEED_ACTION.QUOTE
                    : FEED_ACTION.POST,
              parent_txid: parentTxid ?? null,
              quoted_txid: quotedTxid ?? null,
              content,
              content_hash: null,
              author_account_id: snap.accountId ?? null,
              author_identity: snap.identity ?? null,
              displayIdentity: snap.identity ?? null,
              displayColor: snap.handleColor ?? null,
              payer_address: snap.primaryAddress ?? null,
              payout_address: snap.primaryAddress ?? null,
              amount_sats: null,
              created_at: new Date().toISOString(),
              deleted: false,
              deleted_at: null,
              reply_count: 0,
              like_count: 0,
              repost_count: 0,
              quote_count: 0,
              card_kind: null,
              card_meta: null,
              image_url: null,
              quoted: action === 'quote' && quotedPost ? quotedPost : null,
              parent: null,
              linkedPost: null,
              articleCard: null,
              likedByViewer: false,
              repostedByViewer: false,
              optimistic: true,
            })
          }
        } else if (!r.ok && r.reason === 'denied') {
          resetToCompose()
          setNotice('Payment cancelled — your draft is safe.')
        } else if (!r.ok && r.reason === 'pocket_error') {
          // Pocket couldn't send — reveal the approve/manual panel so Cashtab can
          // still complete it.
          setPayViaPocket(false)
          setNotice(r.message || 'Pocket couldn’t send — use the Cashtab link below.')
        }
      })
      setIntent(data)
      setPhase('paying')
    } catch {
      abortPayment(handle)
      setNotice('Network hiccup — try again.')
    } finally {
      setSubmitting(false)
    }
  }, [content, action, parentTxid, quotedTxid, quotedPost, priced.ok, priced.costXec, pollActive, pollEligibility, pollOptions, pollValid, resetToCompose, allowOptimistic, handlePosted])

  // Poll for the on-chain payment while paying (Cashtab + non-optimistic pocket;
  // the optimistic path hands recording to confirmFeedPostInBackground instead).
  // The shared pollUntil owns the interval, the ws nudge, the 429 backoff, and
  // the lifetime cap. The ws THREADS its txid into confirm (wsThreadsTxid) so the
  // server does a single-tx verify (verifyFeedTxid) instead of scanning the busy
  // platform address's recent history — a cross-fired txid just misses on the
  // content hash and polling continues. Server still verifies + gates.
  useEffect(() => {
    if (phase !== 'paying' || !intent) return undefined
    return pollUntil(
      async (wsTxid) => {
        // A pocket-paid post knows its txid up front (intent.knownTxid); the ws
        // nudge supplies it for the web-tab path. Either way a known txid means a
        // single-tx verify, recorded on the first request with no address scan.
        const knownTxid = wsTxid ?? intent.knownTxid
        const res = await fetch('/api/feed/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            content,
            action,
            parentTxid,
            quotedTxid,
            poll: pollRef.current,
            since: intent.preparedAt,
            ...(knownTxid ? { txid: knownTxid } : {}),
          }),
        })
        if (res.status === 429) return { backoff: true }
        const data = await res.json()
        if (data.status === 'posted' && data.post) {
          // The confirm route returns the bare inserted row with no `quoted`
          // preview, so handlePosted attaches the one we already have to avoid a
          // transient "Quoted post unavailable." until the next server render.
          handlePosted(data.post)
          return { done: true }
        }
        if (!res.ok) setNotice(data.error || 'Verification failed.')
        return undefined
      },
      {
        onWsAddress: intent.payAddress,
        wsThreadsTxid: true,
        maxLifetimeMs: 120_000,
        onLifetimeExpired: () =>
          setNotice('Still confirming — refresh in a moment if your post doesn’t appear.'),
      },
    )
  }, [phase, intent, content, action, parentTxid, quotedTxid, handlePosted])

  const verifyManual = useCallback(async () => {
    const t = txidInput.trim()
    if (!/^[0-9a-f]{64}$/i.test(t)) {
      setNotice('Enter a valid 64-character transaction ID.')
      return
    }
    setNotice('Checking that transaction…')
    try {
      const res = await fetch('/api/feed/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, action, parentTxid, quotedTxid, poll: pollRef.current, txid: t }),
      })
      const data = await res.json()
      if (data.status === 'posted' && data.post) {
        handlePosted(data.post)
      } else if (data.status === 'awaiting_payment') {
        setNotice("That transaction doesn't match this post yet.")
      } else {
        setNotice(data.error || 'Could not verify that transaction.')
      }
    } catch {
      setNotice('Network hiccup — try again.')
    }
  }, [txidInput, content, action, parentTxid, quotedTxid, handlePosted])

  const isReply = action === 'reply'
  const isQuote = action === 'quote'
  const noun = isReply ? 'reply' : isQuote ? 'quote' : 'post'

  if (phase === 'paying' && intent) {
    // Pocket paid locally — no Cashtab, nothing to confirm in a wallet. A compact
    // "posting…" (the optimistic post, when enabled, is already showing above).
    if (payViaPocket) {
      return (
        <div className="panel pay">
          <p className="poll">Posting your {noun}…</p>
          {notice ? <p className="notice">{notice}</p> : null}
        </div>
      )
    }
    return (
      <div className="panel pay">
        <p className="payhead">
          Cashtab opened for <strong>{intent.amountXec} XEC</strong>. Confirm the {noun} there.
        </p>
        <p className="poll">{statusMsg}</p>

        <details className="manual">
          <summary>Cashtab didn&apos;t open, or already paid?</summary>
          <div style={{ textAlign: 'center', margin: '12px 0 0' }}>
            <a href={intent.cashtabUrl} target="_blank" rel="noreferrer" className="ghost">
              Open in Cashtab
            </a>
          </div>
          <div className="manualrow">
            <input
              value={txidInput}
              onChange={(e) => setTxidInput(e.target.value)}
              placeholder="Paste the transaction ID"
              spellCheck={false}
            />
            <button type="button" onClick={() => void verifyManual()} className="btn">
              Verify
            </button>
          </div>
        </details>

        {notice ? <p className="notice">{notice}</p> : null}

        <div style={{ marginTop: '16px' }}>
          <button type="button" onClick={() => resetToCompose()} className="linkbtn">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`panel compose${compact ? ' compact' : ''}`}>
      <div className="composetextwrap">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => {
            setContent(e.target.value)
            // Recompute the @mention context from WITHIN this same React
            // handler (not a separate DOM listener) — see useMentionSuggest's
            // header comment for why that matters: a plain addEventListener
            // here raced React's own controlled-value update and could
            // silently revert the very character just typed.
            mention.recompute()
          }}
          onKeyDown={mention.onKeyDown}
          onKeyUp={mention.recompute}
          onClick={mention.recompute}
          // Tells the mobile bottom nav bar to get out of the way while typing
          // (see BottomNav.js) — the keyboard's visualViewport resize only
          // scrolls the TEXTAREA into view, not the Cancel/Pay row below it, so
          // the fixed bar could end up sitting right on top of those buttons.
          onFocus={() => window.dispatchEvent(new Event('pow:composer-focus'))}
          onBlur={() => window.dispatchEvent(new Event('pow:composer-blur'))}
          rows={isReply ? 2 : 3}
          placeholder={
            placeholder ||
            (isReply
              ? 'Post your reply…'
              : isQuote
                ? 'Add a comment…'
                : pollActive
                  ? 'Ask a question…'
                  : feedPlaceholder)
          }
        />
        {mention.open ? (
          <ul
            className="mentionsuggest"
            role="listbox"
            style={{ top: mention.coords.top, left: mention.coords.left }}
          >
            {mention.items.map((it, i) => (
              <li key={it.handle}>
                <button
                  type="button"
                  className={`mentionsuggest-item${i === mention.activeIndex ? ' active' : ''}`}
                  role="option"
                  aria-selected={i === mention.activeIndex}
                  // mousedown-preventDefault keeps the textarea's selection/caret
                  // intact through the click, same trick EmojiPicker uses — else
                  // the blur-before-click would collapse the active mention range.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => mention.setActiveIndex(i)}
                  onClick={() => mention.select(it.handle)}
                >
                  <span
                    className="mentionsuggest-handle"
                    style={it.color ? { '--hc': it.color } : undefined}
                  >
                    @{it.handle}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {isQuote ? <QuotedEmbed post={quotedPost} interactive={false} /> : null}

      {pollActive ? (
        <div className="pollcompose">
          {pollOptions.map((opt, i) => (
            <div className="pollcompose-row" key={i}>
              <input
                className="pollcompose-input"
                value={opt}
                onChange={(e) => setOption(i, e.target.value)}
                placeholder={`Option ${i + 1}`}
                maxLength={80}
              />
              {pollOptions.length > 2 ? (
                <button
                  type="button"
                  className="pollcompose-x"
                  onClick={() => removeOption(i)}
                  aria-label={`Remove option ${i + 1}`}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
          {pollOptions.length < 4 ? (
            <button type="button" className="pollcompose-add" onClick={addOption}>
              + Add option
            </button>
          ) : null}
          <div className="pollcompose-elig">
            <span className="pollcompose-elig-label">Who can vote</span>
            <label className={pollEligibility === 'account' ? 'on' : ''}>
              <input
                type="radio"
                name={`elig-${composerId}`}
                checked={pollEligibility === 'account'}
                onChange={() => setPollEligibility('account')}
              />
              Anyone logged in
            </label>
            <label className={pollEligibility === 'handle' ? 'on' : ''}>
              <input
                type="radio"
                name={`elig-${composerId}`}
                checked={pollEligibility === 'handle'}
                onChange={() => setPollEligibility('handle')}
              />
              Handle-holders only
            </label>
          </div>
        </div>
      ) : null}

      <div className="composebar">
        <div className="barleft">
          <EmojiPicker onPick={insertEmoji} />
          {pollAllowed ? (
            <button
              type="button"
              className={`polltoggle${pollActive ? ' on' : ''}`}
              aria-pressed={pollActive}
              onClick={() => setPollMode((v) => !v)}
              title={pollActive ? 'Remove poll' : 'Add a poll'}
            >
              📊
            </button>
          ) : null}
          <span className={`count${overCap ? ' over' : ''}`}>
            {chars}/{FEED_MAX_CHARS}
          </span>
        </div>
        <div className="barbtns">
          {(isReply || isQuote) && onCancel ? (
            <button type="button" onClick={onCancel} className="ghost">
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void startPayment()}
            className={`paybtn${payActive ? ' active' : ''}`}
            aria-label={priced.ok ? `Pay ${priced.costXec} XEC` : 'Pay'}
          >
            <span aria-hidden className="paybtn-icon">
              <EcashIcon size={15} />
            </span>
            <span className="paybtn-amt">{priced.ok ? `${priced.costXec} XEC` : ''}</span>
          </button>
        </div>
      </div>
      {notice ? <p className="notice">{notice}</p> : null}
    </div>
  )
}
