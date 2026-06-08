import { describe, it, expect, vi } from 'vitest';
import { bulkAction } from '@/lib/bulkAction';

const res = (ok: boolean) => ({ ok }) as unknown as Response;

describe('bulkAction', () => {
  it('issues one request per id (Promise.all) and splits ok/failed', async () => {
    const make = vi.fn((id: string) => Promise.resolve(res(id !== 'b')));
    const out = await bulkAction(['a', 'b', 'c'], make);
    expect(make).toHaveBeenCalledTimes(3);
    expect(out.ok).toEqual(['a', 'c']);
    expect(out.failed).toEqual(['b']);
  });

  it('treats a thrown request as failed without aborting the rest', async () => {
    const make = vi.fn((id: string) =>
      id === 'x' ? Promise.reject(new Error('boom')) : Promise.resolve(res(true)),
    );
    const out = await bulkAction(['x', 'y'], make);
    expect(out.ok).toEqual(['y']);
    expect(out.failed).toEqual(['x']);
  });

  it('calls the correct per-item route for each id', async () => {
    const fetchMock = vi.fn((_url: string, _opts?: any) => Promise.resolve(res(true)));
    await bulkAction(['k1', 'k2'], (id) => fetchMock(`/api/keys?id=${id}`, { method: 'DELETE' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/keys?id=k1', { method: 'DELETE' });
    expect(fetchMock).toHaveBeenCalledWith('/api/keys?id=k2', { method: 'DELETE' });
  });

  it('is a no-op on an empty id list', async () => {
    const make = vi.fn();
    const out = await bulkAction([], make);
    expect(make).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: [], failed: [] });
  });
});
