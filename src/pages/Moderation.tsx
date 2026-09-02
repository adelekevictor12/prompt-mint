import { useWallet } from "../hooks/useWallet";
import { Navigation } from "../components/navigation";
import { Footer } from "../components/footer";
import { AuditLogViewer } from "../components/moderation/AuditLogViewer";
import { ModerationQueue } from "../components/moderation/ModerationQueue";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";

export default function ModerationPage() {
  const { address, signMessage } = useWallet();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.08),_transparent_35%),linear-gradient(180deg,_#020617,_#0f172a_45%,_#020617)] text-white">
      <Navigation />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold sm:text-3xl">Moderation Dashboard</h1>
          <p className="text-slate-400 text-sm mt-2">
            Review abuse reports and audit moderation actions taken on the marketplace
          </p>
        </div>

        <Tabs defaultValue="queue" className="w-full">
          <TabsList className="bg-white/5 border border-white/10">
            <TabsTrigger value="queue" className="data-[state=active]:bg-emerald-500 data-[state=active]:text-slate-950">
              Report Queue
            </TabsTrigger>
            <TabsTrigger value="audit" className="data-[state=active]:bg-emerald-500 data-[state=active]:text-slate-950">
              Audit Log
            </TabsTrigger>
          </TabsList>

          <TabsContent value="queue" className="mt-6">
            <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-6 sm:p-8">
              <ModerationQueue moderatorAddress={address ?? ""} signMessage={signMessage} />
            </section>
          </TabsContent>

          <TabsContent value="audit" className="mt-6">
            <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-6 sm:p-8">
              <AuditLogViewer moderatorAddress={address ?? ""} signMessage={signMessage} />
            </section>
          </TabsContent>
        </Tabs>
      </main>

      <Footer />
    </div>
  );
}
