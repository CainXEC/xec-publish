// scripts/host-one-card.ts
// Render the voxel card for a handle + token id and upload it to Supabase Storage,
// exercising the exact hostHandleCard path the mint pipeline uses. Great for
// verifying image hosting in isolation on a real token id.
//
// Run:
//   node --env-file=.env.local --import tsx scripts/host-one-card.ts \
//     --handle zztest01 --token 707fc16335cbf867593d7e9cbed64c3d098e61b451fd6f90390526ae60c2b1ac
//
// Needs in .env.local: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and the public
// bucket `nft` created. Font at assets/fonts/CourierPrime-Bold.ttf.

import { hostHandleCard, rasterizeHandleCard } from "../lib/hostHandleCard";

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

  // 1) prove the render works locally (writes a local PNG you can open)
  const png = rasterizeHandleCard(handle, token);
  const { writeFileSync } = await import("node:fs");
  writeFileSync("card-preview.png", png);
  console.log(`Rendered ${png.length} bytes -> ./card-preview.png (open it to eyeball the card)`);

  // 2) upload via the real pipeline path
  const url = await hostHandleCard(handle, token);
  if (url) {
    console.log("\nHOSTED:");
    console.log("  " + url);
    console.log("\nOpen that URL in a browser — that's the image wallets/explorers would use.");
  } else {
    console.error("\nhostHandleCard returned null — check the [hostHandleCard] warning above (bucket name, font path, or keys).");
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
