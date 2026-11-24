/**
 * Patterns page — thin web wrapper around the shared PatternsScreen.
 */

'use client';

import { useCallback, useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { DataLayerProvider } from '@resonance/core/data-layer-context';
import { PatternsScreen } from '@resonance/screens';
import { WebDataLayer } from '../../../lib/client-data-layer';

export default function PatternsPage(): ReactNode {
  const dataLayer = useMemo(() => new WebDataLayer(), []);
  const router = useRouter();

  const handleNavigateToBook = useCallback((bookId: string, chapter?: number, verse?: number) => {
    let url = `/word?book=${encodeURIComponent(bookId)}`;
    if (chapter != null) url += `&chapter=${chapter}`;
    if (verse != null) url += `&verse=${verse}`;
    router.push(url);
  }, [router]);

  const handleNavigateToJournal = useCallback(() => {
    router.push('/journal');
  }, [router]);

  return (
    <DataLayerProvider layer={dataLayer}>
      <PatternsScreen
        onNavigateToBook={handleNavigateToBook}
        onNavigateToJournal={handleNavigateToJournal}
      />
    </DataLayerProvider>
  );
}
