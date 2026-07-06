# Cashtab integration: "POWR" feed protocol (Proof of Writing)

This is a handoff spec for adding parsing + display of the **Proof of Writing** feed
protocol to Cashtab. It has two parts:

1. **The frozen on-chain byte spec** — the contract. This describes exactly what our
   site writes into the OP_RETURN of every feed transaction. It is immutable once we
   launch (real posts on-chain reference these exact bytes).
2. **PR-ready Cashtab cases** — drop-in parse / render / icon code implementing the
   spec in the `Bitcoin-ABC/bitcoin-abc` monorepo. Cosmetics (icon, label wording,
   link target) are safe to change later in a follow-up PR.

---

## 1. Frozen on-chain byte spec

**LOKAD ID:** `POWR` = `0x504f5752` (4 bytes, ASCII).

Every feed action is a single OP_RETURN output. The layout of the output script:

```
OP_RETURN                 (0x6a)
<push 4> 504f5752         LOKAD prefix "POWR"
OP_0                      protocol version 0 (bare opcode)
OP_N                      action, bare opcode: OP_1=post, OP_2=reply,
                          OP_3=quote, OP_4=repost, OP_5=like
[<push 32> targetTxid]    referenced tx (reply→parent, quote/repost/like→target).
                          Absent for a post.
[<push 32> contentHash]   sha256 of the stored UTF-8 post content ("proof of
                          writing"). Present for post/reply/quote; absent for
                          repost/like (they carry no content of their own).
```

Per-action layout:

| Action | Opcode | targetTxid | contentHash |
|--------|--------|------------|-------------|
| post   | OP_1   | —          | ✅ (32B)    |
| reply  | OP_2   | ✅ (32B)   | ✅ (32B)    |
| quote  | OP_3   | ✅ (32B)   | ✅ (32B)    |
| repost | OP_4   | ✅ (32B)   | —           |
| like   | OP_5   | ✅ (32B)   | —           |

Notes:
- `version` and `action` are **bare opcodes** (`OP_0`, `OP_1`..`OP_5`), which
  `ecash-lib`'s `getStackArray` decodes as one-byte stack entries `"00"`, `"51"`..`"55"`.
- `targetTxid` and `contentHash` are each a 32-byte pushdata (push opcode `0x20`).
- Max size is the reply/quote form ≈ 74 bytes — well within the OP_RETURN budget.
- The content hash lets a reader verify a post's text against the chain; the wallet
  does not need to render it.

Worked example — a **reply** (`OP_2`), target `aaaa…` (32B), hash `bbbb…` (32B):

```
6a 04 504f5752 00 52 20<32B target> 20<32B hash>
```

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
    pow: '504f5752', // ASCII "POWR" — Proof of Writing feed
},
```

### 2.2 Action type — `modules/ecash-parse/src/types.ts`

```ts
export interface PowAction {
    type: 'post' | 'reply' | 'quote' | 'repost' | 'like';
    /** referenced post (hex txid); absent for 'post' */
    targetTxid?: string;
    /** sha256 of stored post content (hex); present for post/reply/quote */
    contentHash?: string;
}
```

Add `PowAction` to the `AppAction.action` union.

### 2.3 Parse case — `modules/ecash-parse/src/parseTx.ts` (simple-LOKAD switch)

```ts
case opReturn.appPrefixesHex.pow: {
    const app = 'Proof of Writing';

    // stackArray[1] = version (bare OP_0 -> "00"), [2] = action (bare OP_N),
    // [3]/[4] = 32-byte refs.
    if (stackArray[1] !== '00') {
        appActions.push({ lokadId, app, isValid: false });
        break;
    }

    const TYPES: Record<string, PowAction['type']> = {
        '51': 'post',   // OP_1
        '52': 'reply',  // OP_2
        '53': 'quote',  // OP_3
        '54': 'repost', // OP_4
        '55': 'like',   // OP_5
    };
    const type = TYPES[stackArray[2]];
    if (typeof type === 'undefined') {
        appActions.push({ lokadId, app, isValid: false });
        break;
    }

    const is32 = (s?: string): s is string =>
        typeof s === 'string' && s.length === 64;

    if (type === 'post') {
        if (!is32(stackArray[3])) {
            appActions.push({ lokadId, app, isValid: false });
            break;
        }
        appActions.push({
            lokadId, app, isValid: true,
            action: { type, contentHash: stackArray[3] },
        });
    } else if (type === 'reply' || type === 'quote') {
        if (!is32(stackArray[3]) || !is32(stackArray[4])) {
            appActions.push({ lokadId, app, isValid: false });
            break;
        }
        appActions.push({
            lokadId, app, isValid: true,
            action: { type, targetTxid: stackArray[3], contentHash: stackArray[4] },
        });
    } else {
        // repost | like — target only
        if (!is32(stackArray[3])) {
            appActions.push({ lokadId, app, isValid: false });
            break;
        }
        appActions.push({
            lokadId, app, isValid: true,
            action: { type, targetTxid: stackArray[3] },
        });
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

```tsx
case opReturn.appPrefixesHex.pow: {
    const POW_SITE = 'https://proofofwriting.com';

    if (!isValid || typeof action === 'undefined' || !('type' in action)) {
        renderedAppActions.push(
            <IconAndLabel>
                <PowIcon />
                <AppDescLabel>Invalid {app}</AppDescLabel>
            </IconAndLabel>,
        );
        break;
    }

    const VERB: Record<string, string> = {
        post: 'Post', reply: 'Reply', quote: 'Quote',
        repost: 'Repost', like: 'Like',
    };
    const REF_LABEL: Record<string, string> = {
        reply: 'Replying to', quote: 'Quoting',
        repost: 'Reposted', like: 'Liked',
    };

    const { type } = action;
    const targetTxid = 'targetTxid' in action ? action.targetTxid : undefined;

    renderedAppActions.push(
        <>
            <IconAndLabel>
                <PowIcon />
                <AppDescLabel>{app} · {VERB[type]}</AppDescLabel>
            </IconAndLabel>
            {typeof targetTxid !== 'undefined' && (
                <AppDescMsg>
                    {REF_LABEL[type]}:{' '}
                    <ActionLink
                        href={`${POW_SITE}/posts/${targetTxid}`}
                        target="_blank"
                        rel="noreferrer"
                    >
                        {targetTxid.slice(0, 6)}…{targetTxid.slice(-6)}
                    </ActionLink>
                </AppDescMsg>
            )}
        </>,
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

| Tx     | Label                          | Second line                          |
|--------|--------------------------------|--------------------------------------|
| post   | 🖊 Proof of Writing · Post     | —                                    |
| reply  | 🖊 Proof of Writing · Reply    | Replying to: `a1b2c3…d4e5f6` ↗       |
| quote  | 🖊 Proof of Writing · Quote    | Quoting: `a1b2c3…d4e5f6` ↗           |
| repost | 🖊 Proof of Writing · Repost   | Reposted: `a1b2c3…d4e5f6` ↗          |
| like   | 🖊 Proof of Writing · Like     | Liked: `a1b2c3…d4e5f6` ↗             |

The link resolves to `proofofwriting.com/posts/<txid>` — tapping it in the wallet
lands on the referenced thread. (A tx's txid is the post's permanent id, so this
route resolves by txid on our side.)

---

## Notes for the reviewer

- **LOKAD `504f5752` is frozen.** Please key the parser off exactly these 4 bytes.
- Cosmetics (icon SVG, label wording, `POW_SITE` link) are ours to tweak later via a
  follow-up PR — no need to bikeshed them now.
- The write side (constructing this OP_RETURN) lives entirely in our app; this PR is
  read/display only.
