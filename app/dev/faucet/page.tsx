// Dev bench: every state of the new-user welcome-faucet card, side by side, so
// the copy + layout can be eyeballed without a brand-new wallet. 404 in prod.
import { notFound } from "next/navigation";
import StarterXecCard from "@/components/onboarding/StarterXecCard";

const RESET = new Date(Date.UTC(2026, 8, 28)).toISOString();
const base = { xec: 2500, pow: 10, resetsAt: RESET };
const STATES = [
  { state: "loading" },
  { ...base, state: "eligible" },
  { ...base, state: "sent", txid: "0".repeat(64) },
  { ...base, state: "claimed", txid: null },
  { ...base, state: "capped" },
  { ...base, state: "ineligible" },
  { ...base, state: "unknown" },
  { ...base, state: "disabled" },
];

export default function FaucetBench() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="pow-feed" style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px" }}>
      {STATES.map((p) => (
        <div key={p.state} style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", opacity: 0.6, marginBottom: 6 }}>
            {p.state}
          </div>
          <StarterXecCard preview={p} />
        </div>
      ))}
    </div>
  );
}
