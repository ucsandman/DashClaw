'use client';

import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

// Progressive enhancement: show an in-app "Install" affordance ONLY when the
// browser reports the widget is installable (the `beforeinstallprompt` event).
// It renders nothing on unsupported browsers or once installed — so the surface
// stays calm in the common case while making first-run install one click.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!deferred) return null;

  const install = async () => {
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      // user-gesture / availability issues are non-fatal
    } finally {
      setDeferred(null);
    }
  };

  return (
    <button
      type="button"
      onClick={install}
      aria-label="Install the DashClaw status widget as a desktop app"
      className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-1 text-[10px] font-medium text-secondary transition-colors hover:border-border-hover hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <Download size={12} aria-hidden="true" />
      Install
    </button>
  );
}
