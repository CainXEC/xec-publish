'use client'
// =============================================================================
//  ConfirmDialog.js — on-theme replacement for window.confirm().
//  A native confirm() renders as a browser chrome popup with a light,
//  system-styled box — it looks like a security warning, not part of the
//  site. useConfirmDialog() gives call sites the same "resolve true/false"
//  shape (await it, branch on the result) but paints the neon
//  .pow-feed/.pow-article theme via the SAME --bg/--panel/--line/--text/--dim/
//  --neon/--no custom properties both scopes already define, so it reads
//  correctly wherever it's mounted (dark or the paper light-mode override)
//  without the caller doing any theming work.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'

function ConfirmDialogOverlay({ message, confirmLabel, cancelLabel, danger, onConfirm, onCancel }) {
  const cancelRef = useRef(null)

  useEffect(() => {
    // Cancel gets initial focus, not Confirm — a stray Enter keypress should
    // never complete a block/delete action.
    cancelRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <>
      <style>{CONFIRM_CSS}</style>
      <div
        className="confirmdlg-overlay"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onCancel()
        }}
      >
        <div className="confirmdlg-card" role="alertdialog" aria-modal="true">
          <p className="confirmdlg-msg">{message}</p>
          <div className="confirmdlg-row">
            <button ref={cancelRef} type="button" className="confirmdlg-btn" onClick={onCancel}>
              {cancelLabel}
            </button>
            <button
              type="button"
              className={`confirmdlg-btn confirmdlg-btn-confirm${danger ? ' danger' : ''}`}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// Drop-in for `if (!window.confirm(msg)) return` — but async: `if (!(await
// confirm(msg))) return`. Render the returned dialog node once, anywhere in
// the calling component's JSX (it's a no-op null until confirm() is called).
export function useConfirmDialog() {
  const [state, setState] = useState(null)
  const resolveRef = useRef(null)

  const confirm = useCallback((message, opts = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve
      setState({
        message,
        confirmLabel: opts.confirmLabel || 'Confirm',
        cancelLabel: opts.cancelLabel || 'Cancel',
        danger: opts.danger !== false,
      })
    })
  }, [])

  const settle = useCallback((result) => {
    setState(null)
    resolveRef.current?.(result)
    resolveRef.current = null
  }, [])

  const dialog = state ? (
    <ConfirmDialogOverlay
      message={state.message}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      danger={state.danger}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null

  return [confirm, dialog]
}

const CONFIRM_CSS = `
.confirmdlg-overlay{
  position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;
  padding:16px;background:rgba(3,8,7,.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
}
.confirmdlg-card{
  width:100%;max-width:360px;background:var(--panel);border:1px solid var(--line);
  border-radius:14px;padding:20px 20px 16px;box-shadow:0 20px 60px rgba(0,0,0,.4);
}
.confirmdlg-msg{margin:0;font-size:14px;line-height:1.55;color:var(--text);}
.confirmdlg-row{display:flex;justify-content:flex-end;gap:10px;margin-top:18px;}
.confirmdlg-btn{
  padding:9px 16px;border-radius:9px;border:1px solid var(--line);background:transparent;
  color:var(--dim);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;
  transition:border-color .15s,color .15s;
}
.confirmdlg-btn:hover,.confirmdlg-btn:focus-visible{border-color:var(--cyan);color:var(--cyan);}
.confirmdlg-btn-confirm{border-color:var(--neon);color:var(--neon);}
.confirmdlg-btn-confirm:hover,.confirmdlg-btn-confirm:focus-visible{
  background:var(--neon);color:var(--bg);border-color:var(--neon);
}
.confirmdlg-btn-confirm.danger{border-color:var(--no);color:var(--no);}
.confirmdlg-btn-confirm.danger:hover,.confirmdlg-btn-confirm.danger:focus-visible{
  background:var(--no);color:var(--bg);border-color:var(--no);
}
`
