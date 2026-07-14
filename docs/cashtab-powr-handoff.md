# Cashtab integration handoff: "POWR" protocol (Proof of Writing)

**For:** a Cashtab / ecash-parse contributor.
**What:** add parse + display of the **Proof of Writing** (`POWR`) OP_RETURN protocol
to Cashtab, so transactions from proofofwriting.com show a recognizable icon + label
instead of a raw OP_RETURN row.

**Scope: display-only.** Cashtab shows an icon and a text label identifying the
transaction type. It renders **no links** and takes no action — POWR transactions are
spoofable by anyone, so the worst case for a spoofed tx aimed at a wallet user is an
icon and a label, nothing tappable.

This file has two parts:
1. **The frozen on-chain byte spec** — the contract. Immutable; real mainnet
   transactions already reference these exact bytes.
2. **Ready-to-implement Cashtab cases** — drop-in parse / type / icon / render code.
   Cosmetics (icon art, label wording) are safe to tweak later.

---

## 1. Frozen on-chain byte spec

**LOKAD ID:** `POWR` = `0x504f5752` (4 bytes, ASCII).

One LOKAD ID covers every proofofwriting.com transaction type: feed actions, article
publishes, article unlocks, wallet-auth logins, handle-NFT mint payments, and article
comments.

Every action is a single OP_RETURN output. The output script layout:

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

Notes:
- `version` and `action` are **bare opcodes** (`OP_0`, `OP_1`..`OP_11`), which
  `ecash-lib`'s `getStackArray` decodes as one-byte stack entries `"00"`, `"51"`..`"5b"`.
- `targetTxid` and `contentHash` are each a 32-byte pushdata (push opcode `0x20`).
- `nonce` is a 36-byte pushdata (push opcode `0x24`): the ASCII bytes of a standard
  UUID string (e.g. `550e8400-e29b-41d4-a716-446655440000`).
- `contentHash` is sha256 of the stored UTF-8 content ("proof of writing"). The wallet
  does not need to render or verify it.
- `targetTxid` is the referenced transaction (reply/quote/repost/like → the feed post;
  creply → the parent comment).
- `unlock` carries no payload — the minimal 8-byte LOKAD marker (`6a 04 504f5752 00 57`).
- `comment`/`creply` are article comments, priced and split like the feed (94% to the
  author, 6% to the platform), but they get their own action codes so they read as
  comments rather than feed posts. A reply to a legacy (pre-paid) comment has no parent
  txid to target, so it is emitted as a plain `comment` (OP_10); its thread link lives
  off-chain.
- Max size is the reply/quote/creply form ≈ 74 bytes — well within the OP_RETURN budget.

Worked example — a **reply** (`OP_2`), target `aaaa…` (32B), hash `bbbb…` (32B):

```
6a 04 504f5752 00 52 20<32B target> 20<32B hash>
```

Worked example — an **unlock** (`OP_7`):

```
6a 04 504f5752 00 57
```

Worked example — a **comment** (`OP_10`), hash `bbbb…` (32B):

```
6a 04 504f5752 00 5a 20<32B hash>
```

### 1.1 Chronik indexing (why the envelope)

Because the 4-byte LOKAD is the **first push** after `OP_RETURN`, Chronik files every
one of these under the `POWR` LOKAD id: `chronik.lokadId('504f5752').history()` returns
them, and a websocket subscription to the LOKAD is a real-time firehose of all activity.
All eleven actions share the one LOKAD; consumers filter by the action opcode
(e.g. `stackArray[2] === '59'` for a handle mint payment).

### 1.2 Example txids (live mainnet, POWR)

One real transaction per action, on the LOKAD `504f5752` ("POWR"). Pull them via Chronik
to seed the parser test fixtures and sanity-check against real on-chain bytes.

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

`comment` (OP_10) reuses the same decode shape as `post`/`publish` (hash only) and
`creply` (OP_11) reuses the `reply`/`quote` shape (target + hash), so the fixtures above
already exercise both payload shapes. Fresh `comment`/`creply` examples can be pulled
from the POWR LOKAD once desired: `chronik.lokadId('504f5752').history()` and filter
`stackArray[2]` to `'5a'` / `'5b'`.

---

## 2. Ready-to-implement Cashtab cases

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
validates shape and falls through to `isValid: false` — never throws. Malformed input
renders as "Invalid Proof of Writing".

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

Pen-nib mark (match the styled-svg wrapper of neighboring icons). Cosmetic — safe to
restyle later.

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

Icon + label, nothing tappable.

---

## Notes for the reviewer

- **LOKAD `504f5752` is frozen.** Please key the parser off exactly these 4 bytes.
- **Display-only, no links.** LOKAD transactions are spoofable by anyone, so the render
  case deliberately presents nothing tappable — worst case for a spoofed tx aimed at a
  user is an icon and a text label.
- The parse case is spoof-tolerant: every malformed shape falls through to
  `isValid: false` and renders as "Invalid Proof of Writing".
- Cosmetics (icon SVG, label wording) are ours to tweak later via a follow-up — no need
  to bikeshed them now.
- This is read/display only. Constructing these OP_RETURNs happens entirely in the
  proofofwriting.com app; the wallet never builds them.

---

## Submitting

Bitcoin ABC reviews code via **Phabricator + Arcanist** (`arc diff`), not GitHub PRs —
the GitHub repo is a read-only mirror. Standard flow: topic branch → one commit with a
test plan → `arc diff` → address review → `arc land`. See
[bitcoinabc.org/CONTRIBUTING](https://www.bitcoinabc.org/CONTRIBUTING.html).
