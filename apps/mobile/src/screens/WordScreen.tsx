import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { LibraryBook, PersonalWorkMetadata } from '@resonance/core';
import { DataLayerProvider } from '@resonance/core/data-layer-context';
import { WordScreen as SharedWordScreen } from '@resonance/screens';
import { MobileDataLayer } from '../data/mobileDataLayer';
import { getPersonalWork } from '../db/queries/libraryQueries';
import { usePersonalLibraryStore } from '../personal/personalLibraryService';
import { useOfflineEngineStore } from '../packages/offlineEngineManager';
import { PersonalLibraryImportModal } from '../components/PersonalLibraryImportModal';
import { LibraryCatalogModal } from '../components/LibraryCatalogModal';

export function WordScreen(): ReactNode {
  const navigation = useNavigation();
  const dataLayer = useMemo(() => new MobileDataLayer(), []);
  const personalRevision = usePersonalLibraryStore((s) => s.libraryRevision);
  const catalogRevision = useOfflineEngineStore((s) => s.catalogRevision);

  const [catalogVisible, setCatalogVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [editingWork, setEditingWork] = useState<PersonalWorkMetadata | null>(null);

  const handleOpenCatalog = useCallback(() => {
    setCatalogVisible(true);
  }, []);

  const handleOpenImport = useCallback(() => {
    setEditingWork(null);
    setImportModalVisible(true);
  }, []);

  const handleEditBookMetadata = useCallback((book: LibraryBook) => {
    void getPersonalWork(book.id).then((meta) => {
      if (meta) {
        setEditingWork(meta);
        setImportModalVisible(true);
      }
    });
  }, []);

  const handleCloseModal = useCallback(() => {
    setImportModalVisible(false);
    setEditingWork(null);
  }, []);

  return (
    <DataLayerProvider layer={dataLayer}>
      <SharedWordScreen
        onOpenSettings={() => navigation.navigate('Settings' as never)}
        onOpenCatalog={handleOpenCatalog}
        onOpenImport={handleOpenImport}
        onEditBookMetadata={handleEditBookMetadata}
        libraryRevision={personalRevision + catalogRevision}
      />
      <LibraryCatalogModal
        visible={catalogVisible}
        onClose={() => setCatalogVisible(false)}
      />
      <PersonalLibraryImportModal
        visible={importModalVisible}
        editingWork={editingWork}
        onClose={handleCloseModal}
      />
    </DataLayerProvider>
  );
}
