import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { InstallButton } from '@/widget/components/InstallButton';

afterEach(cleanup);

function makeInstallEvent() {
  const e = new Event('beforeinstallprompt');
  // The real event carries these; stub them so the handler can call prompt().
  e.prompt = () => Promise.resolve();
  e.userChoice = Promise.resolve({ outcome: 'dismissed' });
  return e;
}

describe('InstallButton', () => {
  it('renders nothing until the browser reports installability', () => {
    const { container } = render(<InstallButton />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('shows an Install button after beforeinstallprompt fires', async () => {
    const { container } = render(<InstallButton />);
    await act(async () => {
      window.dispatchEvent(makeInstallEvent());
    });
    const btn = container.querySelector('button');
    expect(btn).not.toBeNull();
    expect(container.textContent).toContain('Install');
    expect(btn.getAttribute('aria-label')).toMatch(/install/i);
  });
});
