// scripts/utxo-check.ts — reports the mint wallet's coins and their state.
// Run: node --env-file=.env.local --import tsx scripts/utxo-check.ts
import { ChronikClient } from "chronik-client";

const ADDR = process.env.MINT_PAYMENT_ADDRESS || "ecash:qq703jnu09lw47vzp2xny4yh06twye8q65najumgcy";

async function main() {
  const chronik = new ChronikClient(["https://chronik.e.cash", "https://chronik-native.fabien.cash"]);
  const r: any = await chronik.address(ADDR).utxos();
  const utxos = Array.isArray(r) ? r.flatMap((x: any) => x.utxos ?? []) : (r.utxos ?? []);

  console.log("address    :", ADDR);
  console.log("utxo count :", utxos.length);
  for (const u of utxos) {
    console.log({
      sats: String(u.sats ?? u.value ?? "?"),
      blockHeight: u.blockHeight,          // -1 means unconfirmed
      isFinal: u.isFinal,                  // avalanche-finalized?
      token: u.token ? (u.token.tokenId ?? "yes") : null,
    });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
