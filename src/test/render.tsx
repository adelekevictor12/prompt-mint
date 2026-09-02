import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render,
  type RenderOptions,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import {
  WalletContext,
  type WalletContextType,
} from "@/providers/WalletProvider";
import { TransactionProvider } from "@/components/TransactionProvider";
import { CurrencyProvider } from "@/providers/CurrencyProvider";
import { KeyboardShortcutsProvider } from "@/providers/KeyboardShortcutsProvider";
import { CartProvider } from "@/providers/CartProvider";

const defaultWallet: WalletContextType = {
  address: undefined,
  network: undefined,
  networkPassphrase: undefined,
  status: "idle",
  error: undefined,
  connect: vi.fn(),
  disconnect: vi.fn(),
  reconnect: vi.fn(),
  signMessage: vi.fn(),
  signTransaction: vi.fn(),
};

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

interface AppRenderOptions extends Omit<RenderOptions, "wrapper"> {
  route?: string;
  wallet?: Partial<WalletContextType>;
  queryClient?: QueryClient;
}

export function renderWithProviders(
  ui: ReactElement,
  {
    route = "/",
    wallet,
    queryClient = createTestQueryClient(),
    ...renderOptions
  }: AppRenderOptions = {},
) {
  const walletValue: WalletContextType = {
    ...defaultWallet,
    ...wallet,
  };

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <WalletContext value={walletValue}>
        <CurrencyProvider><CartProvider><TransactionProvider>
          <MemoryRouter initialEntries={[route]}>
            <KeyboardShortcutsProvider>{children}</KeyboardShortcutsProvider>
          </MemoryRouter>
        </TransactionProvider></CartProvider></CurrencyProvider>
      </WalletContext>
    </QueryClientProvider>
  );

  return {
    queryClient,
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
  };
}
