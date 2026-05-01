/**
 * LIMINAL — profileStore tests
 *
 * Covers
 *   - validateUsername: rejects too-short, too-long, illegal chars,
 *     accepts ASCII alphanumeric + `._-`
 *   - saveProfile: creates new record, preserves createdAt on update,
 *     bumps updatedAt
 *   - getProfile: returns the right record by address, null for unknown
 *   - subscribeProfiles: fires on save + delete, unsubscribe stops fires
 *   - deleteProfile: removes the record
 *
 * happy-dom provides localStorage so the persistence layer round-trips
 * for free. Each test resets the store via direct localStorage.clear()
 * + reloading the module so cross-test state can't leak.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "liminal:profiles:v1";

// Helper: get a fresh module instance so the in-memory cache resets
// between tests. Vitest's resetModules clears the import cache.
async function freshModule() {
  vi.resetModules();
  return import("./profileStore");
}

describe("profileStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("validateUsername", () => {
    it("rejects empty / too-short usernames with the min length in the message", async () => {
      const m = await freshModule();
      expect(m.validateUsername("")).toMatch(/at least 3/i);
      expect(m.validateUsername("ab")).toMatch(/at least 3/i);
    });

    it("rejects too-long usernames", async () => {
      const m = await freshModule();
      const tooLong = "a".repeat(21);
      expect(m.validateUsername(tooLong)).toMatch(/can't exceed 20/i);
    });

    it("rejects illegal characters", async () => {
      const m = await freshModule();
      expect(m.validateUsername("hello world")).toMatch(/letters, numbers/i);
      expect(m.validateUsername("emoji😀")).toMatch(/letters, numbers/i);
      expect(m.validateUsername("with/slash")).toMatch(/letters, numbers/i);
    });

    it("accepts the legal character class", async () => {
      const m = await freshModule();
      expect(m.validateUsername("alice")).toBeNull();
      expect(m.validateUsername("alice_42")).toBeNull();
      expect(m.validateUsername("alice-foo.bar")).toBeNull();
      expect(m.validateUsername("ABC")).toBeNull();
    });

    it("trims whitespace before checking length", async () => {
      const m = await freshModule();
      // 5 char username with leading/trailing space — 5 inside, valid.
      expect(m.validateUsername("  bob  ")).toBeNull();
      // 2 inside, invalid.
      expect(m.validateUsername("  ab  ")).toMatch(/at least 3/i);
    });
  });

  describe("saveProfile + getProfile", () => {
    it("creates a new record and returns it by address", async () => {
      const m = await freshModule();
      const rec = m.saveProfile({
        address: "wallet-A",
        username: "alice",
        avatarId: 2,
      });
      expect(rec.address).toBe("wallet-A");
      expect(rec.username).toBe("alice");
      expect(rec.avatarId).toBe(2);
      expect(rec.createdAt).toBeTruthy();
      expect(rec.updatedAt).toBe(rec.createdAt);

      const fetched = m.getProfile("wallet-A");
      expect(fetched).toEqual(rec);
    });

    it("preserves createdAt on update but bumps updatedAt", async () => {
      const m = await freshModule();
      const first = m.saveProfile({
        address: "wallet-A",
        username: "alice",
        avatarId: 1,
      });
      // Wait so updatedAt is provably later. setTimeout works in
      // happy-dom but we can also just sleep-microtask.
      await new Promise((r) => setTimeout(r, 5));
      const updated = m.saveProfile({
        address: "wallet-A",
        username: "alice2",
        avatarId: 3,
      });
      expect(updated.createdAt).toBe(first.createdAt);
      expect(updated.updatedAt).not.toBe(first.updatedAt);
      expect(updated.username).toBe("alice2");
      expect(updated.avatarId).toBe(3);
    });

    it("trims username whitespace", async () => {
      const m = await freshModule();
      const rec = m.saveProfile({
        address: "wallet-A",
        username: "  alice  ",
        avatarId: 1,
      });
      expect(rec.username).toBe("alice");
    });

    it("rejects invalid usernames at save time", async () => {
      const m = await freshModule();
      expect(() =>
        m.saveProfile({
          address: "wallet-A",
          username: "ab",
          avatarId: 1,
        }),
      ).toThrow(/at least 3/i);
    });

    it("returns null for an unknown address", async () => {
      const m = await freshModule();
      expect(m.getProfile("missing")).toBeNull();
      expect(m.getProfile(null)).toBeNull();
      expect(m.getProfile(undefined)).toBeNull();
    });

    it("persists to localStorage so a new module load sees the data", async () => {
      const m1 = await freshModule();
      m1.saveProfile({ address: "wallet-A", username: "alice", avatarId: 1 });
      // Reset modules but keep localStorage — that's the
      // freshModule() trick.
      const m2 = await freshModule();
      const rec = m2.getProfile("wallet-A");
      expect(rec?.username).toBe("alice");
    });

    it("ignores corrupt JSON in localStorage", async () => {
      localStorage.setItem(STORAGE_KEY, "{not json");
      const m = await freshModule();
      // Module load shouldn't throw, just returns empty registry.
      expect(m.getAllProfiles()).toEqual([]);
    });
  });

  describe("deleteProfile", () => {
    it("removes a saved record", async () => {
      const m = await freshModule();
      m.saveProfile({ address: "wallet-A", username: "alice", avatarId: 1 });
      expect(m.getProfile("wallet-A")).not.toBeNull();
      m.deleteProfile("wallet-A");
      expect(m.getProfile("wallet-A")).toBeNull();
    });

    it("is a no-op for unknown addresses", async () => {
      const m = await freshModule();
      expect(() => m.deleteProfile("never-saved")).not.toThrow();
    });
  });

  describe("subscribeProfiles", () => {
    it("fires the callback on saveProfile", async () => {
      const m = await freshModule();
      const cb = vi.fn();
      m.subscribeProfiles(cb);
      m.saveProfile({ address: "wallet-A", username: "alice", avatarId: 1 });
      expect(cb).toHaveBeenCalled();
    });

    it("fires the callback on deleteProfile", async () => {
      const m = await freshModule();
      m.saveProfile({ address: "wallet-A", username: "alice", avatarId: 1 });
      const cb = vi.fn();
      m.subscribeProfiles(cb);
      m.deleteProfile("wallet-A");
      expect(cb).toHaveBeenCalled();
    });

    it("unsubscribe stops further callbacks", async () => {
      const m = await freshModule();
      const cb = vi.fn();
      const unsub = m.subscribeProfiles(cb);
      unsub();
      m.saveProfile({ address: "wallet-A", username: "alice", avatarId: 1 });
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe("getAllProfiles", () => {
    it("returns records sorted by updatedAt descending", async () => {
      const m = await freshModule();
      m.saveProfile({ address: "wallet-A", username: "alice", avatarId: 1 });
      await new Promise((r) => setTimeout(r, 5));
      m.saveProfile({ address: "wallet-B", username: "bob", avatarId: 2 });
      const all = m.getAllProfiles();
      expect(all.length).toBe(2);
      // Most-recent first
      expect(all[0].username).toBe("bob");
      expect(all[1].username).toBe("alice");
    });
  });
});
