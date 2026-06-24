'use client';

import { useEffect, useState } from 'react';
import { View, Text } from 'react-native-web';

interface VectorStatus {
  models: { name: string; dim: number; passages: number; loaded: boolean }[];
  all_models_loaded: boolean;
  total_passages: number;
}

export function VectorStatusBanner(): React.ReactElement | null {
  const [status, setStatus] = useState<VectorStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch('/api/vectors/status')
      .then((r) => r.json())
      .then((data: VectorStatus) => setStatus(data))
      .catch(() => {});
  }, []);

  if (!status || status.all_models_loaded || dismissed) return null;

  const missing = status.models.filter((m) => !m.loaded);
  if (missing.length === 0) return null;

  return (
    <View
      style={{
        backgroundColor: '#fff3cd',
        borderBottomWidth: 1,
        borderBottomColor: '#e6d5a8',
        paddingVertical: 10,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <Text style={{ color: '#856404', fontSize: 14, fontFamily: 'Inter, sans-serif', flex: 1 }}>
        ⚠️ Vector data missing for:{' '}
        {missing.map((m) => m.name).join(', ')}. Semantic search limited to lexical fallback.
        {status.total_passages > 0 && <> ({status.total_passages.toLocaleString()} passages)</>}
      </Text>
      <Text
        style={{ color: '#856404', fontSize: 14, cursor: 'pointer', marginLeft: 12, textDecorationLine: 'underline' }}
        onPress={() => setDismissed(true)}
      >
        Dismiss
      </Text>
    </View>
  );
}
