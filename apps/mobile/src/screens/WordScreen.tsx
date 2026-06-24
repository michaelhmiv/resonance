import { useMemo, type ReactNode } from 'react';
import { useNavigation } from '@react-navigation/native';
import { DataLayerProvider } from '@resonance/core/data-layer-context';
import { WordScreen as SharedWordScreen } from '@resonance/screens';
import { MobileDataLayer } from '../data/mobileDataLayer';

export function WordScreen(): ReactNode {
  const navigation = useNavigation();
  const dataLayer = useMemo(() => new MobileDataLayer(), []);

  return (
    <DataLayerProvider layer={dataLayer}>
      <SharedWordScreen onOpenSettings={() => navigation.navigate('Settings' as never)} />
    </DataLayerProvider>
  );
}
