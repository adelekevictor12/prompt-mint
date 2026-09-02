import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import { wallet } from "../util/wallet";
import storage from "../util/storage";
import { stellarNetwork } from "../lib/env";
import { ALBEDO_ID } from "@creit.tech/stellar-wallets-kit";
import { useAsyncTransaction } from "../components/useAsyncTransaction";
import { trackEvent, trackEventWithWallet } from "../lib/analytics/track";
import { useQueryClient } from "@tanstack/react-query";
import { WalletAutoLockModal } from "@/components/WalletAutoLockModal";

export type WalletStatus = 
  | "idle" 
  | "connecting" 
  | "connected" 
  | "reconnecting" 
  | "error"
  | "disconnected";

/* eslint-disable no-unused-vars */
export interface WalletContextType {
  address?: string;
  network?: string;
  networkPassphrase?: string;
  status: WalletStatus;
  error?: string;
  connect: (_id: string) => Promise<void>;
  disconnect: () => Promise<void>;
  reconnect: () => Promise<void>;
  signTransaction: typeof wallet.signTransaction;
  signMessage: typeof wallet.signMessage;
  autoLockSecondsLeft: number | null;
  extendSession: () => void;
}
/* eslint-enable no-unused-vars */

// Auto-lock configuration: disconnect the wallet after this idle period.
const AUTO_LOCK_TIMEOUT_MS = Number(
  import.meta.env.VITE_WALLET_AUTO_LOCK_MS,
) || 15 * 60 * 1000;
// Show the warning modal this many ms before the lock kicks in.
const AUTO_LOCK_WARNING_MS = Math.min(60_000, AUTO_LOCK_TIMEOUT_MS);

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
];

const initialState = {
  address: undefined,
  network: undefined,
  networkPassphrase: undefined,
  status: "idle" as WalletStatus,
  error: undefined,
  autoLockSecondsLeft: null as number | null,
  extendSession: () => {},
};

const boundSignTransaction = wallet.signTransaction.bind(wallet);
const boundSignMessage = wallet.signMessage.bind(wallet);

export const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<Omit<WalletContextType, "connect" | "disconnect" | "reconnect" | "signTransaction" | "signMessage">>(initialState);
  const isConnectingRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 3;

  const [autoLockSecondsLeft, setAutoLockSecondsLeft] = useState<number | null>(
    null,
  );
  const lastActivityRef = useRef<number>(Date.now());

  const { execute: executeDisconnect } = useAsyncTransaction(
    async () => {
      await wallet.disconnect();
    },
    {
      pendingMessage: "Disconnecting wallet...",
      successMessage: "Wallet disconnected",
      onSuccess: () => {
        storage.removeItem("walletId");
        storage.removeItem("walletAddress");
        storage.removeItem("walletNetwork");
        storage.removeItem("networkPassphrase");
        trackEvent("wallet_disconnected", {});
        setState(initialState);
      }
    }
  );

  const disconnect = useCallback(async () => {
    reconnectAttemptsRef.current = 0; // Reset reconnect attempts on manual disconnect
    await executeDisconnect().catch(console.error);
  }, [executeDisconnect]);

  // Helper to safely get network info (handles Albedo's lack of getNetwork support)
  const getSafeNetworkInfo = useCallback(async (walletId: string) => {
    // Albedo and some other web wallets don't support getNetwork
    if (walletId === ALBEDO_ID) {
      return { network: stellarNetwork, networkPassphrase: undefined };
    }
    try {
      return await wallet.getNetwork();
    } catch {
      console.warn(`Wallet ${walletId} does not support getNetwork, using env default.`);
      return { network: stellarNetwork, networkPassphrase: undefined };
    }
  }, []);

  const { execute: executeConnect } = useAsyncTransaction(
    async (walletId: string) => {
      wallet.setWallet(walletId);
      
      const [a, n] = await Promise.all([
        wallet.getAddress(),
        getSafeNetworkInfo(walletId),
      ]);

      if (!a.address) throw new Error("No address returned from wallet");
      return { address: a.address, network: n.network, networkPassphrase: n.networkPassphrase, walletId };
    },
    {
      pendingMessage: (walletId) => `Connecting to ${walletId}...`,
      successMessage: "Wallet connected successfully",
      onOptimistic: () => {
        setState(prev => ({ ...prev, status: "connecting", error: undefined }));
      },
      onSuccess: (data) => {
        storage.setItem("walletId", data.walletId);
        storage.setItem("walletAddress", data.address);
        if (data.network) storage.setItem("walletNetwork", data.network);
        else storage.removeItem("walletNetwork");
        
        if (data.networkPassphrase) storage.setItem("networkPassphrase", data.networkPassphrase);
        else storage.removeItem("networkPassphrase");

        setState({
          address: data.address,
          network: data.network,
          networkPassphrase: data.networkPassphrase,
          status: "connected",
          error: undefined,
        });
        trackEventWithWallet("wallet_connected", data.address, { walletKind: data.walletId });
      },
      onError: (e) => {
        console.error("Connection error:", e);
        const message = e instanceof Error ? e.message : "Failed to connect wallet";
        setState(prev => ({
          ...prev,
          status: "error",
          error: message
        }));
        trackEvent("wallet_connect_failed", { reasonCode: "connect_error" });
      }
    }
  );

  const connect = useCallback(async (walletId: string) => {
    if (state.status === "connecting" || state.status === "reconnecting" || isConnectingRef.current) {
      return;
    }
    
    isConnectingRef.current = true;
    reconnectAttemptsRef.current = 0; // Reset attempts on manual connect
    try {
      await executeConnect(walletId).catch(() => {});
    } finally {
      isConnectingRef.current = false;
    }
  }, [executeConnect, state.status]);

  const extendSession = useCallback(() => {
    lastActivityRef.current = Date.now();
    setAutoLockSecondsLeft(null);
  }, []);

  // Auto-lock: disconnect the wallet after a configurable inactivity period.
  useEffect(() => {
    if (state.status !== "connected") {
      setAutoLockSecondsLeft(null);
      return;
    }

    lastActivityRef.current = Date.now();
    setAutoLockSecondsLeft(null);

    const handleActivity = () => {
      lastActivityRef.current = Date.now();
      setAutoLockSecondsLeft(null);
    };

    ACTIVITY_EVENTS.forEach((event) =>
      window.addEventListener(event, handleActivity, { passive: true }),
    );

    const interval = window.setInterval(() => {
      const idleFor = Date.now() - lastActivityRef.current;
      if (idleFor >= AUTO_LOCK_TIMEOUT_MS) {
        setAutoLockSecondsLeft(null);
        void disconnect();
        return;
      }
      const remaining = AUTO_LOCK_TIMEOUT_MS - idleFor;
      if (remaining <= AUTO_LOCK_WARNING_MS) {
        setAutoLockSecondsLeft(Math.ceil(remaining / 1000));
      } else {
        setAutoLockSecondsLeft(null);
      }
    }, 1000);

    return () => {
      window.clearInterval(interval);
      ACTIVITY_EVENTS.forEach((event) =>
        window.removeEventListener(event, handleActivity),
      );
    };
  }, [state.status, disconnect]);

  const checkExtensionAccount = useCallback(async () => {
    if (state.status !== "connected" && state.status !== "reconnecting") return;
    const savedId = storage.getItem("walletId");
    if (!savedId) return;

    try {
      const { address } = await wallet.getAddress();
      if (address && address !== state.address) {
        storage.setItem("walletAddress", address);
        setState((prev: any) => ({ ...prev, address }));
      }
    } catch (error) {
      console.error("Error checking extension account:", error);
      // If we can't get the address, the wallet might be locked/disconnected
      // Attempt to reconnect if we haven't exceeded max attempts
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current++;
        setState((prev: any) => ({ ...prev, status: "reconnecting" }));
      }
    }
  }, [state.status, state.address]);

  useEffect(() => {
    const handleFocus = () => void checkExtensionAccount();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [checkExtensionAccount]);

  const reconnect = useCallback(async () => {
    const savedId = storage.getItem("walletId");
    if (!savedId) {
      console.warn("Cannot reconnect: no saved wallet ID");
      return;
    }

    if (state.status === "connecting" || state.status === "reconnecting" || isConnectingRef.current) {
      return;
    }

    isConnectingRef.current = true;
    reconnectAttemptsRef.current = 0;
    setState((prev: any) => ({ ...prev, status: "reconnecting", error: undefined }));

    try {
      wallet.setWallet(savedId);
      const [a, n] = await Promise.all([
        wallet.getAddress(),
        getSafeNetworkInfo(savedId),
      ]);

      if (a.address) {
        storage.setItem("walletAddress", a.address);
        if (n.network) storage.setItem("walletNetwork", n.network);
        if (n.networkPassphrase) storage.setItem("networkPassphrase", n.networkPassphrase);

        setState({
          address: a.address,
          network: n.network,
          networkPassphrase: n.networkPassphrase,
          status: "connected",
          error: undefined,
        });
        trackEventWithWallet("wallet_connected", a.address, { walletKind: savedId, reconnected: true });
      } else {
        throw new Error("No address returned from wallet during reconnection");
      }
    } catch (error) {
      console.error("Reconnection failed:", error);
      const message = error instanceof Error ? error.message : "Failed to reconnect wallet";
      setState((prev: any) => ({
        ...prev,
        status: "error",
        error: message
      }));
      trackEvent("wallet_connect_failed", { reasonCode: "reconnect_error" });
    } finally {
      isConnectingRef.current = false;
    }
  }, [getSafeNetworkInfo, state.status]);

  // Listen for wallet account/network changes from extensions
  useEffect(() => {
    if (state.status !== "connected") return;

    const savedId = storage.getItem("walletId");
    if (!savedId) return;

    // Some wallets like Freighter emit events when account/network changes
    const handleAccountChange = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.log("Wallet account change detected:", customEvent.detail);
      // Trigger reconnection to get updated address/network
      void reconnect();
    };

    const handleNetworkChange = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.log("Wallet network change detected:", customEvent.detail);
      // Trigger reconnection to get updated network
      void reconnect();
    };

    // Add event listeners for wallet-specific events
    window.addEventListener("stellar:accountChanged", handleAccountChange);
    window.addEventListener("stellar:networkChanged", handleNetworkChange);

    return () => {
      window.removeEventListener("stellar:accountChanged", handleAccountChange);
      window.removeEventListener("stellar:networkChanged", handleNetworkChange);
    };
  }, [state.status, reconnect]);

  useEffect(() => {
    let aborted = false;

    const rehydrate = async () => {
      const savedId = storage.getItem("walletId");
      const savedAddr = storage.getItem("walletAddress");

      if (aborted) return;

      if (!savedId || !savedAddr) {
        setState((prev: any) => ({ ...prev, status: "idle" }));
        return;
      }

      setState((prev: any) => ({ ...prev, status: "reconnecting" }));
      reconnectAttemptsRef.current = 0;
      
      try {
        wallet.setWallet(savedId);
        const [a, n] = await Promise.all([
          wallet.getAddress(),
          getSafeNetworkInfo(savedId),
        ]);

        if (aborted) return;
        if (state.status !== "reconnecting" && state.status !== "idle") return;

        if (a.address) {
          if (a.address !== savedAddr) {
            storage.setItem("walletAddress", a.address);
          }
          if (aborted) return;
          setState({
            address: a.address,
            network: n.network,
            networkPassphrase: n.networkPassphrase,
            status: "connected",
            error: undefined,
          });
          trackEventWithWallet("wallet_connected", a.address, { walletKind: savedId, sessionRestored: true });
        } else {
          if (aborted) return;
          // Address not available - wallet might be locked
          setState((prev: any) => ({
            ...prev,
            status: "disconnected",
            error: "Wallet is locked or not available"
          }));
        }
    } catch (error) {
        if (aborted) return;
        console.warn("Session rehydration failed:", error);
        setState((prev: any) => ({
          ...prev,
          status: "disconnected",
          error: "Session restoration failed"
        }));
        trackEvent("wallet_connect_failed", { reasonCode: "session_restore_error" });
      }
    };

    void rehydrate();

    return () => {
      aborted = true;
    };
  }, [disconnect, getSafeNetworkInfo]);

  const contextValue = useMemo(
    () => ({
      ...state,
      connect,
      disconnect,
      reconnect,
      signTransaction: boundSignTransaction,
      signMessage: boundSignMessage,
      autoLockSecondsLeft,
      extendSession,
    }),
    [state, connect, disconnect, reconnect, autoLockSecondsLeft, extendSession]
  );

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
      <WalletAutoLockModal />
    </WalletContext.Provider>
  );
};