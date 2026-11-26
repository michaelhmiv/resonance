/**
 * Root navigator — bottom-tab navigation with Journal, Word, Patterns,
 * plus a stack for the Settings screen.
 *
 * (design spec §4.1: three tabs + settings icon in header, never a fourth tab)
 */

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import type { ReactNode } from 'react';

import { colors, fontFamilies } from '@resonance/theme';
import { JournalScreen } from '../screens/JournalScreen';
import { WordScreen } from '../screens/WordScreen';
import { PatternsScreen } from '../screens/PatternsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

export type TabParamList = {
  Journal: undefined;
  Word: { bookId?: string; chapter?: number; verse?: number } | undefined;
  Patterns: undefined;
};

export type RootStackParamList = {
  Tabs: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

function TabIcon({ name, color }: { name: string; color: string }) {
  return <Feather name={name as never} size={22} color={color} />;
}

function Tabs(): ReactNode {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: true,
        headerTitle: 'Resonance',
        headerTitleStyle: {
          fontFamily: fontFamilies.serifSemibold,
          fontSize: 22,
          letterSpacing: 0.4,
        },
        headerStyle: {
          backgroundColor: colors.background,
        },
        headerTintColor: colors.textPrimary,

        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: {
          fontFamily: fontFamilies.sansMedium,
          fontSize: 13,
          letterSpacing: 0.4,
        },
      }}
    >
      <Tab.Screen
        name="Journal"
        component={JournalScreen}
        options={{
          tabBarIcon: ({ color }) => <TabIcon name="edit-2" color={color} />,
          headerRight: SettingsButton,
        }}
      />
      <Tab.Screen
        name="Word"
        component={WordScreen}
        options={{
          tabBarIcon: ({ color }) => <TabIcon name="book-open" color={color} />,
          headerRight: SettingsButton,
        }}
      />
      <Tab.Screen
        name="Patterns"
        component={PatternsScreen}
        options={{
          tabBarIcon: ({ color }) => <TabIcon name="bar-chart-2" color={color} />,
          headerRight: SettingsButton,
        }}
      />
    </Tab.Navigator>
  );
}

function SettingsButton() {
  return null; // Will be wired in App.tsx once navigation ref is available
}

/**
 * Helper to render the settings gear.  Each tab's `headerRight` passes a
 * `navigation` prop via the options callback — but since we're defining
 * screens statically, we use a shared component that reads the global nav.
 */
import { Pressable } from 'react-native';

function SettingsGear({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={12} style={{ marginRight: 16 }}>
      <Feather name="settings" size={20} color={colors.textSecondary} />
    </Pressable>
  );
}

export { SettingsGear };

import { OfflineEngineSheet } from '../components/OfflineEngineSheet';

export function RootNavigator(): ReactNode {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: {
            fontFamily: fontFamilies.serifSemibold,
            fontSize: 20,
          },
        }}
      >
        <Stack.Screen
          name="Tabs"
          component={Tabs}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: 'Settings' }}
        />
      </Stack.Navigator>
      <OfflineEngineSheet />
    </NavigationContainer>
  );
}
