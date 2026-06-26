'use client';

import { useEffect, useState } from 'react';
import { View, Text } from 'react-native-web';

/**
 * /api/vectors/status returns a FLAT shape describing the single online
 * vector index (per the route's contract). Banner is purely informational
 * and is rendered from the root layout — it must never throw on hydration,
 * so we defensively normalise whatever the server sent.
 */
interface VectorStatus {
  model?: string;
  dim?: number;
  loaded?: boolean;
  passage_count?: number;
  passage_metadata_loaded?: boolean;
  books?: number;
  mtime?: string | null;
  vectors_path?: string;
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

  if (dismissed) return null;
  if (!status) return null;
  // Single-model system: when the index is loaded, there is nothing to warn about.
  if (status.loaded === true) return null;

  const modelLabel = status.model ?? 'the vector index';
  const passageCount = status.passage_count ?? 0;

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
        ⚠️ Vector data missing for {modelLabel}. Semantic search limited to lexical fallback.
        {passageCount > 0 && <> ({passageCount.toLocaleString()} passages)</>}
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
