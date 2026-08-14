'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal, Check, X } from 'lucide-react';
import { generateConnectPrompt, generateCoveragePrompt } from '../lib/connectPrompt';

interface ConnectAgentButtonProps {
  className?: string;
  label?: string;
  promptType?: string;
}

/**
 * Copies the agent setup prompt — and always SHOWS it too. The prompt is full
 * of shell commands, which is exactly the shape uBlock Origin's ClickFix
 * defense (1.72+) intercepts on programmatic clipboard writes: the write can
 * be defused so the promise still resolves, with no exception to catch. A
 * readText() round-trip after the write is what actually confirms it landed;
 * when that can't be confirmed the dialog says so instead of claiming
 * "copied". The dialog with the text pre-selected is the guarantee either
 * way — a native Ctrl+C of a selection is a user copy no extension blocks.
 */
export default function ConnectAgentButton({
  className = '',
  label = 'Copy Agent Prompt',
  promptType = 'connect',
}: ConnectAgentButtonProps) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [wroteClipboard, setWroteClipboard] = useState(false);
  // writeText resolving is not proof the text landed — uBlock's ClickFix
  // defuser (1.72+) can no-op the write without throwing. A readText()
  // round-trip is the only thing that actually confirms it.
  const [clipboardVerified, setClipboardVerified] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleClick = async () => {
    const baseUrl = window.location.origin;
    let orgName = 'My Workspace';
    try {
      const res = await fetch('/api/team');
      if (res.ok) {
        const data = await res.json();
        orgName = data.org?.name || data.name || orgName;
      }
    } catch {
      // Fall back to default name
    }
    const text = promptType === 'coverage'
      ? generateCoveragePrompt(baseUrl, orgName)
      : generateConnectPrompt(baseUrl, orgName);
    let wrote = false;
    let verified = false;
    try {
      await navigator.clipboard.writeText(text);
      wrote = true;
      try {
        verified = (await navigator.clipboard.readText()) === text;
      } catch {
        // Read is unpermitted or unavailable — the write can't be confirmed,
        // so don't claim it landed. Not the same as a blocked write.
      }
    } catch {
      // Blocked or unavailable — the dialog below is the real path.
    }
    setWroteClipboard(wrote);
    setClipboardVerified(verified);
    setPrompt(text);
  };

  useEffect(() => {
    if (prompt !== null && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [prompt]);

  useEffect(() => {
    if (prompt === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPrompt(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prompt]);

  return (
    <>
      <button
        onClick={handleClick}
        className={`flex items-center gap-1.5 px-3 py-2 bg-surface-tertiary border border-border rounded-lg text-sm text-secondary hover:text-white hover:border-border-hover transition-colors ${className}`}
      >
        <Terminal size={14} />
        {label}
      </button>

      {prompt !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPrompt(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Agent prompt"
            className="w-full max-w-2xl rounded-xl border border-border-hover bg-surface-secondary p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_30px_90px_rgba(0,0,0,0.55)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                {wroteClipboard && clipboardVerified ? <Check size={15} className="text-success" /> : <Terminal size={15} />}
                Agent prompt {wroteClipboard && clipboardVerified ? 'copied' : 'ready'}
              </div>
              <button
                onClick={() => setPrompt(null)}
                aria-label="Close"
                className="rounded-md p-1 text-tertiary hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <p className="mt-2 text-xs text-secondary leading-relaxed">
              {wroteClipboard && clipboardVerified
                ? 'It is on your clipboard. Some content blockers (uBlock Origin’s ClickFix defense) silently block programmatic copies of terminal commands — if your paste comes up empty, the text below is already selected: press Ctrl+C / ⌘C.'
                : wroteClipboard
                  ? 'The prompt should be on your clipboard, but we could not confirm the copy landed — some content blockers silently no-op it. If pasting gives you something else, use the text below instead: it is already selected, press Ctrl+C / ⌘C.'
                  : 'Your browser blocked the programmatic copy — content blockers flag pages that push terminal commands onto the clipboard. The text below is already selected: press Ctrl+C / ⌘C.'}
            </p>
            <textarea
              ref={textareaRef}
              readOnly
              value={prompt}
              rows={10}
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              className="mt-3 w-full resize-none rounded-lg border border-border bg-surface-tertiary p-3 font-mono text-xs text-secondary leading-relaxed focus:outline-none focus:border-border-active"
            />
          </div>
        </div>
      )}
    </>
  );
}
