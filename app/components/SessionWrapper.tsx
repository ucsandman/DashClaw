'use client';

import React from 'react';
import { SessionProvider } from 'next-auth/react';
import { AgentFilterProvider } from '../lib/AgentFilterContext';
import { ContextMenuProvider } from './context-menu/ContextMenuProvider';
import { isDemoMode } from '../lib/isDemoMode';

function DemoSessionProvider({ children }: { children?: React.ReactNode }) {
  const mockSession = {
    data: {
      user: {
        id: 'demo_user',
        name: 'Demo Viewer',
        email: 'demo@dashclaw.io',
        image: null,
        orgId: 'org_demo',
        role: 'admin',
        plan: 'pro',
      },
      expires: '9999-12-31T23:59:59.999Z',
    },
    status: 'authenticated',
    update: () => Promise.resolve(),
  };

  return (
    <SessionProvider
      session={mockSession.data}
      refetchInterval={0}
      refetchOnWindowFocus={false}
    >
      {children}
    </SessionProvider>
  );
}

export default function SessionWrapper({ children }: { children?: React.ReactNode }) {
  // Demo mode is a public, read-only sandbox. Avoid NextAuth session fetches entirely.
  if (isDemoMode()) {
    return (
      <DemoSessionProvider>
        <AgentFilterProvider>
          <ContextMenuProvider>{children}</ContextMenuProvider>
        </AgentFilterProvider>
      </DemoSessionProvider>
    );
  }

  return (
    <SessionProvider>
      <AgentFilterProvider>
        <ContextMenuProvider>{children}</ContextMenuProvider>
      </AgentFilterProvider>
    </SessionProvider>
  );
}
