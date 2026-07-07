'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveProfile } from '@/app/dashboard/saveProfile'
import FeedTopbar from '@/components/feed/FeedTopbar'
import { FEED_CSS } from '@/components/feed/feedTheme'
import HandleColorPicker from '@/components/dashboard/HandleColorPicker'

export default function ProfileSettingsForm({ initialBio, hasAuthor = true }) {
  const router = useRouter()
  const [bio, setBio] = useState(initialBio ?? '')

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [savedMessage, setSavedMessage] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitError(null)
    setSavedMessage(false)
    setSubmitting(true)

    try {
      const result = await saveProfile({ bio })
      if (result?.unauthorized) {
        router.replace('/login')
        return
      }
      if (!result?.ok) {
        setSubmitError(result?.error || 'Could not save profile.')
        return
      }
      setSavedMessage(true)
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

  return (
    <div className="pow-feed">
      <style>{FEED_CSS}</style>
      <style>{PROFILE_CSS}</style>

      <FeedTopbar signedIn isAuthor={hasAuthor} showLogout showMarketplace={false} />

      <main className="wrap" style={{ paddingTop: '28px' }}>
        <section className="dashpanel">
          <h1 className="dashwelcome">Profile settings</h1>
          <p className="prof-sub">
            {hasAuthor
              ? 'Update how readers see you on your public author page.'
              : 'Choose the color your handle appears in across the site.'}
          </p>
        </section>

        <HandleColorPicker />

        {hasAuthor ? (
          <>
            <section className="dashpanel">
              <form onSubmit={handleSubmit}>
                <div className="prof-field">
                  <label htmlFor="bio" className="prof-label">
                    Bio <span className="opt">(optional)</span>
                  </label>
                  <textarea
                    id="bio"
                    name="bio"
                    rows={5}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    className="prof-input"
                    placeholder="Shown on your public author page"
                  />
                </div>

                {submitError ? (
                  <p className="error" style={{ marginTop: '18px' }} role="alert">
                    {submitError}
                  </p>
                ) : null}

                {savedMessage ? (
                  <p className="prof-ok" style={{ marginTop: '18px' }} role="status">
                    Profile saved.
                  </p>
                ) : null}

                <div style={{ marginTop: '22px' }}>
                  <button type="submit" disabled={submitting} className="dashbtn">
                    {submitting ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </form>
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
          </>
        ) : null}
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
