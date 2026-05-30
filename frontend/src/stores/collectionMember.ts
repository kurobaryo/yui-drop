/**
 * Collection member session store.
 *
 * Keyed by 6-digit room code, each entry holds:
 *   - memberToken   : opaque session token returned by POST /join, used in
 *                     `X-Member-Token` header and SSE `?token=` query
 *   - nickname      : last-known display name
 *   - isCreator     : flipped true after a successful POST /admin/verify
 *   - adminPassword : OPTIONAL — cached only when the member checks
 *                     "remember on this device" so admin actions don't
 *                     re-prompt. Same usability tradeoff as `admin.ts`:
 *                     localStorage is acceptable for a self-hosted single-user
 *                     tool, callers may choose not to persist it.
 *
 * Persisted under `yui-drop:collection-members` in localStorage.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface CollectionMemberEntry {
  memberToken: string;
  nickname: string;
  isCreator: boolean;
  /** Optional cached admin password — only set when the user opts in. */
  adminPassword?: string;
}

interface CollectionMemberState {
  /** Map of room code → member session for that room. */
  members: Record<string, CollectionMemberEntry>;
  get: (code: string) => CollectionMemberEntry | undefined;
  set: (code: string, entry: CollectionMemberEntry) => void;
  patch: (code: string, partial: Partial<CollectionMemberEntry>) => void;
  clear: (code: string) => void;
  clearAll: () => void;
}

export const useCollectionMemberStore = create<CollectionMemberState>()(
  persist(
    (set, get) => ({
      members: {},
      get: (code) => get().members[code],
      set: (code, entry) =>
        set((s) => ({ members: { ...s.members, [code]: entry } })),
      patch: (code, partial) =>
        set((s) => {
          const existing = s.members[code];
          if (!existing) return s;
          return {
            members: { ...s.members, [code]: { ...existing, ...partial } },
          };
        }),
      clear: (code) =>
        set((s) => {
          if (!(code in s.members)) return s;
          const next = { ...s.members };
          delete next[code];
          return { members: next };
        }),
      clearAll: () => set({ members: {} }),
    }),
    {
      name: 'yui-drop:collection-members',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ members: state.members }),
    },
  ),
);

/** Convenience hook returning the member entry for a given room code. */
export function useCollectionMember(
  code: string | undefined,
): CollectionMemberEntry | undefined {
  return useCollectionMemberStore((s) => (code ? s.members[code] : undefined));
}
