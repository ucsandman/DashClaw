'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Document Picture-in-Picture (Chromium 116+): the one web API that gives a
// genuinely OS-always-on-top window. Progressive enhancement only — feature-
// detected, never required; Firefox/Safari keep the plain popup + OS-pin path.
//
// The PiP window is TETHERED: it closes when the opener tab closes or
// navigates. The widget tree is rendered into it via createPortal from the
// opener, so all JS (summary fetch, SSE, approval POSTs) keeps running in the
// opener realm with the opener's same-origin session — no extra auth.
interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  window: Window | null;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

export interface UseDocumentPiPResult {
  /** True when the browser exposes the Document PiP API (Chromium only). */
  supported: boolean;
  /** The open PiP window, or null. Render content into pipWindow.document.body via createPortal. */
  pipWindow: Window | null;
  /** Open the PiP window (must be called from a user gesture). */
  open: (size?: { width: number; height: number }) => Promise<void>;
  close: () => void;
}

/**
 * Stylesheets do NOT propagate into a Document PiP window — clone the
 * opener's <link rel="stylesheet"> and <style> nodes into its head so the
 * portal renders with the app's tokens. Same-origin, so no CORS concerns.
 */
function cloneStylesInto(pip: Window): void {
  const head = pip.document.head;
  const nodes = document.querySelectorAll('link[rel="stylesheet"], style');
  nodes.forEach((node) => {
    head.appendChild(node.cloneNode(true));
  });
  // Match the app shell: the portal body should sit on the canvas token.
  pip.document.documentElement.className = document.documentElement.className;
  pip.document.body.className = 'bg-surface-primary text-primary';
}

export function useDocumentPiP(): UseDocumentPiPResult {
  const [supported, setSupported] = useState(false);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  // Ref mirror so close/unmount never act on a stale captured window.
  const pipRef = useRef<Window | null>(null);

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && 'documentPictureInPicture' in window);
  }, []);

  const close = useCallback(() => {
    try {
      pipRef.current?.close();
    } catch {
      // already closed by the user or the browser
    }
    pipRef.current = null;
    setPipWindow(null);
  }, []);

  const open = useCallback(async (size?: { width: number; height: number }) => {
    const api = typeof window !== 'undefined' ? window.documentPictureInPicture : undefined;
    if (!api) return;
    const pip = await api.requestWindow({
      width: size?.width ?? 380,
      height: size?.height ?? 720,
    });
    cloneStylesInto(pip);
    // The user can close the PiP window from its own chrome — sync our state.
    pip.addEventListener('pagehide', () => {
      pipRef.current = null;
      setPipWindow(null);
    }, { once: true });
    pipRef.current = pip;
    setPipWindow(pip);
  }, []);

  // The PiP window dies with its opener; also close it if this component unmounts.
  useEffect(
    () => () => {
      try {
        pipRef.current?.close();
      } catch {
        // closing an already-gone window is fine
      }
      pipRef.current = null;
    },
    [],
  );

  return { supported, pipWindow, open, close };
}
