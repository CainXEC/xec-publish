/**
 * The Pocket — device storage.
 *
 * The derived key persists in localStorage so daily use has ZERO ceremonies
 * (the sign-and-paste derivation is setup + recovery, not a login step). This
 * is the same trust level as Cashtab's own web wallet, which keeps full
 * wallets in browser storage — and the pocket is capped at pocket change by
 * design. Keyed per ACCOUNT so a shared browser never crosses pockets between
 * users. Deliberately NOT cleared on logout: the key is the user's key
 * material, not session state; "Forget this pocket on this device" in the
 * panel is the explicit removal path (with a sweep-first prompt).
 *
 * Losing this record never loses funds — re-pasting the wallet signature
 * re-derives the identical key (see lib/pocket/derive.js).
 */

const STORAGE_PREFIX = 'pow_pocket_v1.'

function storageKey(accountId) {
  return `${STORAGE_PREFIX}${accountId}`
}

function hasStorage() {
  try {
    return typeof window !== 'undefined' && Boolean(window.localStorage)
  } catch {
    return false
  }
}

/**
 * @typedef {object} PocketRecord
 * @property {1} v
 * @property {string} accountId
 * @property {string} address        ecash:-prefixed pocket address
 * @property {string} pkHex          33-byte compressed pubkey, hex
 * @property {string} skHex          32-byte secret key, hex — THE hot key
 * @property {string} primaryAtCreation  the primary that signed the sentence
 * @property {boolean} registered    server link (account_addresses) confirmed
 * @property {string} [delegateTxid] first funding tx carrying the DELEGATE
 * @property {string} createdAt      ISO timestamp
 */

/** @returns {PocketRecord | null} */
export function loadPocket(accountId) {
  if (!hasStorage() || !accountId) return null
  try {
    const raw = window.localStorage.getItem(storageKey(accountId))
    if (!raw) return null
    const rec = JSON.parse(raw)
    if (
      rec?.v !== 1 ||
      rec.accountId !== accountId ||
      typeof rec.address !== 'string' ||
      !/^[0-9a-f]{64}$/.test(rec.skHex ?? '') ||
      !/^[0-9a-f]{66}$/.test(rec.pkHex ?? '')
    ) {
      return null
    }
    return rec
  } catch {
    return null
  }
}

/** @param {PocketRecord} record */
export function savePocket(record) {
  if (!hasStorage() || !record?.accountId) return
  try {
    window.localStorage.setItem(storageKey(record.accountId), JSON.stringify(record))
  } catch {
    /* quota/private-mode: the pocket simply won't persist; recovery re-derives */
  }
}

export function forgetPocket(accountId) {
  if (!hasStorage() || !accountId) return
  try {
    window.localStorage.removeItem(storageKey(accountId))
  } catch {
    /* nothing to do */
  }
}

/**
 * Subscribe to pocket changes made by OTHER tabs (the `storage` event never
 * fires in the tab that wrote). Last-write-wins is fine: the record is
 * effectively immutable after creation.
 * @param {() => void} cb
 * @returns {() => void} unsubscribe
 */
export function onPocketStorageChange(cb) {
  if (typeof window === 'undefined') return () => {}
  const handler = (e) => {
    if (typeof e?.key === 'string' && e.key.startsWith(STORAGE_PREFIX)) cb()
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}
