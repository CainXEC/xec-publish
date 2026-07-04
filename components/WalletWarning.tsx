"use client";
// =============================================================================
//  WalletWarning.tsx
//  Single source of truth for the "Cashtab only" delivery warning, shown
//  anywhere an NFT (or account identity) is delivered to a sender/receive
//  address: the claim page, the mint page, and signup.
//
//  The risk is the same everywhere: the wallet you use becomes where your NFT
//  lives (and, at signup, your account identity). Non-Cashtab wallets either
//  can't hold eTokens safely (Electrum ABC can burn them) or aren't yours to
//  control at all (exchange addresses) — so the NFT can be lost permanently.
//
//  Style is scoped to .pow-wallet-warn so it drops into the neon pages and any
//  other page alike. Pass `context` to tune the one-line lead-in.
// =============================================================================

type Ctx = "claim" | "mint" | "signup" | "login";

const LEAD: Record<Ctx, string> = {
  claim: "Send your proof payment from Cashtab only.",
  mint: "Pay from Cashtab only.",
  signup: "Use a Cashtab wallet only.",
  login: "Log in from Cashtab only.",
};

export default function WalletWarning({ context = "mint" }: { context?: Ctx }) {
  const isLogin = context === "login";
  return (
    <div className="pow-wallet-warn" role="note">
      <style>{CSS}</style>
      <span className="ico" aria-hidden>⚠</span>
      {isLogin ? (
        <p>
          <strong>{LEAD[context]}</strong> The wallet you send from becomes your identity
          on proofofwriting. Do <strong>not</strong> log in from an exchange wallet or any
          wallet you don’t fully control — you must hold the keys to the sending address,
          or you won’t be able to log back in or receive what you’re owed.
        </p>
      ) : (
        <p>
          <strong>{LEAD[context]}</strong> The wallet you use is where your handle NFT is
          delivered. Do <strong>not</strong> use Electrum ABC, an exchange wallet, or any
          other wallet — Electrum ABC can destroy the token, and an exchange address isn’t
          yours to control. In either case the NFT can be lost for good.
        </p>
      )}
    </div>
  );
}

const CSS = `
.pow-wallet-warn{
  display:flex; align-items:flex-start; gap:10px; text-align:left;
  font-size:13px; line-height:1.5; color:#ffd18a;
  background:rgba(255,160,40,.08); border:1px solid rgba(255,160,40,.25);
  border-radius:8px; padding:11px 13px; margin:0 0 16px;
}
.pow-wallet-warn .ico{ color:#ffb44d; font-size:15px; line-height:1.4; flex-shrink:0; }
.pow-wallet-warn p{ margin:0; }
.pow-wallet-warn strong{ color:#ffb44d; }
`;
