// =============================================================================
//  alp-dryrun.ts — prove the ALP toolkit on a THROWAWAY token before the real,
//  irreversible 1B POW genesis ever runs.
//
//  It genesises a junk ALP token (2 decimals, tiny supply) from a TEST wallet,
//  sends a portion to a fresh throwaway address, then burns the remainder — so
//  you can eyeball a real GENESIS, SEND, and BURN on-chain and confirm the
//  toolkit (lib/ecash/powToken.ts) works end-to-end. Uses the same mainnet
//  Chronik path the app uses; costs a few sats.
//
//  Use a DEDICATED TEST wallet (NOT your real treasury/mint wallet), so the real
//  wallet's first-ever token action is the real genesis (clean provenance).
//
//  SAFETY: dry-run by default (prints the plan + the address to fund, broadcasts
//  nothing). It only broadcasts when BOTH are set:  --broadcast  AND  CONFIRM=DRYRUN
//
//    # 1) see the plan + the test-wallet address to fund:
//    POW_DRYRUN_MNEMONIC="twelve word test seed …" npx tsx scripts/alp-dryrun.ts
//
//    # 2) fund that address with a little XEC (~20 XEC is plenty), then for real:
//    POW_DRYRUN_MNEMONIC="…" CONFIRM=DRYRUN npx tsx scripts/alp-dryrun.ts --broadcast
//
//  Paste the printed txids back to confirm before we touch anything real.
// =============================================================================

import { ChronikClient } from 'chronik-client'
import { Wallet } from 'ecash-wallet'
import { ALP_TOKEN_TYPE_STANDARD, fromHex } from 'ecash-lib'
import { randomBytes } from 'node:crypto'
import { CHRONIK_URLS } from '../lib/ecash/chronikEndpoints'
import { loadWallet, genesisAlp, sendAlp, burnToken, heldTokenAtoms } from '../lib/ecash/powToken'

// ---- throwaway token params (junk — nothing here is permanent) --------------
const DECIMALS = 2
const SUPPLY_WHOLE = 1000n // 1,000 whole → 100,000 atoms
const SEND_WHOLE = 250n // send 250 whole to the throwaway recipient
const GENESIS = {
  tokenTicker: 'POWTEST',
  tokenName: 'POW dry-run (throwaway)',
  url: 'https://proofofwriting.com/pow-token',
  decimals: DECIMALS,
}
// -----------------------------------------------------------------------------

const scale = 10n ** BigInt(DECIMALS)
const explorer = (txid: string) => `https://explorer.e.cash/tx/${txid}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Poll Chronik until the wallet's held atoms of tokenId reach `min` (indexing
 *  lag after a broadcast is usually sub-second, but be robust). */
async function waitForAtoms(address: string, tokenId: string, min: bigint, label: string) {
  for (let i = 0; i < 20; i++) {
    const held = await heldTokenAtoms(address, tokenId)
    if (held >= min) return held
    await sleep(1500)
  }
  throw new Error(`timed out waiting for ${label} (${min} atoms of ${tokenId})`)
}

async function main() {
  const mnemonic = process.env.POW_DRYRUN_MNEMONIC
  const skHex = process.env.POW_DRYRUN_SK
  if (!mnemonic && !skHex) {
    console.error('Set POW_DRYRUN_MNEMONIC (a TEST Cashtab seed) or POW_DRYRUN_SK (hex key).')
    console.error('Use a DEDICATED test wallet — not your real treasury/mint wallet.')
    process.exit(1)
  }

  const wallet = loadWallet({ mnemonic, skHex })
  await wallet.sync()
  const xec = Number(wallet.balanceSats) / 100

  console.log('\n--- ALP DRY RUN PLAN -----------------------------------------')
  console.log('test wallet   :', wallet.address)
  console.log('balance       :', xec.toLocaleString(), 'XEC')
  console.log('token         :', `${GENESIS.tokenName} [${GENESIS.tokenTicker}], ${DECIMALS} decimals`)
  console.log('genesis supply:', SUPPLY_WHOLE.toString(), 'whole →', (SUPPLY_WHOLE * scale).toString(), 'atoms')
  console.log('will SEND     :', SEND_WHOLE.toString(), 'whole to a throwaway address')
  console.log('will BURN     :', (SUPPLY_WHOLE - SEND_WHOLE).toString(), 'whole (the remainder)')
  console.log('--------------------------------------------------------------')

  const confirmed = process.argv.includes('--broadcast') && process.env.CONFIRM === 'DRYRUN'
  if (!confirmed) {
    console.log('\nDRY RUN — nothing broadcast.')
    if (xec < 20) console.log(`\nFund the test wallet above with ~20 XEC, then re-run with:`)
    else console.log(`\nWallet is funded. To run for real:`)
    console.log('  CONFIRM=DRYRUN npx tsx scripts/alp-dryrun.ts --broadcast')
    return
  }
  if (wallet.balanceSats < 2000n) {
    console.error('\nBalance too low for fees + 3 txs. Fund with ~20 XEC and re-run.')
    process.exit(1)
  }

  // a fresh throwaway recipient (its key is discarded — the test tokens sent here
  // are worthless and simply stranded; we only need a real "someone else" address)
  const recipient = Wallet.fromSk(fromHex(randomBytes(32).toString('hex')), new ChronikClient(CHRONIK_URLS))

  // 1) GENESIS ----------------------------------------------------------------
  console.log('\n[1/3] GENESIS…')
  const g = await genesisAlp(wallet, { ...GENESIS, atoms: SUPPLY_WHOLE * scale, includeBaton: false })
  console.log('   tokenId :', g.tokenId)
  console.log('   tx      :', explorer(g.tokenId))
  await waitForAtoms(wallet.address, g.tokenId, SUPPLY_WHOLE * scale, 'genesis supply')

  // 2) SEND -------------------------------------------------------------------
  console.log('\n[2/3] SEND', SEND_WHOLE.toString(), 'to', recipient.address, '…')
  const s = await sendAlp(wallet, { tokenId: g.tokenId, toAddress: recipient.address, atoms: SEND_WHOLE * scale })
  console.log('   tx      :', explorer(s.txid))
  await waitForAtoms(wallet.address, g.tokenId, (SUPPLY_WHOLE - SEND_WHOLE) * scale, 'send change')

  // 3) BURN the remainder -----------------------------------------------------
  console.log('\n[3/3] BURN the remainder…')
  const b = await burnToken(wallet, { tokenId: g.tokenId, tokenType: ALP_TOKEN_TYPE_STANDARD })
  console.log('   burned  :', b.burnedAtoms.toString(), 'atoms')
  console.log('   tx      :', explorer(b.txid))

  console.log('\n=============================================================')
  console.log(' DRY RUN COMPLETE — paste these back to confirm:')
  console.log('   GENESIS :', g.tokenId)
  console.log('   SEND    :', s.txid)
  console.log('   BURN    :', b.txid)
  console.log('=============================================================')
  console.log('If all three look right on the explorer, the toolkit is trustworthy.')
}

main().catch((e) => {
  console.error('\nDRY RUN FAILED:', e?.message ?? e)
  process.exit(1)
})
