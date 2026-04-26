'use client'

import { useEffect, useId, useRef, useState, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'

const GHOST_CLICK_BLOCK_MS = 380

function ChevronDownIcon({ className }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Single-select dropdown (listbox pattern). Only one menu in a group should be open — parent
 * controls that via `openMenu` / `setOpenMenu`.
 *
 * @param {{
 *   menuId: string
 *   openMenu: string | null
 *   setOpenMenu: (id: string | null) => void
 *   value: string
 *   options: { value: string, label: string, disabled?: boolean, disabledHint?: string }[]
 *   onChange: (value: string) => void
 *   disabled?: boolean
 *   disabledHint?: string
 *   ariaLabel: string
 *   minWidth?: string
 *   fullWidth?: boolean
 * }} props
 */
export default function FilterDropdown({
  menuId,
  openMenu,
  setOpenMenu,
  value,
  options,
  onChange,
  disabled = false,
  disabledHint = '',
  ariaLabel,
  minWidth,
  fullWidth = false,
}) {
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const ghostBlockTimerRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null))
  const [menuPosition, setMenuPosition] = useState(null)
  const [blockGhostClicks, setBlockGhostClicks] = useState(false)
  const listboxId = useId()
  const isOpen = openMenu === menuId

  const selected = options.find((o) => o.value === value)
  const triggerText = selected?.label ?? String(value)

  useLayoutEffect(() => {
    if (!isOpen) {
      setMenuPosition(null)
      return
    }
    const updatePosition = () => {
      const el = triggerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onDocMouseDown = (e) => {
      const t = /** @type {Node} */ (e.target)
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      setOpenMenu(null)
    }
    document.addEventListener('pointerdown', onDocMouseDown)
    return () => document.removeEventListener('pointerdown', onDocMouseDown)
  }, [isOpen, setOpenMenu])

  useEffect(() => {
    if (!isOpen) return
    const id = requestAnimationFrame(() => {
      const menu = menuRef.current
      if (!menu) return
      const escaped =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape(value)
          : value.replace(/"/g, '\\"')
      const match = menu.querySelector(`button[data-filter-value="${escaped}"]:not([disabled])`)
      const buttons = [...menu.querySelectorAll('button:not([disabled])')]
      ;(match instanceof HTMLButtonElement ? match : buttons[0])?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [isOpen, value])

  useEffect(() => {
    if (!isOpen || disabled) return
    const onEscape = (e) => {
      if (e.key !== 'Escape') return
      if (!menuRef.current?.contains(document.activeElement)) return
      e.preventDefault()
      setOpenMenu(null)
      triggerRef.current?.focus()
    }
    document.addEventListener('keydown', onEscape, true)
    return () => document.removeEventListener('keydown', onEscape, true)
  }, [isOpen, disabled, setOpenMenu])

  const close = () => setOpenMenu(null)

  const armGhostClickBlocker = useCallback(() => {
    setBlockGhostClicks(true)
    if (ghostBlockTimerRef.current) clearTimeout(ghostBlockTimerRef.current)
    ghostBlockTimerRef.current = setTimeout(() => {
      ghostBlockTimerRef.current = null
      setBlockGhostClicks(false)
    }, GHOST_CLICK_BLOCK_MS)
  }, [])

  useEffect(() => {
    return () => {
      if (ghostBlockTimerRef.current) clearTimeout(ghostBlockTimerRef.current)
    }
  }, [])

  const focusablesInMenu = () => {
    const menu = menuRef.current
    if (!menu) return /** @type {HTMLButtonElement[]} */ ([])
    return [...menu.querySelectorAll('button:not([disabled])')]
  }

  const onTriggerKeyDown = (e) => {
    if (disabled) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setOpenMenu(isOpen ? null : menuId)
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!isOpen) {
        e.preventDefault()
        setOpenMenu(menuId)
      }
    }
  }

  const onMenuKeyDownCapture = (e) => {
    if (!menuRef.current?.contains(/** @type {Node} */ (e.target))) return

    const buttons = focusablesInMenu()
    const cur = buttons.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement))

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (buttons.length === 0) return
      const next = cur < 0 ? 0 : (cur + 1) % buttons.length
      buttons[next]?.focus()
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (buttons.length === 0) return
      const next = cur <= 0 ? buttons.length - 1 : cur - 1
      buttons[next]?.focus()
      return
    }

    if (e.key === 'Tab' && buttons.length > 0) {
      if (e.shiftKey) {
        if (cur <= 0) {
          e.preventDefault()
          buttons[buttons.length - 1]?.focus()
        }
      } else if (cur === buttons.length - 1 || cur < 0) {
        e.preventDefault()
        buttons[0]?.focus()
      }
    }
  }

  const toggleOpen = () => {
    if (disabled) return
    if (!isOpen) setMenuPosition(null)
    setOpenMenu(isOpen ? null : menuId)
  }

  const selectOption = (nextValue) => {
    armGhostClickBlocker()
    onChange(nextValue)
    close()
    triggerRef.current?.focus()
  }

  const triggerId = `${menuId}-trigger`

  const triggerClass = [
    'inline-flex items-center justify-center gap-1.5 rounded-full border-[0.5px] px-3 py-1.5 text-left text-sm font-normal leading-[1.2] transition-colors duration-150',
    fullWidth ? 'w-full min-w-0' : 'shrink-0',
    disabled
      ? 'cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-500 opacity-40 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-500'
      : isOpen
        ? 'cursor-pointer border-zinc-300 bg-zinc-200 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100'
        : 'cursor-pointer border-zinc-200 bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-100 dark:hover:bg-zinc-800',
  ].join(' ')

  const menuPanel =
    isOpen && !disabled && menuPosition ? (
      <div
        ref={menuRef}
        id={listboxId}
        role="listbox"
        aria-labelledby={triggerId}
        tabIndex={-1}
        onKeyDownCapture={onMenuKeyDownCapture}
        style={{
          position: 'fixed',
          top: `${menuPosition.top}px`,
          left: `${menuPosition.left}px`,
          width: `${menuPosition.width}px`,
        }}
        className="z-[100] rounded-xl border border-zinc-200 bg-zinc-100 py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900/80"
      >
        {options.map((opt) => {
          const selectedHere = opt.value === value
          const optDisabled = Boolean(opt.disabled)
          const rowId = `${listboxId}-opt-${opt.value}`
          return optDisabled ? (
            <div
              key={opt.value}
              id={rowId}
              role="option"
              aria-selected={selectedHere}
              aria-disabled="true"
              title={opt.disabledHint ?? ''}
              className="flex cursor-not-allowed items-center px-3 py-2 text-left text-xs text-zinc-400 opacity-50 sm:text-sm dark:text-zinc-500"
            >
              <span className="min-w-0 flex-1">{opt.label}</span>
              {opt.disabledHint ? (
                <span className="sr-only">{opt.disabledHint}</span>
              ) : null}
            </div>
          ) : (
            <button
              key={opt.value}
              id={rowId}
              type="button"
              role="option"
              data-filter-value={opt.value}
              aria-selected={selectedHere}
              className={`flex w-full items-center px-3 py-2 text-left text-xs focus:outline-none sm:text-sm ${
                selectedHere
                  ? 'bg-emerald-50 font-medium text-emerald-900 focus-visible:ring-2 focus-visible:ring-emerald-600/35 focus-visible:ring-inset dark:bg-emerald-950/50 dark:text-emerald-100 dark:focus-visible:ring-emerald-400/30'
                  : 'text-zinc-800 hover:bg-zinc-50 focus-visible:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-400/40 focus-visible:ring-inset dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:bg-zinc-800 dark:focus-visible:ring-zinc-500/35'
              }`}
              onPointerDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                selectOption(opt.value)
              }}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                // Pointer path selects in onPointerDown; synthesized click must be absorbed only.
                // Keyboard activation dispatches click with detail === 0 (no preceding pointerdown).
                if (e.detail !== 0) return
                selectOption(opt.value)
              }}
            >
              <span className="min-w-0 flex-1">{opt.label}</span>
            </button>
          )
        })}
      </div>
    ) : null

  return (
    <div className={`relative ${fullWidth ? 'w-full min-w-0' : 'shrink-0'}`}>
      <button
        ref={triggerRef}
        type="button"
        id={triggerId}
        className={triggerClass}
        aria-haspopup="listbox"
        aria-expanded={disabled ? false : isOpen}
        aria-controls={isOpen && !disabled ? listboxId : undefined}
        aria-disabled={disabled}
        aria-label={`${ariaLabel}: ${triggerText}`}
        title={disabled && disabledHint ? disabledHint : undefined}
        onPointerDown={(e) => {
          e.stopPropagation()
          e.preventDefault()
          if (disabled) return
          toggleOpen()
        }}
        onKeyDown={onTriggerKeyDown}
        tabIndex={disabled ? -1 : 0}
        style={minWidth ? { minWidth } : undefined}
      >
        <span className="truncate">{triggerText}</span>
        <ChevronDownIcon
          className={`h-3 w-3 shrink-0 text-zinc-500 transition-transform duration-150 dark:text-zinc-400 ${
            isOpen ? 'rotate-180' : 'rotate-0'
          }`}
        />
      </button>
      {typeof document !== 'undefined' && menuPanel
        ? createPortal(menuPanel, document.body)
        : null}
      {typeof document !== 'undefined' && blockGhostClicks
        ? createPortal(
            <div
              aria-hidden
              className="fixed inset-0 z-[200]"
              style={{ pointerEvents: 'auto', touchAction: 'none' }}
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
            />,
            document.body,
          )
        : null}
    </div>
  )
}
