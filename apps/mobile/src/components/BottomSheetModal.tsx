/**
 * Reusable BottomSheetModal for mobile sheets (PersonalLibraryImportModal,
 * LibraryCatalogModal, OfflineEngineSheet).
 *
 * Guarantees reliable dismissal on Android (including API 36 edge-to-edge) & iOS:
 *   1. Unmounts completely when `visible={false}` (zero background renders/subscriptions).
 *   2. Tappable dimmed backdrop closes immediately.
 *   3. Interactive swipe-down gesture on the handle + header bar smoothly drags
 *      the sheet down and dismisses when pulled > 80px or flicked (vy > 0.45).
 *   4. Generous 44×44 Close button + Android hardware Back (`onRequestClose`).
 */

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, layout, spacing } from '@resonance/theme';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const DISMISS_DISTANCE = 80;
const DISMISS_VELOCITY = 0.45;

export interface BottomSheetModalProps {
  visible: boolean;
  onClose: () => void;
  /** Sheet height (e.g. '92%' or undefined for auto-height with maxHeight). */
  height?: DimensionValue;
  maxHeight?: DimensionValue;
  /** Header content placed inside the swipe-down drag zone (under the handle). */
  header?: ReactNode;
  /** Body content below the header (e.g. ScrollView, FlatList, pinned banners). */
  children: ReactNode;
  /** Optional footer pinned to the bottom of the sheet above system nav bar. */
  footer?: ReactNode;
  /** Whether to wrap overlay in KeyboardAvoidingView on iOS. Defaults to true. */
  avoidKeyboard?: boolean;
}

export function BottomSheetModal({
  visible,
  onClose,
  height = '92%',
  maxHeight,
  header,
  children,
  footer,
  avoidKeyboard = true,
}: BottomSheetModalProps): ReactNode {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Reset sheet position whenever it opens
  useEffect(() => {
    if (visible) {
      translateY.setValue(0);
    }
  }, [visible, translateY]);

  const animateDismiss = useCallback(() => {
    Animated.timing(translateY, {
      toValue: SCREEN_HEIGHT,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      onCloseRef.current();
    });
  }, [translateY]);

  const panResponder = useRef(
    PanResponder.create({
      // Never steal single taps from header buttons (Close X, Back arrow, Refresh)
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      // Only claim the gesture once the user clearly drags downward
      onMoveShouldSetPanResponder: (_evt, gestureState) =>
        gestureState.dy > 8 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.2,
      onMoveShouldSetPanResponderCapture: (_evt, gestureState) =>
        gestureState.dy > 14 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.3,
      onPanResponderMove: (_evt, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_evt, gestureState) => {
        if (
          gestureState.dy > DISMISS_DISTANCE ||
          gestureState.vy > DISMISS_VELOCITY
        ) {
          Animated.timing(translateY, {
            toValue: SCREEN_HEIGHT,
            duration: 170,
            useNativeDriver: true,
          }).start(() => {
            onCloseRef.current();
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 4,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 4,
        }).start();
      },
    })
  ).current;

  if (!visible) return null;

  const sheetContent = (
    <View style={styles.overlay}>
      <Pressable
        style={styles.backdrop}
        onPress={animateDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss sheet"
      />
      <Animated.View
        style={[
          styles.sheet,
          height !== undefined ? { height } : null,
          maxHeight !== undefined ? { maxHeight } : null,
          {
            paddingBottom: Math.max(insets.bottom, spacing.sm),
            transform: [{ translateY }],
          },
        ]}
      >
        {/* Dedicated swipe-down drag zone: handle pill + header bar */}
        <View {...panResponder.panHandlers} style={styles.dragZone}>
          <View style={styles.handleHitArea}>
            <View style={styles.handle} />
          </View>
          {header}
        </View>

        <View style={height !== undefined ? styles.body : styles.bodyAuto}>
          {children}
        </View>

        {footer}
      </Animated.View>
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="slide"
      onRequestClose={onClose}
    >
      {avoidKeyboard && Platform.OS === 'ios' ? (
        <KeyboardAvoidingView behavior="padding" style={styles.flexOne}>
          {sheetContent}
        </KeyboardAvoidingView>
      ) : (
        sheetContent
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  flexOne: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(58, 53, 48, 0.4)',
  },
  backdrop: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: layout.screenPaddingX,
    overflow: 'hidden',
  },
  dragZone: {
    paddingTop: spacing.xs,
  },
  handleHitArea: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  body: {
    flex: 1,
  },
  bodyAuto: {
    flexShrink: 1,
  },
});
