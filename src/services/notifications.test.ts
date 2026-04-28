import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getNotificationPermission,
  isNotificationSupported,
  notify,
  notifyExecutionDone,
  notifyExecutionError,
  notifySliceReady,
  requestNotificationPermission,
  startTitleFlash,
  stopTitleFlash,
} from "./notifications";

/**
 * notifications.ts is the Level 2 ping layer. Tests lock in:
 *   - Graceful degradation when Notification API is absent
 *   - Silent suppression when the tab is currently focused (no
 *     redundant alert before the Solflare popup)
 *   - Title flash starts/stops cleanly and restores original title
 *   - requireInteraction passed through for slice-ready popups
 *   - Exported convenience helpers don't throw on unsupported envs
 */

type NotificationCtor = typeof Notification;

class MockNotification {
  static permission: NotificationPermission = "default";
  static requestPermission = vi.fn(
    async () => MockNotification.permission,
  );
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(public title: string, public options?: NotificationOptions) {
    MockNotification.instances.push(this);
  }
  static instances: MockNotification[] = [];
  static reset() {
    MockNotification.permission = "default";
    MockNotification.instances = [];
    MockNotification.requestPermission.mockClear();
  }
}

function installMockNotification(): void {
  (window as unknown as { Notification: NotificationCtor }).Notification =
    MockNotification as unknown as NotificationCtor;
}

function removeNotification(): void {
  delete (window as unknown as { Notification?: NotificationCtor })
    .Notification;
}

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

beforeEach(() => {
  MockNotification.reset();
  installMockNotification();
  setVisibility("hidden"); // default to backgrounded tab for notification tests
  document.title = "LIMINAL";
});

afterEach(() => {
  stopTitleFlash();
  removeNotification();
  vi.useRealTimers();
});

describe("isNotificationSupported", () => {
  it("returns true when window.Notification exists", () => {
    expect(isNotificationSupported()).toBe(true);
  });

  it("returns false when the API is absent", () => {
    removeNotification();
    expect(isNotificationSupported()).toBe(false);
  });
});

describe("getNotificationPermission", () => {
  it("reports the current native permission state", () => {
    MockNotification.permission = "granted";
    expect(getNotificationPermission()).toBe("granted");
    MockNotification.permission = "denied";
    expect(getNotificationPermission()).toBe("denied");
  });

  it("returns 'denied' when API is unsupported", () => {
    removeNotification();
    expect(getNotificationPermission()).toBe("denied");
  });
});

describe("requestNotificationPermission", () => {
  it("resolves with the permission returned by the browser", async () => {
    MockNotification.requestPermission.mockResolvedValueOnce("granted");
    await expect(requestNotificationPermission()).resolves.toBe("granted");
  });

  it("returns 'denied' when API is unsupported (no prompt)", async () => {
    removeNotification();
    await expect(requestNotificationPermission()).resolves.toBe("denied");
  });
});

describe("notify", () => {
  it("creates a native Notification when permission is granted and tab is hidden", () => {
    MockNotification.permission = "granted";
    notify("Test title", { body: "Test body", tag: "test" });
    expect(MockNotification.instances.length).toBe(1);
    const n = MockNotification.instances[0];
    expect(n.title).toBe("Test title");
    expect(n.options?.body).toBe("Test body");
    expect(n.options?.tag).toBe("test");
  });

  it("does NOT create a notification when the tab is currently visible", () => {
    MockNotification.permission = "granted";
    setVisibility("visible");
    notify("Test title", { body: "Should be silent" });
    expect(MockNotification.instances.length).toBe(0);
  });

  it("does NOT throw when permission is denied — falls through silently", () => {
    MockNotification.permission = "denied";
    expect(() => notify("x", { body: "y" })).not.toThrow();
    expect(MockNotification.instances.length).toBe(0);
  });

  it("does NOT throw when Notification API is absent", () => {
    removeNotification();
    expect(() => notify("x", { body: "y" })).not.toThrow();
  });

  it("passes requireInteraction through for slice-ready popups", () => {
    MockNotification.permission = "granted";
    notify("Slice 2 ready", {
      body: "Tap to sign",
      requireInteraction: true,
    });
    expect(MockNotification.instances[0].options?.requireInteraction).toBe(
      true,
    );
  });
});

describe("startTitleFlash / stopTitleFlash", () => {
  it("replaces title on interval and restores on stop", () => {
    vi.useFakeTimers();
    const original = "LIMINAL";
    document.title = original;

    startTitleFlash("Slice ready");
    // First tick — title mutated.
    vi.advanceTimersByTime(1000);
    expect(document.title).toContain("Slice ready");
    // Next tick — back to original.
    vi.advanceTimersByTime(1000);
    expect(document.title).toBe(original);

    stopTitleFlash();
    expect(document.title).toBe(original);
  });

  it("stops when the tab becomes visible again", () => {
    vi.useFakeTimers();
    document.title = "LIMINAL";
    startTitleFlash("Slice ready");
    vi.advanceTimersByTime(1000);
    expect(document.title).toContain("Slice ready");

    // Simulate user refocusing the tab.
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(1000);
    // Title is restored; the interval is cleared.
    expect(document.title).toBe("LIMINAL");
  });
});

describe("convenience helpers", () => {
  it("notifySliceReady builds a ready-labelled payload", () => {
    MockNotification.permission = "granted";
    notifySliceReady(2, 4);
    expect(MockNotification.instances[0].title).toBe("Slice 3/4 ready");
    expect(MockNotification.instances[0].options?.requireInteraction).toBe(
      true,
    );
  });

  it("notifyExecutionDone formats gain with sign", () => {
    MockNotification.permission = "granted";
    notifyExecutionDone(1234.56);
    expect(MockNotification.instances[0].options?.body).toContain("+$1234.56");
  });

  it("notifyExecutionDone JIT mode: no cleanup-popup hint", () => {
    MockNotification.permission = "granted";
    notifyExecutionDone(10, { autopilot: false });
    const body = MockNotification.instances[0].options?.body ?? "";
    expect(body).not.toContain("nonce rent");
    expect(body).not.toContain("One more popup");
  });

  it("notifyExecutionDone autopilot mode: includes cleanup-popup hint", () => {
    MockNotification.permission = "granted";
    notifyExecutionDone(10, { autopilot: true });
    const body = MockNotification.instances[0].options?.body ?? "";
    expect(body).toContain("nonce rent");
  });

  it("notifyExecutionError truncates long messages", () => {
    MockNotification.permission = "granted";
    const long = "x".repeat(200);
    notifyExecutionError(long);
    const body = MockNotification.instances[0].options?.body ?? "";
    expect(body.length).toBeLessThanOrEqual(140);
    expect(body.endsWith("…")).toBe(true);
  });
});
