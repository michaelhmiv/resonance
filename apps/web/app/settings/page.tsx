/**
 * Settings page — thin web wrapper around the shared SettingsScreen.
 */

'use client';

import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { DataLayerProvider } from '@resonance/core/data-layer-context';
import { SettingsScreen } from '@resonance/screens';
import { WebDataLayer } from '../../lib/client-data-layer';

export default function SettingsPage(): ReactNode {
  const dataLayer = useMemo(() => new WebDataLayer(), []);
  const [storageSize, setStorageSize] = useState(0);

  useEffect(() => {
    fetch('/api/journal/entries').then(r => r.json()).then(d => {
      const bytes = (d.entries || []).reduce((sum: number, e: any) => sum + (e.text?.length || 0), 0);
      setStorageSize(bytes);
    }).catch(() => {});
  }, []);

  const handleSignOut = () => {
    document.cookie = 'resonance-auth=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    window.location.href = '/login';
  };

  const handleClearJournal = async () => {
    const entries = await fetch('/api/journal/entries').then(r => r.json());
    for (const entry of (entries.entries || [])) {
      await fetch(`/api/journal/entries/${entry.id}`, { method: 'DELETE' });
    }
    setStorageSize(0);
  };

  const handleExportJournal = async () => {
    const data = await fetch('/api/journal/entries').then(r => r.json());
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'resonance-journal-export.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DataLayerProvider layer={dataLayer}>
      <SettingsScreen
        storageSizeBytes={storageSize}
        onSignOut={handleSignOut}
        onBack={() => window.history.back()}
        onClearJournal={handleClearJournal}
        onExportJournal={handleExportJournal}
      />
    </DataLayerProvider>
  );
}
