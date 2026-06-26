/**
 * SendToJournalButton — a quiet action that quotes a passage into the journal.
 *
 * Renders as a subtle text button. On press, calls the DataLayer to append
 * the quoted passage. Shows a brief confirmation ("Sent to Journal") then
 * returns to idle.
 */

import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { colors, fontFamilies } from '@resonance/theme';
import { useDataLayer } from '@resonance/core/data-layer-context';

interface SendToJournalButtonProps {
  quote: string;
  source: string;
}

export function SendToJournalButton({ quote, source }: SendToJournalButtonProps): ReactNode {
  const dataLayer = useDataLayer();
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');

  const handlePress = useCallback(async () => {
    if (status !== 'idle') return;
    setStatus('sending');
    try {
      await dataLayer.appendQuoteToJournal(quote, source);
      setStatus('sent');
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('idle');
    }
  }, [quote, source, status, dataLayer]);

  const label =
    status === 'sending' ? 'Sending…' :
    status === 'sent' ? 'Sent to Journal ✓' :
    'Send to Journal';

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={8}
      disabled={status !== 'idle'}
      accessibilityRole="button"
      accessibilityLabel="Send quote to journal"
    >
      <Text style={[styles.text, status === 'sent' && styles.sent]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  text: {
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    color: colors.accentMuted,
    letterSpacing: 0.2,
  },
  sent: {
    color: '#6b9e6b',
  },
});
