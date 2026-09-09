/**
 * All stored forms of every address linked to an account, prefix-agnostic —
 * the set an unlock's `payer_address` is matched against when restoring an
 * unlock for a logged-in account (any device, no cookie needed).
 *
 * Why every linked address, not just the session one: an account can pay from
 * more than one wallet it has proven — its login wallet, a still-linked OLD
 * wallet after a change-address swap, or its in-browser Pocket (kind='pocket').
 * All of those live in `account_addresses`, so an unlock paid from any of them
 * belongs to the account. Both bare and `ecash:`-prefixed forms are returned so
 * a `.in('payer_address', …)` match is prefix- and case-insensitive.
 *
 * SECURITY: only ever call with an account proven server-side (getAuthedAccount)
 * and its OWN linked addresses — never a client-supplied address. Unlock payer
 * addresses are public on chain, so trusting an arbitrary address would let
 * anyone name a real buyer's wallet and read the post free.
 */
export async function accountUnlockAddressForms(supabase, accountId, sessionAddress) {
  const { data: rows } = await supabase
    .from('account_addresses')
    .select('address')
    .eq('account_id', accountId)
  return [
    ...new Set(
      [sessionAddress, ...(rows ?? []).map((r) => String(r.address ?? ''))]
        .filter(Boolean)
        .map((a) => String(a).trim().toLowerCase().replace(/^ecash:/, ''))
        .filter(Boolean)
        .flatMap((bare) => [bare, `ecash:${bare}`]),
    ),
  ]
}
