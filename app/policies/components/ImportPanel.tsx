'use client';

import { useEffect, useState, useCallback } from 'react';
import PolicyAdvancedImportPanel from './PolicyAdvancedImportPanel';
import { PACK_PREVIEWS } from '../../lib/policyPackPreviews';

interface ImportPanelProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

// Standalone import modal for the redesigned /policies Ledger. Owns the import
// state + endpoints lifted from CustomTab and delegates all rendering (pack
// picker + raw YAML, preview/result, Escape/backdrop close) to the existing
// PolicyAdvancedImportPanel modal so the two import surfaces stay identical.
export default function ImportPanel({ open, onClose, onImported }: ImportPanelProps) {
  const [importMode, setImportMode] = useState('pack');
  const [importPack, setImportPack] = useState('enterprise-strict');
  const [importYaml, setImportYaml] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [previewing, setPreviewing] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);

  // Load the pack catalog when the panel opens; fall back to static previews.
  useEffect(() => {
    if (!open) return;
    fetch('/api/policies/templates')
      .then(r => (r.ok ? r.json() : { templates: [] }))
      .then(d => setTemplates(d.templates || []))
      .catch(() => { /* static PACK_PREVIEWS fallback */ });
  }, [open]);

  // Opening the panel clears any stale preview/result from a prior run.
  useEffect(() => {
    if (open) { setImportPreview(null); setImportResult(null); }
  }, [open]);

  // Changing the pack, mode, or YAML invalidates any preview so the operator
  // always confirms against the exact policies they are about to import.
  const selectImportPack = (pack: string) => { setImportPack(pack); setImportPreview(null); setImportResult(null); };
  const selectImportMode = (mode: string) => { setImportMode(mode); setImportPreview(null); setImportResult(null); };
  const selectImportYaml = (yaml: string) => { setImportYaml(yaml); setImportPreview(null); };

  const importBody = useCallback(
    () => (importMode === 'pack' ? { pack: importPack } : { yaml: importYaml }),
    [importMode, importPack, importYaml],
  );

  // Preview-before-import: the conflict-aware dry run shows what would be
  // created and which names conflict before anything is written.
  const handlePreview = async () => {
    setPreviewing(true);
    setImportPreview(null);
    setImportResult(null);
    try {
      const res = await fetch('/api/policies/import?preview=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importBody()),
      });
      const json = await res.json().catch(() => ({}));
      setImportPreview(res.ok ? json : { error: json.error || 'Preview failed' });
    } catch {
      setImportPreview({ error: 'Preview failed' });
    } finally {
      setPreviewing(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch('/api/policies/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importBody()),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setImportPreview(null);
        onImported();
        onClose();
      } else {
        setImportResult({ error: json.error || 'Import failed' });
      }
    } catch {
      setImportResult({ error: 'Import failed' });
    } finally {
      setImporting(false);
    }
  };

  return (
    <PolicyAdvancedImportPanel
      open={open}
      onClose={onClose}
      importMode={importMode}
      setImportMode={selectImportMode}
      importPack={importPack}
      setImportPack={selectImportPack}
      importYaml={importYaml}
      setImportYaml={selectImportYaml}
      importing={importing}
      importResult={importResult}
      importPreview={importPreview}
      previewing={previewing}
      handlePreview={handlePreview}
      handleImport={handleImport}
      packPreviews={PACK_PREVIEWS}
      templates={templates}
    />
  );
}
