import { useState } from "react";
import { BadgeCheck, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VerifiedCreatorBadge } from "@/components/VerifiedCreatorBadge";
import { useCreatorVerification } from "@/hooks/useCreatorVerification";
import { shortenAddress } from "@/lib/utils";

/**
 * Lets the connected creator verify their identity using SEP-1 / SEP-12:
 * they publish a `stellar.toml` on a domain they control that lists their
 * Stellar account and a `SIGNING_KEY`, then (optionally) a signed SEP-12
 * attestation. The result is cached locally so the verified badge renders
 * across the app.
 */
export function CreatorVerificationCard({ address }: { address: string }) {
  const { verification, isLoading, error, verifyDomain } = useCreatorVerification(
    address,
  );
  const [domain, setDomain] = useState("");

  const handleVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!domain.trim()) return;
    await verifyDomain(domain.trim());
  };

  return (
    <section
      aria-labelledby="creator-verification-title"
      className="rounded-2xl border border-white/10 bg-[#0d1117] p-5 sm:p-6"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-300/20 bg-emerald-300/10 text-emerald-100">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <h2
            id="creator-verification-title"
            className="text-lg font-semibold text-white"
          >
            Creator identity verification
          </h2>
          <p className="text-xs text-slate-400">
            SEP-1 domain proof + SEP-12 signed attestation
          </p>
        </div>
        <div className="ml-auto">
          <VerifiedCreatorBadge verification={verification} variant="compact" />
        </div>
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-400">
        Verify ownership of a domain to earn a{" "}
        <span className="text-emerald-200">Verified creator</span> badge. Host a{" "}
        <code className="rounded bg-white/10 px-1 py-0.5 text-xs">stellar.toml</code>{" "}
        at{" "}
        <code className="rounded bg-white/10 px-1 py-0.5 text-xs">
          https://your-domain/.well-known/stellar.toml
        </code>{" "}
        that lists your account{" "}
        <code className="rounded bg-white/10 px-1 py-0.5 text-xs">
          {shortenAddress(address)}
        </code>
        .
      </p>

      <form onSubmit={handleVerify} className="mt-4 flex flex-col gap-3 sm:flex-row">
        <Input
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          placeholder="your-domain.com"
          aria-label="Creator domain to verify"
          className="h-10 flex-1 border-white/10 bg-white/[0.04] text-slate-100"
        />
        <Button
          type="submit"
          disabled={isLoading || !domain.trim()}
          className="h-10 shrink-0 bg-emerald-300 text-slate-950 hover:bg-emerald-200 disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Verifying…
            </>
          ) : (
            <>
              <BadgeCheck className="h-4 w-4" />
              Verify identity
            </>
          )}
        </Button>
      </form>

      {verification?.status === "verified" && verification.message ? (
        <p className="mt-3 text-sm text-emerald-200">{verification.message}</p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mt-3 text-sm text-rose-200"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
