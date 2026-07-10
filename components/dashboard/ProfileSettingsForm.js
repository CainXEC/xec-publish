'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveProfile } from '@/app/dashboard/saveProfile'
import { saveHandleColor } from '@/app/dashboard/saveHandleColor'
import { saveDisplayHandle } from '@/app/dashboard/saveDisplayHandle'
import FeedTopbar from '@/components/feed/FeedTopbar'
import { FEED_CSS } from '@/components/feed/feedTheme'
import HandleColorPicker from '@/components/dashboard/HandleColorPicker'
import DashboardHandleCarousel from '@/components/dashboard/DashboardHandleCarousel'

// A blocked account's identity is "@handle" or a raw address; shorten a long
// address for the row while leaving handles intact.
function blockedLabel(identity) {
  const s = typeof identity === 'string' ? identity : ''
  if (s.startsWith('@') || s.length <= 20) return s
  return `${s.slice(0, 12)}…${s.slice(-4)}`
}

export default function ProfileSettingsForm({
  initialBio,
  initialColor = '',
  initialHandles = [],
  handleAddress = null,
  initialActiveTokenId = null,
  initialBlocked = [],
}) {
  const router = useRouter()
  const [bio, setBio] = useState(initialBio ?? '')
  const [color, setColor] = useState(initialColor ?? '')
  const [activeTokenId, setActiveTokenId] = useState(initialActiveTokenId ?? null)

  // Last-saved snapshot. Everything above is staged; we diff against this to know
  // whether there are unsaved changes (which lights up the Save button) and reset
  // it after a successful save so the form goes "clean" again without a reload.
  const [saved, setSaved] = useState({
    bio: initialBio ?? '',
    color: initialColor ?? '',
    activeTokenId: initialActiveTokenId ?? null,
  })
  const dirty =
    bio !== saved.bio || color !== saved.color || activeTokenId !== saved.activeTokenId

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [savedMessage, setSavedMessage] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  const [blockedList, setBlockedList] = useState(initialBlocked ?? [])
  const [unblockingId, setUnblockingId] = useState(null)
  const [unblockError, setUnblockError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitError(null)
    setSavedMessage(false)
    setSubmitting(true)

    try {
      // Persist the handle color for every account (reader-only or author).
      const colorResult = await saveHandleColor({ color: color || null })
      if (colorResult?.unauthorized) {
        router.replace('/login')
        return
      }
      if (!colorResult?.ok) {
        setSubmitError(colorResult?.error || 'Could not save changes.')
        return
      }

      // Persist the display handle only when it actually changed (an on-chain
      // holder check runs server-side, so avoid the round-trip otherwise).
      if (activeTokenId !== saved.activeTokenId) {
        const handleResult = await saveDisplayHandle({ tokenId: activeTokenId })
        if (handleResult?.unauthorized) {
          router.replace('/login')
          return
        }
        if (!handleResult?.ok) {
          setSubmitError(handleResult?.error || 'Could not update display handle.')
          return
        }
      }

      // Every account is an author identity, so the bio always lives on
      // authors.bio (saveProfile). Only persist when it actually changed.
      if (bio !== saved.bio) {
        const result = await saveProfile({ bio })
        if (result?.unauthorized) {
          router.replace('/login')
          return
        }
        if (!result?.ok) {
          setSubmitError(result?.error || 'Could not save changes.')
          return
        }
      }

      setSaved({ bio, color, activeTokenId })
      setSavedMessage(true)
      // Update the live nav byline / feed color without a full reload.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sessionChanged'))
      }
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteAccount() {
    const confirmed = window.confirm(
      'Are you sure? This will permanently delete your account and all your posts. This cannot be undone.',
    )
    if (!confirmed) return

    setDeleteError(null)
    setDeleting(true)
    try {
      const res = await fetch('/api/author/delete-account', { method: 'DELETE' })
      let data = {}
      try {
        data = await res.json()
      } catch {
        /* ignore */
      }
      if (!res.ok) {
        setDeleteError(data.error || 'Could not delete account.')
        return
      }
      // Account is gone — clear the wallet session so we're not "logged in" as
      // a deleted account, and let the nav update.
      try {
        await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' })
      } catch {
        /* ignore */
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sessionChanged'))
      }
      router.push('/')
      router.refresh()
    } finally {
      setDeleting(false)
    }
  }

  // Unblock = the same /api/feed/block toggle; a blocked account flips to unblocked
  // and drops out of the list. Session-authorized, no payment.
  async function handleUnblock(accountId) {
    setUnblockError(null)
    setUnblockingId(accountId)
    try {
      const res = await fetch('/api/feed/block', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blockedAccountId: accountId }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok && data.blocked === false) {
        setBlockedList((prev) => prev.filter((b) => b.accountId !== accountId))
      } else {
        setUnblockError(data.error || 'Could not unblock. Try again.')
      }
    } catch {
      setUnblockError('Could not unblock. Try again.')
    } finally {
      setUnblockingId(null)
    }
  }

  return (
    <div className="pow-feed">
      <style>{FEED_CSS}</style>
      <style>{PROFILE_CSS}</style>

      <FeedTopbar signedIn isAuthor showLogout showMarketplace={false} />

      <main className="wrap" style={{ paddingTop: '28px' }}>
        <section className="dashpanel">
          <h1 className="dashwelcome">Profile settings</h1>
          <p className="prof-sub">Update how you appear across the site.</p>
        </section>

        <DashboardHandleCarousel
          initialHandles={initialHandles}
          initialAddress={handleAddress}
          value={activeTokenId}
          onChange={setActiveTokenId}
          disabled={submitting}
        />

        <form onSubmit={handleSubmit}>
          <HandleColorPicker value={color} onChange={setColor} disabled={submitting} />

          <section className="dashpanel">
            <div className="prof-field">
              <label htmlFor="bio" className="prof-label">
                Bio <span className="opt">(optional)</span>
              </label>
              <textarea
                id="bio"
                name="bio"
                rows={5}
                maxLength={500}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="prof-input"
                placeholder="A short bio shown on your profile"
              />
            </div>
          </section>

          <section className="dashpanel">
            {submitError ? (
              <p className="error" role="alert">
                {submitError}
              </p>
            ) : null}

            {savedMessage && !dirty ? (
              <p className="prof-ok" role="status">
                Changes saved.
              </p>
            ) : null}

            <div style={{ marginTop: submitError || (savedMessage && !dirty) ? '18px' : 0 }}>
              <button type="submit" disabled={submitting || !dirty} className="dashbtn">
                {submitting ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
              </button>
            </div>
          </section>
        </form>

        <section className="dashpanel">
          <h2 className="prof-panel-title">Blocked accounts</h2>
          {blockedList.length === 0 ? (
            <p className="prof-panel-sub">You haven’t blocked anyone.</p>
          ) : (
            <>
              <p className="prof-panel-sub">
                Blocked accounts can’t see your posts or reply to you, and you won’t see theirs.
              </p>
              {unblockError ? (
                <p className="error" style={{ marginTop: '12px' }} role="alert">
                  {unblockError}
                </p>
              ) : null}
              <ul className="blocklist">
                {blockedList.map((b) => {
                  const isHandle = typeof b.identity === 'string' && b.identity.startsWith('@')
                  return (
                    <li key={b.accountId} className="blockrow">
                      <span
                        className="blockid"
                        title={b.identity}
                        style={isHandle && b.color ? { color: b.color } : undefined}
                      >
                        {blockedLabel(b.identity)}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleUnblock(b.accountId)}
                        disabled={unblockingId === b.accountId}
                        className="ghost blockunbtn"
                      >
                        {unblockingId === b.accountId ? 'Unblocking…' : 'Unblock'}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </section>

        <section className="dashpanel prof-danger">
          <h2 className="prof-danger-title">Danger zone</h2>
          <p className="prof-danger-sub">
            Permanently delete your account and all posts. This cannot be undone.
          </p>
          {deleteError ? (
            <p className="error" style={{ marginTop: '12px' }} role="alert">
              {deleteError}
            </p>
          ) : null}
          <button
            type="button"
            onClick={handleDeleteAccount}
            disabled={deleting}
            className="prof-danger-btn"
          >
            {deleting ? 'Deleting…' : 'Delete account'}
          </button>
        </section>
      </main>
    </div>
  )
}

// Profile-settings chrome layered on FEED_CSS. Reuses .dashpanel / .dashwelcome /
// .dashbtn / .error; adds the neon form fields, the display-handle radio rows
// (shared with DisplayHandlePicker), and the red "danger zone" delete action.
const PROFILE_CSS = `
.pow-feed .prof-sub{margin:10px 0 0;font-size:13px;line-height:1.55;color:var(--dim);}
.pow-feed .prof-field{margin-top:22px;}
.pow-feed .prof-field:first-child{margin-top:0;}
.pow-feed .prof-label{display:block;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--neon);
  text-shadow:0 0 8px rgba(0,255,156,.3);}
.pow-feed .prof-label .opt{font-size:11px;letter-spacing:0;text-transform:none;color:var(--dim);text-shadow:none;}
.pow-feed .prof-input{margin-top:8px;width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:9px;
  padding:11px 13px;color:var(--text);font:inherit;font-size:14px;outline:none;
  transition:border-color .15s,box-shadow .15s;}
.pow-feed .prof-input:focus{border-color:var(--cyan);box-shadow:0 0 14px rgba(61,240,255,.15);}
.pow-feed textarea.prof-input{resize:vertical;min-height:120px;}
.pow-feed .prof-hint{margin:8px 0 0;font-size:12px;color:var(--dim);word-break:break-word;}
/* handle color swatches */
.pow-feed .prof-swatches{display:flex;flex-wrap:wrap;gap:12px;margin-top:10px;}
.pow-feed .prof-swatch{width:34px;height:34px;border-radius:50%;padding:0;cursor:pointer;
  background:var(--sw);border:2px solid var(--line);outline:none;
  transition:transform .12s,box-shadow .12s,border-color .12s;}
.pow-feed .prof-swatch:hover{transform:scale(1.08);box-shadow:0 0 14px var(--sw);}
.pow-feed .prof-swatch.sel{border-color:var(--text);box-shadow:0 0 0 2px var(--bg),0 0 16px var(--sw);}
.pow-feed .prof-ok{font-size:13px;color:var(--neon);text-shadow:0 0 8px rgba(0,255,156,.3);}
/* shared panel heading used by the display-handle picker */
.pow-feed .prof-panel-title{margin:0;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
  color:var(--neon);text-shadow:0 0 8px rgba(0,255,156,.3);}
.pow-feed .prof-panel-sub{margin:8px 0 0;font-size:12px;line-height:1.55;color:var(--dim);}
/* display-handle radio rows */
.pow-feed .prof-radios{display:flex;flex-direction:column;gap:8px;margin:14px 0 0;padding:0;border:0;}
.pow-feed .prof-radio{display:flex;align-items:center;gap:12px;border:1px solid var(--line);border-radius:10px;
  padding:10px 12px;background:var(--panel2);cursor:pointer;transition:border-color .15s,box-shadow .15s;}
.pow-feed .prof-radio:hover{border-color:var(--cyan);}
.pow-feed .prof-radio.sel{border-color:var(--neon);box-shadow:0 0 14px rgba(0,255,156,.15);}
.pow-feed .prof-radio input{width:16px;height:16px;flex:none;accent-color:var(--neon);cursor:pointer;}
.pow-feed .prof-radio-img{width:32px;height:32px;flex:none;border-radius:8px;border:1px solid var(--line);object-fit:cover;
  background:var(--panel);}
.pow-feed .prof-radio-name{font-size:14px;font-weight:700;color:var(--text);}
.pow-feed .prof-radio-addr{font-size:13px;color:var(--dim);}
/* blocked accounts list */
.pow-feed .blocklist{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-direction:column;gap:8px;}
.pow-feed .blockrow{display:flex;align-items:center;justify-content:space-between;gap:12px;
  border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--panel2);}
.pow-feed .blockid{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:700;color:var(--text);}
.pow-feed .blockunbtn{flex:none;}
/* danger zone */
.pow-feed .prof-danger{border-color:var(--no);}
.pow-feed .prof-danger-title{margin:0;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--no);}
.pow-feed .prof-danger-sub{margin:8px 0 0;font-size:12px;line-height:1.55;color:var(--dim);}
.pow-feed .prof-danger-btn{margin-top:14px;background:transparent;color:var(--no);border:1px solid var(--no);border-radius:9px;
  padding:9px 16px;font:inherit;font-size:13px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;
  transition:background .15s,color .15s,box-shadow .15s;}
.pow-feed .prof-danger-btn:hover:not(:disabled){background:var(--no);color:#120406;box-shadow:0 0 20px rgba(255,92,108,.4);}
.pow-feed .prof-danger-btn:disabled{opacity:.5;cursor:default;}
`
