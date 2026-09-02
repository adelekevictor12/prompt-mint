import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function getIsStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const media = window.matchMedia("(display-mode: standalone)");
  const navStandalone =
    typeof (window.navigator as unknown as { standalone?: boolean }).standalone ===
    "boolean"
      ? (window.navigator as unknown as { standalone?: boolean }).standalone === true
      : false;
  return media.matches || navStandalone;
}

export interface UsePWAInstall {
  isInstallable: boolean;
  isInstalled: boolean;
  install: () => Promise<void>;
}

export function usePWAInstall(): UsePWAInstall {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [isInstalled, setIsInstalled] = useState<boolean>(getIsStandalone());

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    const media = window.matchMedia("(display-mode: standalone)");
    const handleMediaChange = (e: MediaQueryListEvent) => setIsInstalled(e.matches);

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    media.addEventListener?.("change", handleMediaChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      media.removeEventListener?.("change", handleMediaChange);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  return {
    isInstallable: !isInstalled && deferredPrompt !== null,
    isInstalled,
    install,
  };
}
