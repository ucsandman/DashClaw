import { describe, expect, it, vi } from 'vitest';

const redirect = vi.fn((target) => {
  throw new Error(`NEXT_REDIRECT:${target}`);
});

vi.mock('next/navigation', () => ({ redirect }));

const { default: DemoPage, metadata } = await import('@/demo/page.js');

describe('/demo page', () => {
  it('redirects to the public live demo section', () => {
    expect(metadata.description).toMatch(/deterministic proof artifacts/i);

    expect(() => DemoPage()).toThrow(/NEXT_REDIRECT:\/#live-demo/);
    expect(redirect).toHaveBeenCalledWith('/#live-demo');
  });
});
