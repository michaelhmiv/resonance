/**
 * Bookmark button — lives in the reading-view header. Toggles whether the
 * current passage/chapter is marked for return. Shows filled styling when the
 * reference is already bookmarked.
 *
 * (design spec §6.3: bookmark — mark passage/chapter for return)
 */

import { type ReactNode } from 'react';
import { Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { colors } from '@resonance/theme';

interface BookmarkButtonProps {
  bookmarked: boolean;
  onPress: () => void;
  tint?: string;
}

export function BookmarkButton({
  bookmarked,
  onPress,
  tint = colors.textSecondary,
}: BookmarkButtonProps): ReactNode {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={bookmarked ? 'Remove bookmark' : 'Add bookmark'}
      accessibilityState={{ checked: bookmarked }}
    >
      <Feather
        name={bookmarked ? 'bookmark' : 'bookmark'}
        size={20}
        color={bookmarked ? colors.accent : tint}
        // Feather has no filled glyph; the accent color marks the saved state.
      />
    </Pressable>
  );
}
