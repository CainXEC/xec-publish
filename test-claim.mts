// test-claim.mts — throwaway driver for a single grandfather claim.
//
//   node --env-file=.env.local --import tsx test-claim.mts start zztestclaim TESTCLAIM123456
//     -> locks the grant, prints the proof amount + address to send dust to
//
//   node --env-file=.env.local --import tsx test-claim.mts poll  zztestclaim
//     -> after you've sent the dust, detects it, mints, binds, flips to claimed
//
//   (optional) pass a txid to poll the exact tx instead of scanning:
//   node --env-file=.env.local --import tsx test-claim.mts poll  zztestclaim <txid>

import { startClaim, pollClaim } from './lib/claimGrant'

const [, , cmd, handle, arg] = process.argv

async function main() {
  if (cmd === 'start') {
    const r = await startClaim({ handle, code: arg })
    console.log(JSON.stringify(r, null, 2))
    if (r.ok) {
      console.log(`\n>>> Send ${r.amountXec} XEC to ${r.proofAddress} from caincurrency's wallet, then run the poll command.`)
    }
    return
  }
  if (cmd === 'poll') {
    const r = await pollClaim({ handle, txid: arg })
    console.log(JSON.stringify(r, null, 2))
    return
  }
  console.log('usage: start <handle> <code>  |  poll <handle> [txid]')
}

main().catch((e) => { console.error(e); process.exit(1) })
