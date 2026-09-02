import { Download, CheckCircle2 } from "lucide-react";
import { Button } from "./ui/button";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { toast } from "sonner";

interface InstallAppButtonProps {
  variant?: "icon" | "full";
  className?: string;
}

export function InstallAppButton({
  variant = "icon",
  className,
}: InstallAppButtonProps) {
  const { isInstallable, isInstalled, install } = usePWAInstall();

  if (isInstalled) {
    if (variant === "full") {
      return (
        <div
          className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm text-emerald-400 ${
            className ?? ""
          }`}
        >
          <CheckCircle2 className="h-4 w-4" />
          Installed
        </div>
      );
    }
    return null;
  }

  if (!isInstallable) return null;

  const handleInstall = async () => {
    try {
      await install();
    } catch {
      toast.error("Could not start install. Try your browser's menu.");
    }
  };

  if (variant === "full") {
    return (
      <button
        onClick={handleInstall}
        className={`flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10 ${
          className ?? ""
        }`}
      >
        <Download className="h-4 w-4" />
        Install app
      </button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleInstall}
      aria-label="Install app"
      title="Install app"
      className={`border border-white/10 text-white hover:bg-white/10 ${className ?? ""}`}
    >
      <Download className="h-4 w-4" />
    </Button>
  );
}
