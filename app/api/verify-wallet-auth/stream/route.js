export const runtime = 'nodejs'

import { GET as watchWalletAuth } from '../../watch-wallet-auth/route'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return watchWalletAuth(request)
}
