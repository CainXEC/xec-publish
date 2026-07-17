import WalletLogin from "@/components/WalletLogin";

export const metadata = {
  title: "Log in — proofofwriting",
};

// Only return to an on-site path (single leading slash, no scheme or backslash)
// so ?next= can never be an open redirect to another host.
function safeNext(next) {
  const p = typeof next === "string" ? next : "";
  return /^\/(?!\/)[^\\]*$/.test(p) ? p : "/";
}

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  return <WalletLogin redirectTo={safeNext(params?.next)} />;
}
