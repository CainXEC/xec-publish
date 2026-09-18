// =============================================================================
//  powToken.ts — ALP/SLP token toolkit for the POW migration (Part A).
//
//  The four on-chain primitives the swap service needs, factored out so they can
//  be proven on a throwaway token FIRST (scripts/alp-dryrun.ts) before the real,
//  irreversible 1B genesis ever runs:
//
//    genesisAlp   — create the new ALP POW token (one-shot; the txid IS the id).
//    sendAlp      — send ALP to an address (the swap payout).
//    burnToken    — burn a token the wallet holds (the received old SLP).
//    readTokenDeposit — parse an inbound deposit tx → { sender, atoms }.
//
//  Modeled on the verified genesis/mint code (scripts/genesis-handle-group.ts,
//  lib/mintHandleChild.ts) — same ecash-lib/ecash-wallet action shapes:
//  `wallet.action({ outputs, tokenActions }).build().broadcast()`, with the
//  mandatory blank OP_RETURN slot ({sats:0n}) at outputs[0] whenever there are
//  tokenActions, and every token output declaring its 546-sat dust.
//
//  ⚠ SERIALIZE sends/burns from one wallet — concurrent actions race on UTXOs.
// =============================================================================

import { Wallet } from 'ecash-wallet'
import { ChronikClient } from 'chronik-client'
import {
  ALP_TOKEN_TYPE_STANDARD,
  SLP_TOKEN_TYPE_FUNGIBLE,
  payment,
  fromHex,
  Script,
  type TokenType,
} from 'ecash-lib'
import { encodeOutputScript, getOutputScriptFromAddress } from 'ecashaddrjs'
import { CHRONIK_URLS } from './chronikEndpoints'

const DUST = 546n

/** "ecash:"-prefixed form (Chronik's address() wants it). */
function prefixed(address: string): string {
  const a = (address ?? '').trim()
  return a.startsWith('ecash:') ? a : `ecash:${a}`
}

/** Normalize a broadcast response to a txid list. ecash-wallet returns either
 *  `{ success, broadcasted: [txid,…] }` (mintHandleChild) or `{ txid }` / a bare
 *  string (genesis-handle-group) depending on the action — handle all. */
function broadcastTxids(resp: any): string[] {
  if (resp && resp.success === false) {
    throw new Error('broadcast failed: ' + JSON.stringify(resp))
  }
  if (Array.isArray(resp?.broadcasted) && resp.broadcasted.length) return resp.broadcasted
  if (typeof resp?.txid === 'string') return [resp.txid]
  if (Array.isArray(resp) && resp.length) return resp
  if (typeof resp === 'string' && resp) return [resp]
  throw new Error('broadcast returned no txid: ' + JSON.stringify(resp))
}

/** Build a Wallet from a Cashtab mnemonic or a hex private key. */
export function loadWallet(
  creds: { mnemonic?: string; skHex?: string },
  chronikUrls: string[] = CHRONIK_URLS,
): Wallet {
  const chronik = new ChronikClient(chronikUrls)
  if (creds.skHex) return Wallet.fromSk(fromHex(creds.skHex), chronik)
  if (creds.mnemonic) return Wallet.fromMnemonic(creds.mnemonic, chronik)
  throw new Error('loadWallet: provide skHex or mnemonic')
}

/** Total atoms of `tokenId` currently held by `address` (from Chronik UTXOs). */
export async function heldTokenAtoms(address: string, tokenId: string): Promise<bigint> {
  const chronik = new ChronikClient(CHRONIK_URLS)
  const res: any = await chronik.address(prefixed(address)).utxos()
  let atoms = 0n
  for (const u of res?.utxos ?? []) {
    if (u?.token?.tokenId !== tokenId) continue
    // chronik-client exposes token amount as `atoms` (newer) or `amount` (older).
    const raw = u.token.atoms ?? u.token.amount ?? 0
    try {
      atoms += BigInt(raw)
    } catch {
      /* skip an unparseable amount rather than throw */
    }
  }
  return atoms
}

export interface GenesisAlpParams {
  tokenTicker: string
  tokenName: string
  url: string
  decimals: number
  /** FULL supply in atoms = whole tokens × 10^decimals (e.g. 1B @ 2 = 100000000000n). */
  atoms: bigint
  /** Keep a mint baton (extendable supply). Default false → FIXED supply forever. */
  includeBaton?: boolean
  /** Recipient of the full supply. Default: the minting wallet's own address. */
  toAddress?: string
}

/**
 * Genesis a new ALP standard token. ONE-SHOT: the genesis txid IS the token id.
 * With includeBaton=false (default) the supply is fixed forever — no baton, so
 * more can never be minted. Returns the token id + broadcast txids.
 */
export async function genesisAlp(
  wallet: Wallet,
  p: GenesisAlpParams,
): Promise<{ tokenId: string; txids: string[] }> {
  await wallet.sync()
  const to = p.toAddress ?? wallet.address
  const outputs: any[] = [
    { sats: 0n }, // mandatory blank OP_RETURN slot for the token action
    {
      sats: DUST,
      address: to,
      tokenId: payment.GENESIS_TOKEN_ID_PLACEHOLDER, // id unknown until minted
      atoms: p.atoms,
      isMintBaton: false,
    },
  ]
  if (p.includeBaton) {
    outputs.push({
      sats: DUST,
      address: to,
      tokenId: payment.GENESIS_TOKEN_ID_PLACEHOLDER,
      atoms: 0n,
      isMintBaton: true,
    })
  }
  const action = {
    outputs,
    tokenActions: [
      {
        type: 'GENESIS',
        tokenType: ALP_TOKEN_TYPE_STANDARD,
        genesisInfo: {
          tokenName: p.tokenName,
          tokenTicker: p.tokenTicker,
          url: p.url,
          decimals: p.decimals,
        },
      },
    ],
  }
  const built: any = wallet.action(action as any).build()
  const resp: any = await built.broadcast()
  const txids = broadcastTxids(resp)
  return { tokenId: txids[txids.length - 1], txids } // genesis is the LAST tx
}

/**
 * Send ALP to an address (the swap payout). ecash-wallet auto-adds token change
 * (the remaining atoms return to the sending wallet). Returns the send txid.
 */
export async function sendAlp(
  wallet: Wallet,
  p: { tokenId: string; toAddress: string; atoms: bigint },
): Promise<{ txid: string; txids: string[] }> {
  await wallet.sync()
  const action = {
    outputs: [
      { sats: 0n },
      { sats: DUST, address: p.toAddress, tokenId: p.tokenId, atoms: p.atoms, isMintBaton: false },
    ],
    tokenActions: [{ type: 'SEND', tokenId: p.tokenId, tokenType: ALP_TOKEN_TYPE_STANDARD }],
  }
  const built: any = wallet.action(action as any).build()
  const resp: any = await built.broadcast()
  const txids = broadcastTxids(resp)
  return { txid: txids[txids.length - 1], txids }
}

/**
 * Send a token to MANY recipients in ONE tx (the weekly reward payout). SLP Type 1
 * caps a send at 19 token outputs, so the caller MUST batch ≤19 recipients per
 * call. ecash-wallet auto-adds token change back to the sending wallet. Defaults
 * to SLP fungible (POW); pass ALP_TOKEN_TYPE_STANDARD for an ALP token.
 */
export async function sendTokenBatch(
  wallet: Wallet,
  p: { tokenId: string; recipients: { address: string; atoms: bigint }[]; tokenType?: TokenType },
): Promise<{ txid: string; txids: string[] }> {
  if (p.recipients.length === 0) throw new Error('sendTokenBatch: no recipients')
  if (p.recipients.length > 19) throw new Error('sendTokenBatch: >19 recipients (SLP cap) — batch upstream')
  await wallet.sync()
  const outputs: any[] = [{ sats: 0n }] // mandatory blank OP_RETURN slot
  for (const r of p.recipients) {
    if (r.atoms <= 0n) throw new Error('sendTokenBatch: non-positive atoms for ' + r.address)
    // A token SEND output must carry a SCRIPT, not an address — unlike GENESIS,
    // ecash-wallet's SEND path does not derive the script from an address
    // ("Token send output must have a script defined"). Build it from the addr.
    outputs.push({
      sats: DUST,
      script: Script.fromAddress(prefixed(r.address)),
      tokenId: p.tokenId,
      atoms: r.atoms,
      isMintBaton: false,
    })
  }
  const action = {
    outputs,
    tokenActions: [{ type: 'SEND', tokenId: p.tokenId, tokenType: p.tokenType ?? SLP_TOKEN_TYPE_FUNGIBLE }],
  }
  const built: any = wallet.action(action as any).build()
  const resp: any = await built.broadcast()
  const txids = broadcastTxids(resp)
  return { txid: txids[txids.length - 1], txids }
}

/**
 * Burn ALL of a token the wallet currently holds. A BURN action with no SEND (and
 * no token outputs) burns every input of that tokenId — see ecash-lib BurnAction.
 * `burnAtoms` must equal the total held, so we read it from Chronik first. Used to
 * destroy the old SLP a swap received (call it per-deposit, before another lands).
 * tokenType defaults to SLP fungible (the old POW); pass ALP_TOKEN_TYPE_STANDARD
 * to burn ALP instead.
 */
export async function burnToken(
  wallet: Wallet,
  p: { tokenId: string; tokenType?: TokenType },
): Promise<{ txid: string; txids: string[]; burnedAtoms: bigint }> {
  await wallet.sync()
  const held = await heldTokenAtoms(wallet.address, p.tokenId)
  if (held <= 0n) throw new Error('burnToken: wallet holds no ' + p.tokenId)
  const action = {
    outputs: [{ sats: 0n }], // OP_RETURN slot only; no token outputs → burn all inputs
    tokenActions: [
      {
        type: 'BURN',
        tokenId: p.tokenId,
        tokenType: p.tokenType ?? SLP_TOKEN_TYPE_FUNGIBLE,
        burnAtoms: held,
      },
    ],
  }
  const built: any = wallet.action(action as any).build()
  const resp: any = await built.broadcast()
  const txids = broadcastTxids(resp)
  return { txid: txids[txids.length - 1], txids, burnedAtoms: held }
}

/**
 * Parse an inbound deposit tx (from Chronik) for the swap route: the atoms of
 * `tokenId` delivered to `toAddress`, and the sender (first input's address, the
 * ALP return address). Returns null if the tx sent none of `tokenId` to the
 * address. Pure — no network.
 */
export function readTokenDeposit(
  tx: any,
  opts: { tokenId: string; toAddress: string },
): { senderAddress: string; atoms: bigint } | null {
  const wantScript = getOutputScriptFromAddress(prefixed(opts.toAddress)).toLowerCase()
  let atoms = 0n
  for (const out of tx?.outputs ?? []) {
    const script = String(out?.outputScript ?? '').toLowerCase()
    if (script !== wantScript) continue
    if (out?.token?.tokenId !== opts.tokenId) continue
    try {
      atoms += BigInt(out.token.atoms ?? out.token.amount ?? 0)
    } catch {
      /* skip unparseable */
    }
  }
  if (atoms <= 0n) return null

  const firstInputScript = tx?.inputs?.[0]?.outputScript
  let senderAddress = ''
  if (firstInputScript) {
    try {
      senderAddress = encodeOutputScript(firstInputScript, 'ecash')
    } catch {
      senderAddress = String(firstInputScript)
    }
  }
  return { senderAddress, atoms }
}
