import { GET as watchWalletAuth } from '../../watch-wallet-auth/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  return watchWalletAuth(request)
}
