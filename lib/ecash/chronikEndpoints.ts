// =============================================================================
//  lib/ecash/chronikEndpoints.ts  —  single source of truth for Chronik nodes
//
//  Every Chronik consumer (the client-side payment watch, the finality gate, the
//  verify/latest-tx REST routes, and all the wallet/mint/profile helpers) shares
//  ONE failover set from here, so the list never drifts between call sites.
//  ChronikClient tries these in order, pre-flight-probing each and falling
//  through to the next on failure — REST calls and websockets alike.
// =============================================================================

// General set: the public e.cash node first, then Fabien's three native mirrors.
// Used by everything EXCEPT Agora.
export const CHRONIK_URLS = [
  "https://chronik.e.cash",
  "https://chronik-native1.fabien.cash",
  "https://chronik-native2.fabien.cash",
  "https://chronik-native3.fabien.cash",
];

// Agora set: the native mirrors ONLY. The public chronik.e.cash node does NOT
// load the Agora plugin and 404s its plugin route, so it must be excluded here.
export const CHRONIK_AGORA_URLS = [
  "https://chronik-native1.fabien.cash",
  "https://chronik-native2.fabien.cash",
  "https://chronik-native3.fabien.cash",
];
