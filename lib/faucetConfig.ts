// =============================================================================
//  lib/faucetConfig.ts — the welcome faucet's live config + its public offer.
//
//  Split out of lib/faucet.ts so pages can ask "is the gift on?" without loading
//  the claim machinery (Chronik, ecash-lib, the wallet). lib/faucet.ts imports
//  the config from here.
//
//  The off switch is pow_reward_config id='faucet' → config.enabled = false
//  (live, no deploy). Logged-out copy (the feed's get-started strip + the Get
//  started modal) reads faucetOffer(), so switching it off also stops the site
//  promising the gift.
// =============================================================================

import { unstable_cache } from "next/cache";
import { adminDb } from "@/lib/db";

export interface FaucetConfig {
  enabled: boolean;
  xecPerClaim: number; // whole XEC
  powPerClaim: number; // whole POW
  dailyXecCap: number; // whole XEC per UTC day
  dailyPowCap: number; // whole POW per UTC day
  sourceAddress: string; // Cashtab's new-wallet faucet
  sourceMinSats: number; // min plain payment from it that counts (4200 = 42 XEC)
}

export const DEFAULT_FAUCET_CONFIG: FaucetConfig = {
  enabled: true,
  xecPerClaim: 2500, // room to post/react/unlock AND fund the Pocket's 1,000 XEC preset
  powPerClaim: 10, // == the base-tier handle price in POW
  dailyXecCap: 25000, // 10 claims/day at 2,500
  dailyPowCap: 100,
  sourceAddress: "ecash:qzppgpav9xfls6zzyuqy7syxpqhnlqqa5u68m4qw6l",
  sourceMinSats: 4200,
};

/** The live config, or null when it couldn't be read. */
async function readFaucetConfig(): Promise<FaucetConfig | null> {
  try {
    const { data, error } = await adminDb().from("pow_reward_config").select("config").eq("id", "faucet").maybeSingle();
    if (error) return null;
    return { ...DEFAULT_FAUCET_CONFIG, ...((data?.config ?? {}) as Partial<FaucetConfig>) };
  } catch {
    return null;
  }
}

export async function loadFaucetConfig(): Promise<FaucetConfig> {
  return (await readFaucetConfig()) ?? DEFAULT_FAUCET_CONFIG;
}

export function walletConfigured(): boolean {
  return !!process.env.PATRON_WALLET_MNEMONIC?.trim();
}

export interface FaucetOffer {
  open: boolean; // switched on with a sender configured — NOT an eligibility check
  xec: number;
  pow: number;
}

// Shared across requests for 60s. A failed read throws, so it's never cached.
const cachedOffer = unstable_cache(
  async (): Promise<FaucetOffer> => {
    const cfg = await readFaucetConfig();
    if (!cfg) throw new Error("faucet config unreadable");
    return { open: cfg.enabled && walletConfigured(), xec: cfg.xecPerClaim, pow: cfg.powPerClaim };
  },
  ["faucet-offer"],
  { revalidate: 60 },
);

/** Is the welcome gift on, and for how much? Fails CLOSED: if the config can't
 *  be read, the site doesn't promise a gift it couldn't confirm. */
export async function faucetOffer(): Promise<FaucetOffer> {
  try {
    return await cachedOffer();
  } catch {
    return { open: false, xec: DEFAULT_FAUCET_CONFIG.xecPerClaim, pow: DEFAULT_FAUCET_CONFIG.powPerClaim };
  }
}
