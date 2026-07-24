# Proposal + patch: `?msg=` prefill and `?callback=` return for Cashtab's Sign & Verify

**For:** Bitcoin ABC / Cashtab maintainers
**From:** proofofwriting.com
**What:** teach the web **Sign & Verify** screen (`/#/signverifymsg`) two optional
query params — `msg` (prefill the message) and `callback` (return the signature
to a site by redirect) — so a mobile web page can hand a user off to Cashtab to
sign and get the result back without hand-copying an 88-character string through
the OS clipboard.

This is the **mobile-web counterpart** to `docs/cashtab-signmessage-proposal.md`.
That proposal adds a `signMessage` request to cashtab-connect + the browser
**extension** — which only exists on desktop. On mobile there is no extension,
so the same UX has to ride the one channel both platforms share: a URL. This is
also the strict superset of `docs/pocket-message-signing.md` §7.4 (prefill only):
§7.4 returns nothing to the opener; this adds an *opt-in, consented* return leg.

Written against `master`; not yet run through Cashtab's build/e2e here, so treat
the component patch as a review-ready draft. We'll test any revision on our
preview immediately.

## Why

Our Pocket feature (see `docs/pocket-message-signing.md`) derives an in-browser
spending key from a signature over one fixed sentence. On desktop the
`signMessage` extension request makes that a single approval popup. On **mobile**
the flow today is: copy sentence → open `/#/signverifymsg` → paste sentence →
sign → copy the 88-char signature → switch back to our tab → paste. Two manual
clipboard hops, one of them a secret-equivalent string.

A `callback` collapses that to: tap **Sign in Cashtab** → Cashtab opens with the
sentence already there → tap **Sign** → approve the return → Cashtab bounces back
to our page with the signature, which derives the Pocket automatically. No
copy, no paste. It also generalises: any eCash web app can do signature-based
login on mobile instead of burning a ~5.5 XEC dust payment to prove wallet
control.

## The contract (what proofofwriting.com codes against)

### Request

```
https://cashtab.com/#/signverifymsg?msg=<uriencoded message>&callback=<uriencoded https url>
```

- `msg` — prefills the message textarea (exactly §7.4). Optional and independent
  of `callback`; `?msg=` alone is the harmless prefill-only feature.
- `callback` — where to return the signature. **Must be `https:`** (allow
  `http://localhost` for dev only). If absent, the screen behaves exactly as
  today: the signature is shown for manual copy, nothing is returned.
- Because Cashtab is a `HashRouter` app, both params live *after* the hash and
  must be read from the router location's search string
  (`useSearchParams()` / `useLocation().search`), **not** `window.location.search`
  (which is empty for a hash URL).

### Return

After the user taps **Sign** and **confirms the return modal**, Cashtab redirects
the current tab to:

```
<callback>#sig=<encodeURIComponent(signatureBase64)>
```

- The signature is returned in the **URL fragment**, never the query string.
  Fragments are never transmitted in an HTTP request or `Referer` header, so the
  signature — which for our Pocket *is* the private key — never reaches any
  server's access logs. The receiving page reads `location.hash`, then
  immediately `history.replaceState`s it away.
- **`encodeURIComponent` is required**, not optional. Raw base64 contains `+`,
  and `URLSearchParams` (which callers use to read the fragment) maps a literal
  `+` to a space, corrupting the signature. Percent-encoding (`+` → `%2B`) makes
  it round-trip. (Our reader also restores `+` from stray spaces defensively, but
  the spec is: encode it.)
- Fragment param name is `sig`. No other data is returned (no address — the
  recoverable signature already recovers the signing address).

### Consent modal (required)

Producing a signature and *sending it to a third party* are two different
consents. The message textarea shows **what** is being signed; it says nothing
about **where the result goes**. So on the return leg — after signing, before
redirecting — Cashtab MUST show a modal naming the destination origin:

> **Return signature to `proofofwriting.com`?**
> This signature will be sent to **proofofwriting.com**. Only continue if you
> started this on that site.
> [Cancel] [Continue]

- **Continue** → redirect to `<callback>#sig=…`.
- **Cancel** → no redirect; the signature stays on screen for manual copy (the
  screen degrades to today's behavior).

Without this, `callback=` turns the sign screen into a signature-harvesting
oracle: any page could prefill a message, auto-exfiltrate the result the moment
the user signs, and — for an auth nonce — replay it against the real site. The
modal is the gate that keeps the user aware of the recipient. (This is the same
reason the address-share and transaction popups show the requesting origin.)

## Component patch (draft) — `cashtab/src/components/SignVerifyMsg/`

Read the two params on mount, prefill the message, and remember the callback:

```diff
+import { useSearchParams } from 'react-router-dom';
 ...
+    const [searchParams] = useSearchParams();
+    // Optional deep-link params. `msg` prefills the textarea; `callback` (https
+    // only) opts into returning the signature to the opener by redirect.
+    const callbackParam = searchParams.get('callback');
+    const callbackUrl = isValidHttpsCallback(callbackParam) ? callbackParam : null;
+
+    useEffect(() => {
+        const msg = searchParams.get('msg');
+        if (msg) {
+            setMessageSign(msg);           // same state the textarea binds to
+        }
+        // eslint-disable-next-line react-hooks/exhaustive-deps
+    }, []);
```

`isValidHttpsCallback` — reject anything that isn't a well-formed https URL (or
localhost in dev), so a malformed/`javascript:`/`http:` callback is simply
ignored and the screen stays in normal manual-copy mode:

```ts
function isValidHttpsCallback(raw: string | null): boolean {
    if (!raw) return false;
    try {
        const u = new URL(raw);
        if (u.protocol === 'https:') return true;
        // Dev convenience only:
        return (
            u.protocol === 'http:' &&
            (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
        );
    } catch {
        return false;
    }
}
```

The existing **Sign** handler already computes the signature (it calls
`signMsg(messageSign, wallet.sk)` and puts the base64 in state). Add: if a valid
callback is present, open the consent modal instead of only displaying it.

```diff
     const signMessage = () => {
         try {
             const sig = signMsg(messageSign, wallet.paths.get(1899).sk); // existing call
             setMessageSignature(sig);
+            if (callbackUrl) {
+                setPendingCallbackSig(sig);
+                setShowCallbackModal(true);   // consent before we redirect
+            }
         } catch (err) {
             ...
         }
     };
```

The consent modal + redirect (reuses Cashtab's `Modal`):

```diff
+    const confirmReturnToCallback = () => {
+        // Fragment, not query: the signature never travels to a server or in a
+        // Referer header. encodeURIComponent so base64 '+' survives the reader's
+        // URLSearchParams parse.
+        const target =
+            callbackUrl + '#sig=' + encodeURIComponent(pendingCallbackSig);
+        window.location.assign(target);
+    };
 ...
+    {showCallbackModal && callbackUrl && (
+        <Modal
+            title="Return signature?"
+            description={`This signature will be sent to ${
+                new URL(callbackUrl).hostname
+            }`}
+            handleOk={confirmReturnToCallback}
+            handleCancel={() => setShowCallbackModal(false)}
+            showCancelButton
+        >
+            <p style={{ textAlign: 'left' }}>
+                Only continue if you started this on{' '}
+                <strong>{new URL(callbackUrl).hostname}</strong>. Your signature
+                will be sent there. If you didn’t, tap Cancel — you can still copy
+                the signature by hand.
+            </p>
+        </Modal>
+    )}
```

New state alongside the screen's existing `useState`s:

```diff
+    const [showCallbackModal, setShowCallbackModal] = useState(false);
+    const [pendingCallbackSig, setPendingCallbackSig] = useState('');
```

That's the whole change: one file, two optional params, one modal. Verify mode
and the no-param path are untouched.

## Behavior matrix

| URL params            | Cashtab behavior                                                        |
|-----------------------|------------------------------------------------------------------------|
| none                  | Today's screen, unchanged.                                             |
| `msg` only            | Message prefilled; user signs and copies by hand. (§7.4)              |
| `msg` + `callback`    | Prefilled; on Sign → consent modal → redirect `#sig=…`.               |
| bad/`http:` `callback`| Ignored; falls back to `msg`-only (or none) behavior.                 |

Older Cashtab that predates this patch ignores both params: the user lands on a
blank sign screen, signs, and copies by hand — i.e. exactly today. So the
opener must keep a manual-paste fallback (we do). No version negotiation needed.

## Security properties

1. **Signature never hits a server.** It rides the URL *fragment*; fragments are
   not sent in the HTTP request line or `Referer`. This is stronger than the
   clipboard path it replaces — clipboard contents sync across a user's devices
   on iOS (Universal Clipboard); a fragment does not.
2. **Consent to the recipient.** The return modal names the destination origin;
   no redirect happens without an explicit tap. Signing (visible message) and
   sending (named origin) are separately consented.
3. **`https`-only callback.** No plaintext return leg; malformed/`javascript:`
   schemes are ignored, not redirected to.
4. **No new auto-sign.** The user still taps Sign exactly as today.
5. **No returned address.** Only the signature is returned; the recipient
   recovers the address from the recoverable signature if it needs it.

## Open questions for maintainers

1. **Consent UX.** We propose a blocking confirm modal (one extra tap). If you’d
   rather show the destination origin *inline* next to the Sign button and skip
   the modal, that preserves the same disclosure with no extra tap — we’re happy
   either way; we’ve specced the modal because it’s the more conservative gate.
2. **Callback allowlist.** v1 allows any https origin (with consent). If you want
   a registry of known-good origins later, the modal copy already primes users to
   check the host.
3. **`signMsg` freeze.** As in the other two docs, our funds depend on `signMsg`
   staying deterministic — see `docs/pocket-message-signing.md` §7.1. Happy to
   contribute golden-vector regression tests.

Happy to open this as a PR and iterate in review.
