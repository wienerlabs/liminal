import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDeepLinkToCurrentPage,
  buildSolflareBrowseLink,
  isInSolflareInAppBrowser,
} from "./solflareDeepLink";

/**
 * solflareDeepLink encodes the BLOK 6 deep-link contract:
 *   solflare://browse?url=<encoded-url>
 *
 * Tests lock in URL encoding, the "empty input → throw" guard, the
 * in-app browser detection heuristic (provider + UA), and SSR safety.
 */

const originalUA = typeof navigator !== "undefined" ? navigator.userAgent : "";

afterEach(() => {
  delete (window as unknown as { solflare?: unknown }).solflare;
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    get: () => originalUA,
  });
});

describe("buildSolflareBrowseLink", () => {
  it("wraps a simple https URL", () => {
    const link = buildSolflareBrowseLink("https://liminaltwap.com");
    expect(link).toBe("solflare://browse?url=https%3A%2F%2Fliminaltwap.com");
  });

  it("preserves query strings and fragments via encoding", () => {
    const link = buildSolflareBrowseLink(
      "https://liminaltwap.com/exec?slice=2#anchor",
    );
    expect(link).toContain(encodeURIComponent("?slice=2"));
    expect(link).toContain(encodeURIComponent("#anchor"));
  });

  it("throws on empty input so the caller catches programmer errors", () => {
    expect(() => buildSolflareBrowseLink("")).toThrow(/required/);
  });
});

describe("buildDeepLinkToCurrentPage", () => {
  it("returns null when window is absent (SSR)", () => {
    // happy-dom always provides window, so we simulate absence by
    // temporarily hiding location.href instead.
    const saved = window.location.href;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "" },
    });
    expect(buildDeepLinkToCurrentPage()).toBeNull();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: saved },
    });
  });

  it("encodes the current page URL", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "https://liminaltwap.com/execute" },
    });
    const link = buildDeepLinkToCurrentPage();
    expect(link).toBe("solflare://browse?url=https%3A%2F%2Fliminaltwap.com%2Fexecute");
  });
});

describe("isInSolflareInAppBrowser", () => {
  it("requires BOTH window.solflare AND UA hint", () => {
    // Only provider, no UA hint → false.
    (window as unknown as { solflare: { isSolflare: boolean } }).solflare = {
      isSolflare: true,
    };
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      get: () => "Mozilla/5.0 Desktop",
    });
    expect(isInSolflareInAppBrowser()).toBe(false);

    // Provider + UA hint → true.
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      get: () => "Mozilla/5.0 Solflare/9.0",
    });
    expect(isInSolflareInAppBrowser()).toBe(true);

    // UA hint only, no provider → false.
    delete (window as unknown as { solflare?: unknown }).solflare;
    expect(isInSolflareInAppBrowser()).toBe(false);
  });
});
