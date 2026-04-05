/**
 * LIMINAL — useDeviceDetection hook
 *
 * BLOK 7 "Mobil Uyumluluk" ve BLOK 6 "Solflare In-App Browser" disiplininin
 * React entry point'i. Üç breakpoint + Solflare in-app browser tespiti +
 * canlı viewport boyutları.
 *
 * In-app browser tespiti için iki koşul birden sağlanmalı (false positive'i
 * engellemek için): hem navigator.userAgent "Solflare" string'i içermeli
 * hem de window.solflare.isSolflare true olmalı.
 *
 * Mobile flag'i ayrıca module-level `_isMobileGlobal` değişkenine yazılır
 * ki solflare.ts gibi servis katmanları React context'e girmeden bu bilgiye
 * erişebilsin (ör. mobile signing öncesi 50ms gecikme).
 */

import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Breakpoints
// ---------------------------------------------------------------------------

const MOBILE_MAX = 767;
const TABLET_MAX = 1023;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeviceDetection = {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isSolflareInAppBrowser: boolean;
  viewportWidth: number;
  viewportHeight: number;
};

// ---------------------------------------------------------------------------
// Module-level global (servis katmanı için)
// ---------------------------------------------------------------------------

let _isMobileGlobal = false;

/** Solflare signing öncesi 50ms gecikme gibi servis-level kontroller için. */
export function getIsMobileGlobal(): boolean {
  return _isMobileGlobal;
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

function isSolflareInAppBrowserNow(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof navigator === "undefined") return false;

  // 1) User agent içinde "Solflare" string'i
  const uaHasSolflare = /solflare/i.test(navigator.userAgent ?? "");

  // 2) window.solflare.isSolflare true
  const solflare = (window as { solflare?: { isSolflare?: boolean } }).solflare;
  const windowHasSolflare = !!solflare && solflare.isSolflare === true;

  // İkisi birden sağlanmalı — sadece UA yeterli değil (Solflare adını taşıyan
  // başka browser eklentileri olabilir).
  return uaHasSolflare && windowHasSolflare;
}

function computeSnapshot(): DeviceDetection {
  const width = typeof window !== "undefined" ? window.innerWidth : 1024;
  const height = typeof window !== "undefined" ? window.innerHeight : 768;
  const isMobile = width <= MOBILE_MAX;
  const isTablet = width > MOBILE_MAX && width <= TABLET_MAX;
  const isDesktop = width > TABLET_MAX;
  return {
    isMobile,
    isTablet,
    isDesktop,
    isSolflareInAppBrowser: isSolflareInAppBrowserNow(),
    viewportWidth: width,
    viewportHeight: height,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDeviceDetection(): DeviceDetection {
  const [state, setState] = useState<DeviceDetection>(() => computeSnapshot());

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handler = (): void => {
      const snap = computeSnapshot();
      setState(snap);
      _isMobileGlobal = snap.isMobile;
    };

    // Mount'ta bir kez sync et (initial state SSR-safe hesaplama kullanabilir).
    handler();

    window.addEventListener("resize", handler);
    window.addEventListener("orientationchange", handler);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("orientationchange", handler);
    };
  }, []);

  return state;
}
