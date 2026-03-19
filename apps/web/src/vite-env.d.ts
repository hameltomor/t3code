/// <reference types="vite/client" />

import type { NativeApi, DesktopBridge } from "@xbetools/contracts";

declare global {
  const __APP_VERSION__: string;
  interface Window {
    nativeApi?: NativeApi;
    desktopBridge?: DesktopBridge;
  }
}
