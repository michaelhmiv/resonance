/**
 * Login page — shared dev password gate for the web app.
 *
 * Cream/serif design matching the rest of the app. POSTs the password to
 * /api/auth; on success the server sets the httpOnly auth cookie and we
 * redirect to /.
 */

'use client';

import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, TextInput, View, Pressable } from 'react-native-web';

export default function LoginPage(): ReactNode {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        window.location.href = '/';
        return;
      }
      setError(data.error ?? 'Something went wrong. Please try again.');
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Resonance</Text>
        <Text style={styles.subtitle}>A private spiritual journal</Text>

        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor="#b8b0a4"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={handleSubmit}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable onPress={handleSubmit} disabled={loading} style={styles.button}>
          <Text style={styles.buttonText}>{loading ? 'Entering…' : 'Enter'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: '100vh',
    backgroundColor: '#faf9f6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    gap: 0,
  },
  title: {
    fontFamily: 'Georgia, serif',
    fontSize: 40,
    fontWeight: '600',
    color: '#3a3530',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: 'Georgia, serif',
    fontSize: 16,
    color: '#7a7368',
    fontStyle: 'italic',
    marginBottom: 32,
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#e8e5e0',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: 'Inter, sans-serif',
    fontSize: 16,
    color: '#3a3530',
    backgroundColor: '#ffffff',
    outlineWidth: 0,
  },
  error: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 13,
    color: '#a35858',
    marginTop: 12,
    textAlign: 'center',
  },
  button: {
    marginTop: 24,
    width: '100%',
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#8b7355',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 16,
    fontWeight: '600',
    color: '#faf9f6',
    letterSpacing: 0.4,
  },
});
