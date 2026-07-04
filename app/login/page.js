import WalletLogin from "@/components/WalletLogin";

export const metadata = {
  title: "Log in — proofofwriting",
};

export default function LoginPage() {
  return <WalletLogin redirectTo="/" />;
}
