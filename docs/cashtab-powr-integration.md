# Cashtab integration: "POWR" protocol (Proof of Writing)

This is a handoff spec for adding parsing + display of the **Proof of Writing**
protocol to Cashtab. It has two parts:

1. **The frozen on-chain byte spec** — the contract. This describes exactly what our
   site writes into the OP_RETURN of every platform transaction. It is immutable once
   we launch (real transactions on-chain reference these exact bytes).
2. **PR-ready Cashtab cases** — drop-in parse / render / icon code implementing the
   spec in the `Bitcoin-ABC/bitcoin-abc` monorepo. Cosmetics (icon, label wording)
   are safe to change later in a follow-up PR.

Scope note: this integration is **display-only**. Cashtab shows an icon and a label
identifying the transaction type. It renders **no links** — spoofed POWR transactions
sent to arbitrary users can therefore never present a tappable link of any kind.

---

## 1. Frozen on-chain byte spec

**LOKAD ID:** `POWR` = `0x504f5752` (4 bytes, ASCII).

One LOKAD ID covers all proofofwriting.com transaction types: feed actions, article
publishes, article unlocks, wallet-auth logins, and handle-NFT mint payments.

Every action is a single OP_RETURN output. The layout of the output script:

```
OP_RETURN                 (0x6a)
<push 4> 504f5752         LOKAD prefix "POWR"
OP_0                      protocol version 0 (bare opcode)
OP_N                      action, bare opcode: OP_1..OP_11 (see table)
[pushdata(s)]             per-action payload, see table
```

Per-action layout:

| Action  | Opcode | Push 1              | Push 2              | Meaning                          |
|---------|--------|---------------------|---------------------|----------------------------------|
| post    | OP_1   | contentHash (32B)   | —                   | New feed post                    |
| reply   | OP_2   | targetTxid (32B)    | contentHash (32B)   | Reply to a feed post             |
| quote   | OP_3   | targetTxid (32B)    | contentHash (32B)   | Quote of a feed post             |
| repost  | OP_4   | targetTxid (32B)    | —                   | Repost of a feed post            |
| like    | OP_5   | targetTxid (32B)    | —                   | Like (tip) of a feed post        |
| publish | OP_6   | contentHash (32B)   | —                   | Article published (anchor)       |
| unlock  | OP_7   | —                   | —                   | Article paywall unlock           |
| auth    | OP_8   | nonce (36B)         | —                   | Wallet login challenge payment   |
| handle  | OP_9   | nonce (36B)         | —                   | Handle NFT mint payment          |
| comment | OP_10  | contentHash (32B)   | —                   | Article comment (top-level)      |
| creply  | OP_11  | targetTxid (32B)    | contentHash (32B)   | Reply to an article comment      |

Article comments are priced and split like the feed (94% author / 6% platform),
but pay the ARTICLE author (comment) or the PARENT comment's author (creply).
They get their own action codes so they read as comments — not feed posts —
on-chain. A comment reply to a legacy (pre-paid) comment has no parent txid to
target, so it is emitted as a plain `comment` (OP_10); the thread link lives in
our DB, not on-chain.

Notes:
- `version` and `action` are **bare opcodes** (`OP_0`, `OP_1`..`OP_11`), which
  `ecash-lib`'s `getStackArray` decodes as one-byte stack entries `"00"`, `"51"`..`"5b"`.
- `targetTxid` and `contentHash` are each a 32-byte pushdata (push opcode `0x20`).
- `nonce` is a 36-byte pushdata (push opcode `0x24`): the ASCII bytes of a
  standard UUID string (e.g. `550e8400-e29b-41d4-a716-446655440000`), matching
  what our auth server already issues today.
- `contentHash` is sha256 of the stored UTF-8 content ("proof of writing"). It lets a
  reader verify text against the chain; the wallet does not need to render it.
- `targetTxid` is the referenced feed transaction (reply→parent,
  quote/repost/like→target).
- `unlock` carries no payload — it is the minimal 8-byte LOKAD marker
  (`6a 04 504f5752 00 57`). Attribution of unlocks to articles lives in our
  database, not on-chain.
- The nonce is single-use and server-issued (auth: login challenge with 5-minute
  expiry; handle: mint payment nonce). It authenticates nothing by itself; our
  server matches it against an issued challenge/payment record, so spoofed auth
  and handle transactions are inert.
- Max size is the reply/quote form ≈ 74 bytes — well within the OP_RETURN budget.

Worked example — a **reply** (`OP_2`), target `aaaa…` (32B), hash `bbbb…` (32B):

```
6a 04 504f5752 00 52 20<32B target> 20<32B hash>
```

Worked example — an **unlock** (`OP_7`):

```
6a 04 504f5752 00 57
```

Worked example — a **handle** mint payment (`OP_9`), mint id `d66cb66c-…` (36B ASCII):

```
6a 04 504f5752 00 59 24<36B uuid>
```

### 1.1 Chronik indexing (why the envelope)

Because the 4-byte LOKAD is the **first push** after `OP_RETURN`, Chronik files every
one of these under the `POWR` LOKAD id: `chronik.lokadId('504f5752').history()`
returns them, and a websocket subscription to the LOKAD is a real-time firehose of all
platform activity. This is the reason the non-feed actions were migrated off their old
bare-UUID push (`6a 24 <36B uuid>`): a bare 36-byte first push has **no** LOKAD, so
Chronik indexed it under nothing — findable only by address or txid, never as "a
Proof-of-Writing action." All eleven actions share the one LOKAD; consumers filter by the
action opcode (e.g. `stackArray[2] === '59'` for a handle mint payment).

### 1.2 Example txids (live mainnet, POWR)

One real transaction per action, all on the launch LOKAD `504f5752` ("POWR"). Each was
verified to decode to the action + payload shape in the table above; pull them via
Chronik to seed the parser test fixtures and sanity-check against real on-chain bytes.

| # | Action  | Opcode | Example txid |
|---|---------|--------|--------------|
| 1 | post    | OP_1   | `c3a1a35aefc0111481c3246df2121d1321cb27516fd27e794b3fd4f461f6d6a3` |
| 2 | reply   | OP_2   | `2782443f28af38f4291f32ad9865407cdc7a3f6e785ce2d947cd66b60b4b2eee` |
| 3 | quote   | OP_3   | `156619e4718a6d9a18ff1f571e3639df9eace7d596a5c8ac6788d418d19f0fde` |
| 4 | repost  | OP_4   | `aace15c9e2e4c4d5750786aa4098b045c123ff87afa1bc01c276891021f4e0c8` |
| 5 | like    | OP_5   | `a8b76c155069dbd78f281a90ab3da3e3647222cc52a305a7c21daced6cc1977b` |
| 6 | publish | OP_6   | `eafbaa6dd8429c617e3050b2d22026806732ca298a042e0f7a68af16b1857dc9` |
| 7 | unlock  | OP_7   | `f846d4693c1e44dfb9a11aa9e182d92b908c31f61c3943707eaf4cdc123550f2` |
| 8 | auth    | OP_8   | `df4c499cf2d2e7f4262ccf8a68e27476999c8c6dfc4db19d8416dd9d70bc1ec8` |
| 9 | handle  | OP_9   | `84eeebf0402f500b8924d7e07d41ed108b96909648147cfed6d368113072343c` |

(Superseded the earlier draft's examples, which were on the PROW test LOKAD `50524f57`
— and the handle one, pre-migration bare-UUID — so they would not have matched a
POWR-keyed parser.)

---

## 2. PR-ready Cashtab cases

Files to touch (paths in `Bitcoin-ABC/bitcoin-abc`):

1. `modules/ecash-parse/src/constants/opreturn.ts` — add the LOKAD constant
2. `cashtab/src/config/opreturn.ts` — add the **same** constant (duplicate; keep in sync)
3. `modules/ecash-parse/src/types.ts` — add `PowAction`
4. `modules/ecash-parse/src/parseTx.ts` — parse case
5. `cashtab/src/components/Common/CustomIcons.tsx` — icon
6. `cashtab/src/components/Home/Tx/index.tsx` — render case
7. (optional) `modules/ecash-parse/src/getTxNotificationMsg.ts` — toast text
8. tests/fixtures

### 2.1 LOKAD constant (both `opreturn.ts` copies)

```ts
appPrefixesHex: {
    // ...existing...
    pow: '504f5752', // ASCII "POWR" — Proof of Writing
},
```

### 2.2 Action type — `modules/ecash-parse/src/types.ts`

```ts
export interface PowAction {
    type:
        | 'post'
        | 'reply'
        | 'quote'
        | 'repost'
        | 'like'
        | 'publish'
        | 'unlock'
        | 'auth'
        | 'handle'
        | 'comment'
        | 'comment_reply';
    /** referenced tx (hex txid); present for reply/quote/repost/like/comment_reply */
    targetTxid?: string;
    /** sha256 of stored content (hex); present for post/reply/quote/publish/comment/comment_reply */
    contentHash?: string;
    /** server-issued nonce (hex of 36-byte ASCII UUID); present for auth/handle */
    nonce?: string;
}
```

Add `PowAction` to the `AppAction.action` union.

### 2.3 Parse case — `modules/ecash-parse/src/parseTx.ts` (simple-LOKAD switch)

Spoof tolerance: anyone can broadcast POWR-prefixed transactions, so every branch
validates shape and falls through to `isValid: false` — never throws. Malformed
input renders as "Invalid Proof of Writing".

```ts
case opReturn.appPrefixesHex.pow: {
    const app = 'Proof of Writing';

    // stackArray[1] = version (bare OP_0 -> "00"), [2] = action (bare OP_N),
    // [3]/[4] = 32-byte pushes per the action table.
    if (stackArray[1] !== '00') {
        appActions.push({ lokadId, app, isValid: false });
        break;
    }

    const TYPES: Record<string, PowAction['type']> = {
        '51': 'post',    // OP_1
        '52': 'reply',   // OP_2
        '53': 'quote',   // OP_3
        '54': 'repost',  // OP_4
        '55': 'like',    // OP_5
        '56': 'publish', // OP_6
        '57': 'unlock',  // OP_7
        '58': 'auth',    // OP_8
        '59': 'handle',  // OP_9
        '5a': 'comment', // OP_10
        '5b': 'comment_reply', // OP_11
    };
    const type = TYPES[stackArray[2]];
    if (typeof type === 'undefined') {
        appActions.push({ lokadId, app, isValid: false });
        break;
    }

    const is32 = (s?: string): s is string =>
        typeof s === 'string' && s.length === 64;
    const is36 = (s?: string): s is string =>
        typeof s === 'string' && s.length === 72;

    switch (type) {
        case 'post':
        case 'publish':
        case 'comment': {
            if (!is32(stackArray[3])) {
                appActions.push({ lokadId, app, isValid: false });
                break;
            }
            appActions.push({
                lokadId, app, isValid: true,
                action: { type, contentHash: stackArray[3] },
            });
            break;
        }
        case 'reply':
        case 'quote':
        case 'comment_reply': {
            if (!is32(stackArray[3]) || !is32(stackArray[4])) {
                appActions.push({ lokadId, app, isValid: false });
                break;
            }
            appActions.push({
                lokadId, app, isValid: true,
                action: { type, targetTxid: stackArray[3], contentHash: stackArray[4] },
            });
            break;
        }
        case 'repost':
        case 'like': {
            if (!is32(stackArray[3])) {
                appActions.push({ lokadId, app, isValid: false });
                break;
            }
            appActions.push({
                lokadId, app, isValid: true,
                action: { type, targetTxid: stackArray[3] },
            });
            break;
        }
        case 'unlock': {
            appActions.push({
                lokadId, app, isValid: true,
                action: { type },
            });
            break;
        }
        case 'auth':
        case 'handle': {
            if (!is36(stackArray[3])) {
                appActions.push({ lokadId, app, isValid: false });
                break;
            }
            appActions.push({
                lokadId, app, isValid: true,
                action: { type, nonce: stackArray[3] },
            });
            break;
        }
    }
    break;
}
```

### 2.4 Icon — `cashtab/src/components/Common/CustomIcons.tsx`

Pen-nib mark (match the styled-svg wrapper of neighboring icons; shape below).
Cosmetic — safe to restyle in a later PR.

```tsx
export const PowIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M4 20l1.2-4L15 6.2l2.8 2.8L8 18.8 4 20z"
              fill="#00ff9c" stroke="#00ff9c" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M5.2 16L8 18.8" stroke="#0a0f0d" strokeWidth="1.2" />
        <path d="M15 6.2l2-2a2 2 0 012.8 2.8l-2 2"
              fill="#00ff9c" stroke="#00ff9c" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
);
```

### 2.5 Render case — `cashtab/src/components/Home/Tx/index.tsx`

Label only. No links are rendered for any action.

```tsx
case opReturn.appPrefixesHex.pow: {
    if (!isValid || typeof action === 'undefined' || !('type' in action)) {
        renderedAppActions.push(
            <IconAndLabel>
                <PowIcon />
                <AppDescLabel>Invalid {app}</AppDescLabel>
            </IconAndLabel>,
        );
        break;
    }

    const LABEL: Record<string, string> = {
        post: 'Post',
        reply: 'Reply',
        quote: 'Quote',
        repost: 'Repost',
        like: 'Like',
        publish: 'Article Published',
        unlock: 'Article Unlocked',
        auth: 'Login',
        handle: 'Handle Mint',
        comment: 'Comment',
        comment_reply: 'Comment Reply',
    };

    renderedAppActions.push(
        <IconAndLabel>
            <PowIcon />
            <AppDescLabel>{app} · {LABEL[action.type]}</AppDescLabel>
        </IconAndLabel>,
    );
    break;
}
```

### 2.6 (Optional) Notification — `modules/ecash-parse/src/getTxNotificationMsg.ts`

```ts
case opReturn.appPrefixesHex.pow: {
    const verb = action && 'type' in action ? action.type : 'activity';
    return `Proof of Writing | ${xecTxType} ${renderedAmount} | ${verb}`;
}
```

---

## What it looks like in the wallet

| Tx      | Label                                      |
|---------|--------------------------------------------|
| post    | 🖊 Proof of Writing · Post                 |
| reply   | 🖊 Proof of Writing · Reply                |
| quote   | 🖊 Proof of Writing · Quote                |
| repost  | 🖊 Proof of Writing · Repost               |
| like    | 🖊 Proof of Writing · Like                 |
| publish | 🖊 Proof of Writing · Article Published    |
| unlock  | 🖊 Proof of Writing · Article Unlocked     |
| auth    | 🖊 Proof of Writing · Login                |
| handle  | 🖊 Proof of Writing · Handle Mint          |
| comment | 🖊 Proof of Writing · Comment              |
| creply  | 🖊 Proof of Writing · Comment Reply        |

Icon + label, nothing tappable. Users get their real notifications inside the
proofofwriting.com app; the wallet row is identification only.

---

## Notes for the reviewer

- **LOKAD `504f5752` is frozen.** Please key the parser off exactly these 4 bytes.
- **Display-only, no links.** LOKAD transactions are spoofable by anyone, so the
  render case deliberately presents nothing tappable — worst case for a spoofed tx
  aimed at a user is an icon and a text label.
- The parse case is spoof-tolerant: every malformed shape falls through to
  `isValid: false` and renders as "Invalid Proof of Writing".
- Cosmetics (icon SVG, label wording) are ours to tweak later via a follow-up PR —
  no need to bikeshed them now.
- The write side (constructing these OP_RETURNs) lives entirely in our app; this PR
  is read/display only.

---

## Our-side action items before byte freeze (not part of the Cashtab PR)

1. **Auth envelope migration.** ✅ Done — `startAuth()` emits the POWR `OP_8` envelope
   and `verifyAuth()` dual-accepts the legacy bare-nonce layout across the deploy
   (`lib/walletAuth.ts`).
2. **Unlock flow BIP21 check.** Verify Cashtab accepts `op_return_raw` combined with
   our existing multi-output (94/6 split) BIP21 unlock payment in one URI.
3. **Handle mint payment envelope migration.** ✅ Done — the mint payment now emits the
   POWR `OP_9` envelope (`6a 04 504f5752 00 59 24 <36B>`) and the verifier dual-accepts
   the legacy bare-UUID layout (`app/api/mint/intent/route.ts`, `lib/mintPayments.ts`,
   `lib/feedProtocol.js` `FEED_ACTION.HANDLE` — OP_9, named to match this spec's
   `handle` and the "Handle Mint" wallet label).
4. **Builder updates.** ✅ Done — publish (OP_6) and unlock (OP_7) emit the POWR
   envelope; confirmed by live examples in §1.2.
5. **Refresh example txids.** ✅ Done — §1.2 holds one live POWR mainnet example per
   action (all 9), captured post-flip; the old PROW/bare examples are superseded.
6. **Note on the token mint tx itself.** The NFT mint transaction's OP_RETURN is
   fully occupied by the token protocol (that is what makes it a token mint), so
   it carries no POWR data by design. Cashtab already renders it as a token mint
   of the collection. The POWR `handle` action lives on the user's mint *payment*
   tx only.
