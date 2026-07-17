# Proposal + patch: `signMessage` request in Cashtab Connect

**For:** Bitcoin ABC / Cashtab maintainers
**From:** proofofwriting.com
**What:** add a message-signing request to cashtab-connect + the extension,
mirroring the existing `requestAddress` / `sendBip21` approval flow. Lets a web
page ask the user to sign an arbitrary message with their active Cashtab wallet
and receive `{ signature, address }` back — the same primitive our Pocket
feature (see docs/pocket-message-signing.md) currently forces users to do by
hand through the Sign & Verify screen + clipboard.

This patch was written against `master` and matches the existing code paths; we
couldn't run it through the extension's build/e2e here, so treat it as a
review-ready draft. We'll test any revision against our preview immediately.

## Why

Today a page can request an address or hand Cashtab a transaction, but there's
no way to request a **signature**. Message-signature is a clean primitive for:

- **Non-custodial derived keys** (our Pocket: a spending key derived from a
  signature over a fixed sentence — deterministic, recoverable, never stored on
  a server).
- **Login without a dust payment.** Several eCash flows (ours included) burn a
  ~5.5 XEC on-chain payment purely to prove wallet control; a signed challenge
  does the same for free.

The manual workaround (paste sentence → Sign & Verify → paste signature back)
works but pushes a secret-equivalent string through the OS clipboard and gives
phishing pages an opening. A first-class request with an approval popup that
shows the requesting origin fixes both.

## Design

Exactly the shape of the address-share flow, one new message type each
direction:

```
page  ──signRequest{message}──▶  contentscript ──▶ service_worker
                                                        │ opens popup
                                                        ▼
                                              Extension.tsx approval modal
                                              (shows origin + message;
                                               signs with active wallet)
page  ◀──signResponse{approved,signature,address}──  service_worker ◀──┘
```

- Signing uses the **active wallet's** key via `signMsg(message, ecashWallet.sk)`
  — the exact call your `SignVerifyMsg` screen already makes. v1 signs with the
  active wallet only (no picker); a user signs with a different wallet by
  switching first, same as Sign & Verify today. A picker can come later if you
  want it — we kept the surface minimal.
- The approval modal shows `new URL(tabUrl).hostname` and the full message text,
  so the user sees who's asking and what they'd be signing.
- Message length: the connect SDK sends as-is; the extension can enforce the
  same `CASHTAB_MESSAGE_MAX_LENGTH` (200) the Sign & Verify screen uses.

## Patch

### 1. `modules/cashtab-connect/src/index.ts`

```diff
 export interface CashtabMessage {
     text?: string;
     type?: string;
     addressRequest?: boolean;
     txInfo?: Record<string, string>;
     id?: string;
     txResponse?: {
         approved: boolean;
         txid?: string;
         reason?: string;
     };
+    signRequest?: { message: string };
+    signResponse?: {
+        approved: boolean;
+        signature?: string;
+        address?: string;
+        reason?: string;
+    };
 }

 export interface TransactionResponse {
     success: boolean;
     txid?: string;
     reason?: string;
 }
+
+export interface SignMessageResponse {
+    success: boolean;
+    signature?: string;
+    address?: string;
+    reason?: string;
+}

+export class CashtabSignatureDeniedError extends Error {
+    constructor(reason?: string) {
+        super(reason || 'User denied message signing request');
+        this.name = 'CashtabSignatureDeniedError';
+    }
+}
```

In `setupMessageListener`, alongside the transaction-response branch:

```diff
                     // Handle transaction response
                     const transactionListener =
                         this.messageListeners.get('transaction');
                     if (transactionListener && event.data.txResponse) {
                         transactionListener({
                             success: event.data.txResponse.approved,
                             txid: event.data.txResponse.txid,
                             reason: event.data.txResponse.reason,
                         });
                         this.messageListeners.delete('transaction');
                     }
+
+                    // Handle sign-message response
+                    const signListener = this.messageListeners.get('sign');
+                    if (signListener && event.data.signResponse) {
+                        signListener({
+                            success: event.data.signResponse.approved,
+                            signature: event.data.signResponse.signature,
+                            address: event.data.signResponse.address,
+                            reason: event.data.signResponse.reason,
+                        });
+                        this.messageListeners.delete('sign');
+                    }
```

A private sender mirroring `sendTransactionMessage`, then the public method:

```diff
+    // When a web page requests a message signature, a response is expected
+    private sendSignMessage(
+        message: CashtabMessage,
+    ): Promise<SignMessageResponse> {
+        return new Promise((resolve, reject) => {
+            const timeoutId = setTimeout(() => {
+                this.messageListeners.delete('sign');
+                reject(new CashtabTimeoutError());
+            }, this.timeout);
+
+            this.messageListeners.set('sign', response => {
+                clearTimeout(timeoutId);
+                resolve(response);
+            });
+
+            if (typeof window !== 'undefined' && window.postMessage) {
+                window.postMessage(message, '*');
+            } else {
+                reject(new CashtabExtensionUnavailableError());
+            }
+        });
+    }
+
+    /**
+     * Request a message signature from the user's active Cashtab wallet.
+     * @param message - the message to sign (plain string)
+     * @returns Promise resolving with { success, signature, address }
+     */
+    async signMessage(message: string): Promise<SignMessageResponse> {
+        const request: CashtabMessage = {
+            text: 'Cashtab',
+            type: 'FROM_PAGE',
+            signRequest: { message },
+        };
+
+        const response = await this.sendSignMessage(request);
+
+        if (!response.success) {
+            throw new CashtabSignatureDeniedError(response.reason);
+        }
+
+        return response;
+    }
```

### 2. `cashtab/extension/src/contentscript.ts`

The page→extension direction already forwards any `FROM_PAGE` message
generically, so `signRequest` needs no change there. Add the extension→page
relay for the response, and the field to the interface:

```diff
 interface ChromeMessage {
     text?: string;
     txInfo?: Record<string, string>;
     txResponse?: {
         approved: boolean;
         txid?: string;
         reason?: string;
     };
+    signResponse?: {
+        approved: boolean;
+        signature?: string;
+        address?: string;
+        reason?: string;
+    };
     addressRequest?: boolean;
     addressRequestApproved?: boolean;
     address?: string;
     tabId?: number;
     success?: boolean;
     reason?: string;
 }
```

```diff
     // Parse message for transaction response
     if (message.txResponse) {
         // Send structured response that webpage can listen for
         return window.postMessage(
             {
                 type: 'FROM_CASHTAB',
                 txResponse: message.txResponse,
             },
             '*',
         );
     }
+
+    // Parse message for sign-message response
+    if (message.signResponse) {
+        return window.postMessage(
+            {
+                type: 'FROM_CASHTAB',
+                signResponse: message.signResponse,
+            },
+            '*',
+        );
+    }
```

### 3. `cashtab/extension/src/service_worker.ts`

```diff
 interface ChromeMessage {
     text?: string;
     txInfo?: Record<string, string>;
     addressRequest?: boolean;
     addressRequestApproved?: boolean;
     address?: string;
     tabId?: number;
     txResponse?: {
         approved: boolean;
         txid?: string;
         reason?: string;
     };
+    signRequest?: { message: string };
+    signResponse?: {
+        approved: boolean;
+        signature?: string;
+        address?: string;
+        reason?: string;
+    };
 }
```

In the `onMessage` listener, next to the address-request and txResponse blocks:

```diff
+    // Handle a message signing request
+    if (request.text === `Cashtab` && request.signRequest) {
+        getCurrentActiveTab().then(
+            requestingTab => {
+                openSignApproval(request.signRequest!.message, requestingTab);
+            },
+            err => {
+                console.log(
+                    'Error in getCurrentActiveTab() triggered by sign request',
+                    err,
+                );
+            },
+        );
+    }
+
+    // Handle sign-message response from Cashtab
+    if (request.text === `Cashtab` && request.signResponse) {
+        handleSignResponse(request.tabId, request.signResponse);
+    }
```

New helpers mirroring `handleTransactionResponse` / `openAddressShareApproval`:

```diff
+async function handleSignResponse(
+    tabId?: number,
+    signResponse?: {
+        approved: boolean;
+        signature?: string;
+        address?: string;
+        reason?: string;
+    },
+): Promise<void> {
+    if (!tabId || !signResponse) {
+        return;
+    }
+    chrome.tabs.sendMessage(Number(tabId), {
+        type: 'FROM_CASHTAB',
+        text: 'Cashtab',
+        signResponse: signResponse,
+    });
+}
+
+// Open Cashtab extension with a request to sign a message
+async function openSignApproval(
+    message: string,
+    tab: chrome.tabs.Tab,
+): Promise<void> {
+    let left = 0;
+    let top = 0;
+    try {
+        const lastFocused = await getLastFocusedWindow();
+        top = lastFocused.top || 0;
+        left = Math.max(
+            (lastFocused.left || 0) +
+                ((lastFocused.width || 0) - NOTIFICATION_WIDTH),
+            0,
+        );
+    } catch {
+        const { screenX, screenY, outerWidth } = window;
+        top = Math.max(screenY, 0);
+        left = Math.max(screenX + (outerWidth - NOTIFICATION_WIDTH), 0);
+    }
+
+    const queryString =
+        `request=signRequest&tabId=${tab.id}&tabUrl=${tab.url}` +
+        `&message=${encodeURIComponent(message)}`;
+
+    await openWindow({
+        url: `index.html#/wallet?${queryString}`,
+        type: 'popup',
+        width: NOTIFICATION_WIDTH,
+        height: NOTIFICATION_HEIGHT,
+        left,
+        top,
+    });
+}
```

### 4. `cashtab/src/components/AppModes/Extension.tsx`

```diff
 import React, { useState, useEffect, useContext } from 'react';
+import { signMsg } from 'ecash-lib';
 import Modal from 'components/Common/Modal';
```

```diff
     const [showApproveAddressShareModal, setShowApproveAddressShareModal] =
         useState<boolean>(false);
     const [addressRequestTabId, setAddressRequestTabId] = useState<
         number | null
     >(null);
     const [addressRequestTabUrl, setAddressRequestTabUrl] =
         useState<string>('');
+    // Sign-message request state
+    const [showApproveSignModal, setShowApproveSignModal] =
+        useState<boolean>(false);
+    const [signRequestTabId, setSignRequestTabId] = useState<number | null>(
+        null,
+    );
+    const [signRequestTabUrl, setSignRequestTabUrl] = useState<string>('');
+    const [signRequestMessage, setSignRequestMessage] = useState<string>('');
```

Approve/reject handlers, beside the address ones:

```diff
+    /** Sign the requested message with the ACTIVE wallet and return it. */
+    const handleApproveSign = async (): Promise<void> => {
+        if (signRequestTabId === null) return;
+
+        const signature = signMsg(signRequestMessage, ecashWallet.sk);
+
+        await chrome.runtime.sendMessage({
+            type: 'FROM_CASHTAB',
+            text: 'Cashtab',
+            tabId: signRequestTabId,
+            signResponse: {
+                approved: true,
+                signature,
+                address: ecashWallet.address,
+            },
+        });
+
+        setShowApproveSignModal(false);
+        window.close();
+    };
+
+    const handleRejectedSign = async (): Promise<void> => {
+        if (signRequestTabId === null) return;
+
+        await chrome.runtime.sendMessage({
+            type: 'FROM_CASHTAB',
+            text: 'Cashtab',
+            tabId: signRequestTabId,
+            signResponse: {
+                approved: false,
+                reason: 'User denied the request',
+            },
+        });
+
+        setShowApproveSignModal(false);
+        window.close();
+    };
```

Parse the new request in the existing `useEffect` (after the addressRequest
block, reusing the same `#/wallet?` query parsing):

```diff
             const request = queryStringParams.get('request');
             const tabId = parseInt(queryStringParams.get('tabId') || '0');
             const tabUrl = queryStringParams.get('tabUrl') || '';
-            if (request !== 'addressRequest') {
+            if (request === 'signRequest') {
+                const message = queryStringParams.get('message') || '';
+                setSignRequestTabId(tabId);
+                setSignRequestTabUrl(tabUrl);
+                setSignRequestMessage(message);
+                setShowApproveSignModal(true);
+                return;
+            }
+            if (request !== 'addressRequest') {
                 return;
             }

             // Open a modal that asks for user approval
             setAddressRequestTabId(tabId);
             setAddressRequestTabUrl(tabUrl);
             setShowApproveAddressShareModal(true);
```

And the modal itself, after the address-share modal:

```diff
+            {showApproveSignModal && (
+                <Modal
+                    title="Sign Message"
+                    description={`Signature request from ${
+                        new URL(signRequestTabUrl).hostname
+                    }`}
+                    handleCancel={() => handleRejectedSign()}
+                    handleOk={() => handleApproveSign()}
+                    showCancelButton
+                >
+                    <div style={{ textAlign: 'left', wordBreak: 'break-word' }}>
+                        <p>Signing as <strong>{ecashWallet.address}</strong></p>
+                        <p style={{ opacity: 0.8 }}>Message:</p>
+                        <pre
+                            style={{
+                                whiteSpace: 'pre-wrap',
+                                wordBreak: 'break-word',
+                            }}
+                        >
+                            {signRequestMessage}
+                        </pre>
+                    </div>
+                </Modal>
+            )}
```

## Usage (what we'd write against it)

```ts
import { CashtabConnect } from 'cashtab-connect'
const cashtab = new CashtabConnect()
const { signature, address } = await cashtab.signMessage(POCKET_SENTENCE)
// signature is ecash-lib signMsg output — same bytes as the Sign & Verify screen
```

## Open questions for maintainers

1. **Wallet selection.** v1 signs with the active wallet (matches Sign & Verify).
   Want a wallet picker in the modal like the connect flow has? If so, we'd need
   the sk-access pattern for a non-active `StoredCashtabWallet`.
2. **Message length / encoding.** We pass the message through the popup URL
   query (works for our 127-char sentence). For long messages you may prefer
   stashing it in `chrome.storage.session` keyed by tabId instead of the URL —
   happy to adjust.
3. **`signMsg` freeze.** Our funds depend on `signMsg` staying deterministic;
   see docs/pocket-message-signing.md §7.1 (we'd contribute golden-vector
   regression tests).

Happy to open this as a PR and iterate in review.
