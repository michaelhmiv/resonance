/**
 * Journal page — thin web wrapper around the shared JournalScreen.
 */

'use client';

import { useMemo, useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { DataLayerProvider } from '@resonance/core/data-layer-context';
import { JournalScreen } from '@resonance/screens';
import { WebDataLayer } from '../../lib/client-data-layer';

export default function JournalPage(): ReactNode {
  const dataLayer = useMemo(() => new WebDataLayer(), []);
  const router = useRouter();

  const fetchVerseOfDay = async () => {
    try {
      const r = await fetch('/api/bible/verse-of-day');
      return await r.json();
    } catch { return null; }
  };

  const handleNavigateToBook = useCallback((bookId: string, chapter?: number, verse?: number) => {
    // bookId is e.g. "web_Matthew" for scripture or "voice_100000" for library
    let url = `/word?book=${encodeURIComponent(bookId)}`;
    if (chapter != null) url += `&chapter=${chapter}`;
    if (verse != null) url += `&verse=${verse}`;
    router.push(url);
  }, [router]);

  return (
    <DataLayerProvider layer={dataLayer}>
      <JournalScreen
        fetchVerseOfDay={fetchVerseOfDay}
        onNavigateToBook={handleNavigateToBook}
      />
    </DataLayerProvider>
  );
}
