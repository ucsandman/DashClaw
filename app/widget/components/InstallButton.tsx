'use client';

import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

// Progressive enhancement: show an in-app "Install" affordance ONLY when the
// browser reports the widget is installable (the `beforeinstallprompt` event).
// By default it renders nothing on unsupported browsers or once installed.
// With `showFallbackHint` (used inside the settings panel, where an invisible
// control would read as a bug) it renders an honest one-line hint instead of
// nothing when the event never fires (Firefox/Safari, or already installed).
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallButton({ showFallbackHint = false }: { showFallbackHint?: boolean }) {
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

  if (!deferred) {
    if (!showFallbackHint) return null;
    return (
      <p className="text-xs text-tertiary">
        Install not offered by this browser — already installed, or use Chrome/Edge&apos;s
        address-bar install icon. See the widget docs for the app-mode launcher.
      </p>
    );
  }

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
      className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-1 text-xs font-medium text-secondary transition-colors hover:border-border-hover hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <Download size={12} aria-hidden="true" />
      Install
    </button>
  );
}
