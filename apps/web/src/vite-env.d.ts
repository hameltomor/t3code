/// <reference types="vite/client" />

import type { NativeApi, DesktopBridge } from "@xbetools/contracts";

declare global {
  interface Window {
    nativeApi?: NativeApi;
    desktopBridge?: DesktopBridge;
  }
}
