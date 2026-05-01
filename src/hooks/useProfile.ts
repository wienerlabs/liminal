/**
 * LIMINAL — useProfile hook
 *
 * React binding for `profileStore`. Returns the profile record
 * associated with the connected wallet, plus stable callbacks for
 * saving / deleting. Re-renders on store updates from anywhere via
 * the module-level subscriber pattern.
 *
 *   const { profile, save, remove } = useProfile(walletAddress);
 *   if (profile) showName(profile.username);
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  deleteProfile as storeDelete,
  getProfile,
  saveProfile,
  subscribeProfiles,
  type ProfileRecord,
  type SaveProfileInput,
} from "../services/profileStore";

export type UseProfileResult = {
  profile: ProfileRecord | null;
  save: (input: Omit<SaveProfileInput, "address">) => ProfileRecord;
  remove: () => void;
};

export function useProfile(address: string | null | undefined): UseProfileResult {
  // Subscribe once; re-read the current profile on each notification.
  // A stable getServerSnapshot returns null because profiles only exist
  // client-side (no SSR semantics for this app).
  const profile = useSyncExternalStore(
    subscribeProfiles,
    () => getProfile(address ?? null),
    () => null,
  );

  const save = useCallback(
    (input: Omit<SaveProfileInput, "address">): ProfileRecord => {
      if (!address) {
        throw new Error("Cannot save profile: no wallet address.");
      }
      return saveProfile({ ...input, address });
    },
    [address],
  );

  const remove = useCallback(() => {
    if (!address) return;
    storeDelete(address);
  }, [address]);

  return { profile, save, remove };
}
