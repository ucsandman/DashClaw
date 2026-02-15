'use client';

import { useState } from 'react';
import { Terminal, Check } from 'lucide-react';
import { generateConnectPrompt } from '../lib/connectPrompt';

export default function ConnectAgentButton({ className = '', label = 'Copy Agent Prompt' }) {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    try {
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
      const prompt = generateConnectPrompt(baseUrl, orgName);
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`flex items-center gap-1.5 px-3 py-2 bg-surface-tertiary border border-[rgba(255,255,255,0.06)] rounded-lg text-sm text-zinc-300 hover:text-white hover:border-[rgba(255,255,255,0.12)] transition-colors ${className}`}
    >
      {copied ? <Check size={14} className="text-green-400" /> : <Terminal size={14} />}
      {copied ? 'Copied!' : label}
    </button>
  );
}
