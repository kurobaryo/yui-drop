/**
 * Admin session store.
 *
 * Stores the Bearer token + its expiry. Persisted to localStorage so a hard
 * refresh of /admin/* doesn't force re-login. We DO NOT store the password
 * anywhere — only the short-lived token.
 *
 * Note: persisting bearer tokens in localStorage is a deliberate tradeoff
 * (vs in-memory) for usability in a small self-hosted tool. Tokens are
 * short-lived (see server-side `issue_admin_token`) and Yui-Drop is
 * single-admin.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface AdminState {
  token: string | null;
  expiresAt: string | null;
  set: (token: string, expiresAt: string) => void;
  clear: () => void;
  isValid: () => boolean;
}

export const useAdminStore = create<AdminState>()(
  persist(
    (set, get) => ({
      token: null,
      expiresAt: null,
      set: (token, expiresAt) => set({ token, expiresAt }),
      clear: () => set({ token: null, expiresAt: null }),
      isValid: () => {
        const { token, expiresAt } = get();
        if (!token) return false;
        if (!expiresAt) return true; // be lenient
        const t = new Date(expiresAt).getTime();
        return Number.isFinite(t) ? t > Date.now() : true;
      },
    }),
    {
      name: 'yui-drop:admin',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        token: state.token,
        expiresAt: state.expiresAt,
      }),
    },
  ),
);
