'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Wrench, Plus, Search, RotateCw, Trash2 } from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { EmptyState } from '../components/ui/EmptyState';
import CapabilityRegistrySummary from './components/CapabilityRegistrySummary';
import CapabilityRegistryFilters from './components/CapabilityRegistryFilters';
import CapabilityRegistryCard from './components/CapabilityRegistryCard';
import { useSelection } from '../lib/useSelection';
import { useSelectAllHotkey } from '../lib/useSelectAllHotkey';
import { SelectCheckbox } from '../components/selection/SelectCheckbox';
import { BulkActionBar } from '../components/selection/BulkActionBar';
import { bulkAction } from '../lib/bulkAction';

const RISK_LEVELS = ['all', 'low', 'medium', 'high', 'critical'];

interface TestStatusEntry {
  submitting: boolean;
  message: string | null;
  error: boolean;
}

export default function CapabilitiesPage() {
  const [capabilities, setCapabilities] = useState<any[]>([]);
  const [healthRows, setHealthRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState('all');
  const [healthFilter, setHealthFilter] = useState('all');
  const [staleOnly, setStaleOnly] = useState(false);
  const [uncertifiedOnly, setUncertifiedOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<Record<string, TestStatusEntry>>({});

  const fetchCapabilities = useCallback(async () => {
    try {
      setError(null);
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (riskFilter !== 'all') params.set('risk_level', riskFilter);
      params.set('limit', '100');

      const [capabilityRes, healthRes] = await Promise.all([
        fetch(`/api/capabilities?${params.toString()}`),
        fetch(`/api/capabilities/health?${params.toString()}`),
      ]);

      if (capabilityRes.ok) {
        const data = await capabilityRes.json();
        setCapabilities(data.capabilities || []);
      } else {
        setCapabilities([]);
        setError('Failed to fetch capabilities');
      }

      if (healthRes.ok) {
        const healthData = await healthRes.json();
        setHealthRows(healthData.capabilities || []);
        setHealthError(null);
      } else {
        setHealthRows([]);
        setHealthError('Capability health unavailable');
      }
    } catch (err: any) {
      console.error('Failed to fetch capabilities:', err);
      setError(err.message || 'Failed to fetch capabilities');
      setCapabilities([]);
      setHealthRows([]);
    } finally {
      setLoading(false);
    }
  }, [search, riskFilter]);

  useEffect(() => {
    const debounce = setTimeout(fetchCapabilities, 200);
    return () => clearTimeout(debounce);
  }, [fetchCapabilities]);

  const mergedCapabilities = useMemo(() => {
    const healthById = new Map(healthRows.map((row) => [row.capability_id, row]));
    return capabilities.map((capability) => ({
      ...capability,
      ...(healthById.get(capability.capability_id) || {}),
    }));
  }, [capabilities, healthRows]);

  const filteredCapabilities = useMemo(() => {
    return mergedCapabilities.filter((capability) => {
      const currentHealth = capability.status || capability.health_status || 'unknown';
      const certificationStatus = capability.certification_status || 'uncertified';

      if (healthFilter !== 'all' && currentHealth !== healthFilter) return false;
      if (staleOnly && capability.stale_check !== true) return false;
      if (uncertifiedOnly && certificationStatus !== 'uncertified') return false;

      return true;
    });
  }, [mergedCapabilities, healthFilter, staleOnly, uncertifiedOnly]);

  const summaryCounts = useMemo(() => ({
    total: mergedCapabilities.length,
    attention: mergedCapabilities.filter((capability) => ['unhealthy', 'degraded', 'failing'].includes(capability.status || capability.health_status)).length,
    stale: mergedCapabilities.filter((capability) => capability.stale_check === true || capability.certification_status === 'stale').length,
    uncertified: mergedCapabilities.filter((capability) => (capability.certification_status || 'uncertified') === 'uncertified').length,
  }), [mergedCapabilities]);

  const handleRunTest = useCallback(async (capability: any) => {
    setTestStatus((current) => ({
      ...current,
      [capability.capability_id]: {
        submitting: true,
        message: null,
        error: false,
      },
    }));

    try {
      const response = await fetch(`/api/capabilities/${capability.capability_id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const body = await response.json().catch(() => ({}));
      const message = body.message || body.error || 'Capability test completed';

      setTestStatus((current) => ({
        ...current,
        [capability.capability_id]: {
          submitting: false,
          message,
          error: !response.ok,
        },
      }));

      await fetchCapabilities();
    } catch (err: any) {
      setTestStatus((current) => ({
        ...current,
        [capability.capability_id]: {
          submitting: false,
          message: err.message || 'Capability test failed',
          error: true,
        },
      }));
    }
  }, [fetchCapabilities]);

  const handleDelete = useCallback(async (capabilityId: string) => {
    try {
      const res = await fetch(`/api/capabilities/${capabilityId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Failed to delete capability');
        return;
      }
      await fetchCapabilities();
    } catch (err: any) {
      setError(err.message || 'Failed to delete capability');
    }
  }, [fetchCapabilities]);

  const selection = useSelection<any>(filteredCapabilities, (c) => c.capability_id);
  useSelectAllHotkey(selection.toggleAll);

  async function bulkDelete() {
    if (selection.count === 0) return;
    if (typeof window !== 'undefined' && !window.confirm(`Delete ${selection.count} ${selection.count === 1 ? 'capability' : 'capabilities'}? This cannot be undone.`)) return;
    const { ok } = await bulkAction(selection.selectedIds, (id) => fetch(`/api/capabilities/${id}`, { method: 'DELETE' }));
    setCapabilities((prev) => prev.filter((x) => !ok.includes(x.capability_id)));
    selection.clear();
  }

  const BULK_ACTIONS = [
    { id: 'delete', label: 'Delete', icon: Trash2, onClick: bulkDelete, danger: true },
  ];

  return (
    <PageLayout
      title="Capability Registry"
      subtitle="Governed registry of callable capabilities with risk, approval, and health metadata"
      breadcrumbs={['Studio', 'Capabilities']}
      maturity="stable"
      actions={(
        <>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchCapabilities}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm font-medium text-secondary transition-colors hover:border-border-hover hover:text-white"
            >
              <RotateCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <Link
              href="/capabilities/new"
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
            >
              <Plus size={14} /> Register capability
            </Link>
          </div>
          <BulkActionBar count={selection.count} actions={BULK_ACTIONS} onClear={selection.clear} />
        </>
      )}
    >
      <CapabilityRegistrySummary counts={summaryCounts} />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative max-w-md flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, description, tags…"
            className="w-full rounded-lg border border-border bg-surface-tertiary py-2 pl-9 pr-3 text-sm text-white transition-colors focus:border-brand/40 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {RISK_LEVELS.map((level) => (
            <button
              key={level}
              onClick={() => setRiskFilter(level)}
              className={`rounded-md border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
                riskFilter === level
                  ? 'border-brand/30 bg-brand/10 text-brand hover:border-brand/40'
                  : 'border-transparent text-tertiary hover:border-border hover:text-secondary'
              }`}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      <CapabilityRegistryFilters
        healthFilter={healthFilter}
        onHealthFilterChange={setHealthFilter}
        staleOnly={staleOnly}
        onStaleOnlyChange={setStaleOnly}
        uncertifiedOnly={uncertifiedOnly}
        onUncertifiedOnlyChange={setUncertifiedOnly}
      />

      {error ? (
        <div className="mb-4 rounded-lg border border-error/20 bg-error-subtle px-4 py-3 text-sm text-error">
          {error}
        </div>
      ) : null}

      {healthError ? (
        <div className="mb-4 rounded-lg border border-warning/20 bg-warning-subtle px-4 py-3 text-sm text-warning">
          {healthError}
        </div>
      ) : null}

      {loading ? (
        <div className="py-12 text-center text-sm text-tertiary">Loading…</div>
      ) : filteredCapabilities.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No capabilities match"
          description={
            search || riskFilter !== 'all'
              ? 'Try clearing filters or searching for a different term.'
              : 'Register callable capabilities with risk, approval, and health metadata. Workflows can then reference them by id or tag.'
          }
          action={
            !search && riskFilter === 'all' ? (
              <Link
                href="/capabilities/new"
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-4 py-2 text-sm font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
              >
                <Plus size={14} /> Register your first capability
              </Link>
            ) : null
          }
        />
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2">
            <SelectCheckbox
              checked={selection.allSelected}
              onToggle={() => selection.toggleAll()}
              label="Select all"
            />
            <span className="text-xs text-tertiary">Select all</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredCapabilities.map((capability) => (
              <div key={capability.capability_id} className="relative">
                <div className="absolute top-2 left-2 z-10">
                  <SelectCheckbox
                    checked={selection.isSelected(capability.capability_id)}
                    onToggle={(e) => { e.stopPropagation(); selection.selectClick(capability.capability_id, e.shiftKey); }}
                    label={`Select ${capability.name || capability.capability_id}`}
                  />
                </div>
                <CapabilityRegistryCard
                  capability={capability}
                  onRunTest={handleRunTest}
                  onDelete={handleDelete}
                  testStatus={testStatus[capability.capability_id]}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </PageLayout>
  );
}
