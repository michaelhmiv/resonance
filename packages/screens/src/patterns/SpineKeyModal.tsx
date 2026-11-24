/**
 * SpineKeyModal — quiet "?" popover explaining the bookbinding trace cues
 * used on the Study Bookshelf.
 */

import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

interface SpineKeyModalProps {
  visible: boolean;
  onClose: () => void;
}

export function SpineKeyModal({ visible, onClose }: SpineKeyModalProps): ReactNode {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>Reading the Bookshelf</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.closeText}>Done</Text>
            </Pressable>
          </View>

          <View style={styles.list}>
            <KeyRow
              clothBg="#f4efe5"
              clothBorder="#d6cbb8"
              title="Warm Linen — Unread"
              desc="Quietly resting on the shelf. Tap any unread book to bridge passages from your recent journal & highlights."
            />
            <KeyRow
              clothBg="#f4e2bc"
              clothBorder="#c49a4c"
              starColor="#8c6419"
              showStar
              title="Antique Gold + ✦ — Calling"
              desc="Unread in this timeframe, yet passages inside have been echoing near what you’ve written or noted."
            />
            <KeyRow
              clothBg="#a4b69c"
              clothBorder="#718769"
              showRibbon
              showNote
              title="Sage Cloth · Ribbon · Ink Dot"
              desc="Read or visited (sage cloth), highlighted (centered silk ribbon peeking at top), and noted (violet dot at the foot)."
            />
            <KeyRow
              clothBg="#7d6449"
              clothBorder="#523f2b"
              starColor="#f8e1a6"
              showStar
              showRibbon
              showNote
              lightLines
              title="Walnut Cloth + Foil ✦ — Deep Anchor"
              desc="Both visited and strongly echoing in this timeframe."
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function KeyRow({
  clothBg,
  clothBorder,
  starColor,
  showStar,
  showRibbon,
  showNote,
  lightLines,
  title,
  desc,
}: {
  clothBg: string;
  clothBorder: string;
  starColor?: string;
  showStar?: boolean;
  showRibbon?: boolean;
  showNote?: boolean;
  lightLines?: boolean;
  title: string;
  desc: string;
}): ReactNode {
  const lineColor = lightLines ? 'rgba(250, 244, 232, 0.28)' : 'rgba(58, 44, 28, 0.16)';
  return (
    <View style={styles.row}>
      <View style={styles.miniWrap}>
        {showRibbon ? <View style={styles.miniRibbon} /> : null}
        <View style={[styles.miniSpine, { backgroundColor: clothBg, borderColor: clothBorder }]}>
          <View style={[styles.miniHead, { borderBottomColor: lineColor }]}>
            {showStar ? <Text style={[styles.miniStar, { color: starColor }]}>✦</Text> : null}
          </View>
          <View style={styles.miniBody} />
          <View style={[styles.miniFoot, { borderTopColor: lineColor }]}>
            {showNote ? <View style={styles.miniNoteDot} /> : null}
          </View>
        </View>
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDesc}>{desc}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(58, 53, 48, 0.34)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#faf8f4',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dfd8cc',
    padding: 18,
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e8e2d8',
  },
  title: {
    fontFamily: 'Cormorant Garamond, Georgia, serif',
    fontSize: 20,
    fontWeight: '600',
    color: '#3a3530',
  },
  closeText: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 13,
    fontWeight: '500',
    color: '#8b7355',
  },
  list: {
    gap: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  miniWrap: {
    width: 28,
    paddingTop: 5,
    alignItems: 'center',
    position: 'relative',
  },
  miniRibbon: {
    position: 'absolute',
    top: 0,
    width: 6,
    height: 8,
    backgroundColor: '#c48342',
    borderTopLeftRadius: 1.5,
    borderTopRightRadius: 1.5,
  },
  miniSpine: {
    width: 24,
    height: 44,
    borderRadius: 3,
    borderWidth: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  miniHead: {
    width: '100%',
    height: 12,
    borderBottomWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniBody: {
    flex: 1,
  },
  miniFoot: {
    width: '100%',
    height: 11,
    borderTopWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniStar: {
    fontSize: 8,
    lineHeight: 9,
  },
  miniNoteDot: {
    width: 4.5,
    height: 4.5,
    borderRadius: 2.5,
    backgroundColor: '#6f629e',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 12.5,
    fontWeight: '600',
    color: '#3a3530',
  },
  rowDesc: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 11.5,
    lineHeight: 16.5,
    color: '#7a7368',
  },
});
