import { createContext, useContext, createElement, type ReactNode } from 'react';
import type { DataLayer } from './data-layer';

const DataLayerContext = createContext<DataLayer | null>(null);

export function DataLayerProvider({
  layer,
  children,
}: {
  layer: DataLayer;
  children: ReactNode;
}): ReactNode {
  return createElement(DataLayerContext.Provider, { value: layer }, children);
}

export function useDataLayer(): DataLayer {
  const layer = useContext(DataLayerContext);
  if (!layer) {
    throw new Error('useDataLayer must be used within a DataLayerProvider');
  }
  return layer;
}
