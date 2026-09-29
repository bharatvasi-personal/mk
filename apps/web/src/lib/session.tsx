'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { can, type Permission, type Role } from '@mk/shared';
import { bootstrapSession, get, post, setAccessToken } from './api';

export interface StaffSession {
  kind: 'STAFF';
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  locale: string;
  totpEnabled: boolean;
  permissions: Permission[];
  branchRoles: { role: Role; branchId: string | null; branch: { id: string; name: string; code: string } | null }[];
  employee: { id: string; employeeCode: string; roleType: string; branchId: string } | null;
}

export interface CustomerSession {
  kind: 'CUSTOMER';
  id: string;
  name: string | null;
  phone: string;
  locale: string;
}

type Session = StaffSession | CustomerSession | null;

interface SessionContextValue {
  session: Session;
  loading: boolean;
  /** Branch the user is currently working in. Persisted per device. */
  branchId: string | null;
  setBranchId: (id: string) => void;
  branches: { id: string; name: string; code: string }[];
  can: (permission: Permission, branchId?: string | null) => boolean;
  signIn: (identifier: string, password: string, totpCode?: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const BRANCH_KEY = 'mk.branchId';

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session>(null);
  const [loading, setLoading] = useState(true);
  const [branchId, setBranchIdState] = useState<string | null>(null);
  const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);

  const loadMe = useCallback(async () => {
    try {
      const me = await get<Session>('/auth/me');
      setSession(me);
      if (me?.kind === 'STAFF') {
        const list = await get<{ id: string; name: string; code: string }[]>('/branches');
        setBranches(list);
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(BRANCH_KEY) : null;
        // A stored branch the user has since lost access to must not stick around.
        const valid = stored && list.some((b) => b.id === stored) ? stored : (list[0]?.id ?? null);
        setBranchIdState(valid);
      }
    } catch {
      setSession(null);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      // Turn the HttpOnly refresh cookie into an in-memory access token, so a page
      // reload does not look like a sign-out.
      if (await bootstrapSession()) await loadMe();
      setLoading(false);
    })();
  }, [loadMe]);

  const setBranchId = useCallback((id: string) => {
    setBranchIdState(id);
    try {
      window.localStorage.setItem(BRANCH_KEY, id);
    } catch {
      /* private browsing — the in-memory value still works for this session */
    }
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      loading,
      branchId,
      setBranchId,
      branches,
      can: (permission, forBranch) => {
        if (session?.kind !== 'STAFF') return false;
        const grants = session.branchRoles.map((r) => ({ role: r.role, branchId: r.branchId }));
        return can(grants, permission, forBranch ?? branchId);
      },
      signIn: async (identifier, password, totpCode) => {
        const res = await post<{ accessToken: string }>('/auth/staff/login', {
          tenantSlug: process.env.NEXT_PUBLIC_DEFAULT_TENANT ?? 'mithilakitchen',
          identifier,
          password,
          totpCode: totpCode || undefined,
          client: 'WEB',
        });
        setAccessToken(res.accessToken);
        await loadMe();
      },
      signOut: async () => {
        await post('/auth/logout').catch(() => undefined);
        setAccessToken(null);
        setSession(null);
      },
      refresh: loadMe,
    }),
    [session, loading, branchId, branches, setBranchId, loadMe],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
