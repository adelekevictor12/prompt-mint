
const storageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: storageMock,
  configurable: true,
  writable: true,
});

if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    value: storageMock,
    configurable: true,
    writable: true,
  });
}

import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { Buffer } from 'buffer';
import * as nodeCrypto from 'node:crypto';

// 1. Force Buffer Polyfill
globalThis.Buffer = Buffer;

// 2. Force Crypto Polyfill (The proper way to bypass "getter-only" restriction)
Object.defineProperty(globalThis, 'crypto', {
  value: nodeCrypto.webcrypto,
  configurable: true,
  writable: true,
});

// 3. Mock window features for JSDOM
if (typeof window !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => undefined;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => undefined;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), 
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// The published design-system package references source SCSS files that are not
// included in its npm artifact. Tests only need semantic stand-ins for its UI.
vi.mock('@stellar/design-system', async () => {
  const React = await import('react');
  const element = (tag: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(tag, props, children as React.ReactNode);

  return {
    Alert: element('div'),
    Button: element('button'),
    Card: element('div'),
    Code: element('code'),
    Icon: element('span'),
    Input: element('input'),
    Layout: element('div'),
    Link: element('a'),
    Loader: element('div'),
    Notification: ({ title }: { title?: string }) => React.createElement('div', null, title),
    Select: element('select'),
    Text: element('span'),
    Tooltip: element('span'),
  };
});