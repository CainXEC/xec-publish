// scripts/host-one-ascii-card.ts
// Host the Gen-1 ASCII card + register the Cashtab icon for a SINGLE handle,
// mirroring lib/mintProcessor.ts (→ hostAsciiCard). Use this for handles minted
// via the standalone mint-one-handle.ts, which does the on-chain mint but skips
// card hosting / icon registration.
//
//   node --env-file=.env.local --import tsx scripts/host-one-ascii-card.ts \
//     --handle proofofwriting --token <childTokenId>
//
// Needs in .env.local: SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// (Supabase storage upload) and MINT_WALLET_MNEMONIC/SK (Cashtab icon signing).

import { hostAsciiCard } from "../lib/nft-art/hostAsciiCard";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const handle = arg("handle");
  const token = arg("token");
  if (!handle || !token) {
    console.error("Usage: --handle <handle> --token <childTokenId>");
    process.exit(1);
  }

  console.log(`Hosting ASCII card for @${handle} (token ${token.slice(0, 12)}…)`);
  const url = await hostAsciiCard(handle, token);
  if (!url) {
    console.error("hostAsciiCard returned null — check the warning above (bucket name, keys, or font path).");
    process.exit(1);
  }
  console.log("HOSTED CARD:", url);

  const iconUrl = `https://icons.etokens.cash/128/${token}.png`;
  try {
    const res = await fetch(iconUrl);
    const type = res.headers.get("content-type") ?? "";
    if (res.ok && type.startsWith("image/")) {
      console.log("CASHTAB ICON live ✓", iconUrl);
    } else {
      console.log(`CASHTAB ICON not served yet (HTTP ${res.status}, ${type || "no type"})`);
    }
  } catch (e) {
    console.log("icon check failed:", e instanceof Error ? e.message : e);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
