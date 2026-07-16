# The Pocket × Cashtab message signing — integration notes for Bitcoin ABC

**From:** proofofwriting.com
**Audience:** Cashtab / ecash-lib maintainers
**TL;DR:** We derive an in-browser spending key from `signMsg` output. That makes
your deterministic message signing a **load-bearing property** for user funds on
our platform — we'd like it treated as frozen behavior, and we're requesting a
site-facing `signMessage` API in Cashtab so the flow can drop its one manual
step (and its only stored secret).

---

## 1. What the Pocket is

proofofwriting.com is an eCash pay-per-read publishing platform. Every
interaction is a real on-chain payment (like = 100 XEC, replies, tips, article
unlocks, comments). Routing each of those through a Cashtab approval killed the
high-frequency interactions, so we built **the Pocket**: a small, non-custodial
second address per account whose private key lives only in the user's browser.
Users load it from Cashtab once (a few thousand XEC — pocket change), then every
small action signs locally and broadcasts instantly. Big/deliberate actions and
anything that proves wallet ownership stay in Cashtab.

The pocket key is **derived, never generated**:

```
sk_pocket = sha256( signMsg(POCKET_SENTENCE, wallet_sk) )
```

The user signs one fixed sentence in Cashtab's Sign & Verify screen and pastes
the signature into our site. Because `signMsg` is deterministic, the same
wallet signing the same sentence yields the same signature — and therefore the
same pocket key — forever, on any device. That's the whole recovery story:
nothing to back up, no second seed phrase. Clear your cache, buy a new laptop,
sign the sentence again, and the same funded address reappears. The derivation
is published (this document), so even if our site vanishes, anyone with their
wallet seed can reconstruct the key offline with ecash-lib and sweep.

The signature never leaves the browser. Our server sees only the derived
**public** key plus a possession proof (§4).

## 2. Exact derivation spec

Everything below is pinned by golden-vector tests in our CI (§6); a change in
any byte breaks our build before it can strand a user.

**The sentence** (`POCKET_SENTENCE_V1`, frozen, 127 chars, pure printable ASCII):

```
proofofwriting.com Pocket v1: I authorize this signature to create my Pocket spending key. Only paste it on proofofwriting.com.
```

**The signature** — exactly ecash-lib's `signMsg(msg, sk)` as shipped in
`ecash-lib@4.13.0` and used by Cashtab's Sign & Verify screen:

```
magicHash(msg) = sha256d( varint(22) ‖ "eCash Signed Message:\n" ‖ varint(len(msg)) ‖ msg )
signMsg(msg, sk) = base64( signRecoverable(sk, magicHash(msg)) )
```

- `signRecoverable` → 65-byte compact recoverable ECDSA signature
  (header byte with recovery id, then r ‖ s), **RFC 6979 derandomized nonce**
  — no timestamp, no salt, no auxiliary randomness anywhere in the pipeline.
- base64 of 65 bytes → the 88-character string users paste.

**Key derivation from the pasted signature:**

```
sig   = base64decode(pasted)                  // must be exactly 65 bytes
sk    = sha256(sig)
while !secp256k1_is_valid_seckey(sk): sk = sha256(sk)   // ~2^-128, but deterministic
pk    = derivePubkey(sk)                      // 33-byte compressed
addr  = P2PKH cashaddr, prefix "ecash"        // hash160 = shaRmd160(pk)
```

## 3. The full user workflow today

**Create (once) / Restore (any device):**

1. User logs into our site as usual (our wallet-payment challenge login).
2. `/pocket` shows the sentence with a copy button and a link to
   `https://cashtab.com/#/signverifymsg`.
3. In Cashtab — with their login wallet active — the user pastes the sentence,
   signs, copies the 88-char signature.
4. Back on our site they paste it. Client-side we:
   - `verifyMsg(POCKET_SENTENCE_V1, sig, <account's login address>)` — catches
     "signed with the wrong wallet" before anything derives;
   - derive `sk/pk/addr` per §2 (in the page, never transmitted);
   - ask our server which pocket this account has registered:
     - **matches the derived address** → pure restore, no server write;
     - **differs** → freeze and warn (wrong wallet, or determinism broke —
       we never silently mint a replacement);
     - **none** → register (§4), then prompt the user to clear their clipboard.
5. Fund: a normal Cashtab BIP21 payment to the pocket address; the request
   carries an OP_RETURN delegation (§5).

**Spending:** client-side `ecash-wallet` (`Wallet.fromSk`) builds the same
outputs a Cashtab payment would have made (94/6 splits + our POWR OP_RETURN),
broadcasts via Chronik, and our server verifies the txid on-chain before
recording anything. Cashtab remains the fallback for anything the pocket can't
afford — and the only path for login, address changes, and NFT mints (the mint
delivers to the paying address, which must never be a browser key).

## 4. Registration & the second signMsg use

Linking the pocket address to the account requires possession proof — without
it, a logged-in attacker could register a stranger's address as "their pocket."
The client signs, **with the pocket key**, the string:

```
powpocket-register|v1|account:<accountId>|pocket:<bare cashaddr>
```

via the same `signMsg`, and our server checks it with `verifyMsg` against the
pocket address. So both signing directions matter to us: the wallet key signs
the sentence (client-verified), the derived key signs the registration proof
(server-verified).

A registered pocket address is marked server-side and is **rejected by our
login and address-change flows** — a stolen pocket key caps at spending the
pocket change; it can never become or take over an account.

## 5. On-chain delegation (POWR action 12)

Funding payments to the pocket carry our POWR envelope (LOKAD `POWR`,
`504f5752`) with a new additive action — the funding wallet publicly endorsing
its spending key:

```
6a  04 504f5752  00  5c  21 <33-byte compressed pocket pubkey>
    LOKAD        v0  OP_12   push(33)
```

This makes the wallet↔pocket link reconstructable from chain alone. Decoders
that predate OP_12 simply show an unparsed data output — harmless. (Full POWR
spec: docs/cashtab-powr-integration.md.)

## 6. Test vectors

Golden vectors from our CI canary (throwaway key — never a real wallet).
Reproduce with `ecash-lib@4.13.0`:

```js
const { Ecc, signMsg, sha256, shaRmd160, toHex } = require('ecash-lib')
const { encodeCashAddress } = require('ecashaddrjs')

const walletSk = sha256(new TextEncoder().encode('pow-pocket-golden-wallet'))
// walletSk  = f4d8e47eef8975edb8c3d25513306742d3f8edcf9554a11d4a424c1d1e371065
// walletAddr= ecash:qp5kphz2sq69fsaw6su5gn3fpsa5wp6j7yw8rpf3fd

const SENTENCE = 'proofofwriting.com Pocket v1: I authorize this signature to create my Pocket spending key. Only paste it on proofofwriting.com.'
// sha256(SENTENCE) = b33713a2b726710a591392839c5546090b60d176611f2a2e4046c4c5eaf1f745
// magicHash(SENTENCE) = 20242c663312274e6ee34a7fede9c417eef657f2efc8b1a9432d29b84a7ffad2

signMsg(SENTENCE, walletSk)
// = "IFJMjVp51zPfyPaZQR1ubJ9DFXSixEm4L9cjYJfh3U5ALcS53Akbn+Kaqyf6UJ/GoIlYy8oL5eMMTCuAeVntIy0="

// Derived pocket:
// sk   = 7c473a183b46d05ca20709eaa840f979ff33171f2094a4c9361a102ee127dce5
// pk   = 029984069acc9c8069bf74ef6329fe830f00c0c91f43f814ca3621ee9d041c2d48
// addr = ecash:qpsxhjn66jxdms06nv89k5n5uply6vk3fvjhetxzla
```

Our test suite signs this 1,000+ ways (repeat calls, re-imported keys, fresh
processes during development) and fails the build on any drift.

## 7. What we're asking of ABC

**7.1 — Treat `signMsg` behavior as a frozen property, not an implementation
detail.** User funds now depend on: the `"eCash Signed Message:\n"` magic-hash
construction, RFC 6979 derandomized signing in `signRecoverable`, and the
65-byte-compact/base64 output format. If any of that ever changes (e.g. adding
auxiliary randomness for side-channel hardening), every existing pocket would
re-derive to a different, empty address. If hardening is ever needed, please
version it (`signMsg2`) rather than changing `signMsg` in place. We're happy to
contribute our golden vectors as an ecash-lib regression test.

**7.2 — Keep Cashtab's Sign & Verify message limit ≥ 128 characters.** Our
sentence is 127 chars; the current limit is 200. A silent reduction would break
pocket creation (not existing pockets).

**7.3 — Feature request: site-facing message signing.** Today's flow works, but
its weakest links exist *only because pages can't request a signature*:

- the user manually copies a secret-equivalent string through the OS clipboard;
- we must persist the derived key in localStorage so the ceremony isn't
  per-session;
- a phishing page can ask users to sign the same sentence and paste it *there*.

A `signMessage` request in the extension (and cashtab-connect) fixes all three:

```ts
// cashtab-connect sketch
const { signature, address } = await connect.signMessage(message)
// Extension popup shows: requesting ORIGIN + the full message text,
// signs with the ACTIVE wallet on approval — same UX contract as
// createTransactionFromBip21's approval popup.
```

With that, the pocket becomes **fully storage-less**: one approval popup at
login, key re-derived in memory each session, nothing in localStorage, no
clipboard, and the origin shown in the popup gives users a real phishing
signal. We'd gladly test a draft implementation on our preview environment,
and the same primitive unlocks message-signature login for any eCash app —
several of our flows (and, we suspect, other builders') currently burn a
5.5 XEC dust payment where a signature would do.

---

*Contact: @proofofwriting — happy to hop into Phabricator/GitHub threads or
supply more vectors.*
