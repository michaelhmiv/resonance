/**
 * ThreadsLens — surfaces hidden cross-day connections:
 *   1. Quiet "Recently" summary
 *   2. Hero "✦ What Kept Finding You" (passages & voices circling your life,
 *      with "not opened yet" cue, expandable evidence, Open in Word jump,
 *      and Keep / Not quite feedback)
 *   3. "Trails Across Days" multi-hop timelines
 *   4. "A Quiet Question" with inline Journal reply
 */

import { useState, useCallback, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  parseVerseRefParts,
  type FindingYouSignal,
  type PatternFeedbackInput,
  type PatternTrail,
  type PatternsSummary,
} from '@resonance/core';

interface ThreadsLensProps {
  summary: PatternsSummary | null;
  error: string | null;
  reflection: string | null;
  reflecting: boolean;
  onReflect: () => void;
  onSaveQuietReply: (text: string) => Promise<boolean>;
  onFeedback: (input: PatternFeedbackInput) => Promise<void>;
  onNavigateToBook?: (bookId: string, chapter?: number, verse?: number) => void;
}

const STEP_COLORS: Record<string, string> = {
  journal: '#8b7355',
  reading: '#6b9e6b',
  highlight: '#c9a25a',
  note: '#7d79a8',
  bookmark: '#b86f52',
  echo: '#c9a25a',
  voice: '#6f8fb8',
};

export function ThreadsLens({
  summary,
  error,
  reflection,
  reflecting,
  onReflect,
  onSaveQuietReply,
  onFeedback,
  onNavigateToBook,
}: ThreadsLensProps): ReactNode {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [keptIds, setKeptIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const findingYou = (summary?.findingYou ?? []).filter((f) => !dismissedIds.has(f.id));
  const trails = summary?.trails ?? [];
  const themes = summary?.themes ?? [];

  const toggleExpand = useCallback(
    (item: FindingYouSignal) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) {
          next.delete(item.id);
        } else {
          next.add(item.id);
          void onFeedback({
            action: 'opened',
            surface: 'echo',
            itemId: item.id,
            edgeId: item.edgeIds[0],
            metadata: { ref: item.ref },
          });
        }
        return next;
      });
    },
    [onFeedback],
  );

  const handleKeep = useCallback(
    (item: FindingYouSignal) => {
      setKeptIds((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
      void onFeedback({
        action: 'saved',
        surface: 'echo',
        itemId: item.id,
        edgeId: item.edgeIds[0],
        metadata: { ref: item.ref },
      });
    },
    [onFeedback],
  );

  const handleDismiss = useCallback(
    (item: FindingYouSignal) => {
      setDismissedIds((prev) => new Set(prev).add(item.id));
      void onFeedback({
        action: 'dismissed',
        surface: 'echo',
        itemId: item.id,
        edgeId: item.edgeIds[0],
        metadata: { ref: item.ref },
      });
    },
    [onFeedback],
  );

  const handleOpenPassage = useCallback(
    (ref: string, bookId?: string | null, bookName?: string) => {
      if (!onNavigateToBook) return;
      const parsed = parseVerseRefParts(ref);
      const targetBookId =
        bookId ||
        (parsed.book ? `web_${parsed.book.replace(/\s+/g, '_')}` : bookName ? `web_${bookName.replace(/\s+/g, '_')}` : '');
      if (!targetBookId) return;
      onNavigateToBook(targetBookId, parsed.chapter ?? undefined, parsed.verse ?? undefined);
    },
    [onNavigateToBook],
  );

  return (
    <View style={styles.root}>
      {/* Recently */}
      <View style={styles.card}>
        <Text style={styles.recentlyText}>
          {summary?.recently ?? 'Patterns need a few traces: journal entries, readings, highlights, or notes.'}
        </Text>
        {error ? <Text style={styles.hint}>Using local data — some patterns may be limited.</Text> : null}
      </View>

      {/* Hero: What Kept Finding You */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>What Kept Finding You</Text>
          <Text style={styles.sectionSub}>✦ semantic echoes</Text>
        </View>

        {findingYou.length > 0 ? (
          findingYou.map((item) => {
            const expanded = expandedIds.has(item.id);
            const kept = keptIds.has(item.id);
            return (
              <View key={item.id} style={styles.card}>
                <View style={styles.fyHeader}>
                  <View style={styles.fyTitleWrap}>
                    <View style={styles.fyTitleRow}>
                      <View
                        style={[
                          styles.kindDot,
                          { backgroundColor: item.kind === 'scripture' ? '#c9a25a' : '#6f8fb8' },
                        ]}
                      />
                      <Text style={styles.fyRef}>{item.ref}</Text>
                      {item.neverRead ? (
                        <View style={styles.unreadPill}>
                          <Text style={styles.unreadPillText}>not opened yet</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.fySpan}>{item.span}</Text>
                  </View>
                  <Pressable onPress={() => toggleExpand(item)} style={styles.evidenceBtn}>
                    <Text style={styles.evidenceBtnText}>{expanded ? 'Hide' : 'Evidence'}</Text>
                  </Pressable>
                </View>

                {item.excerpt ? (
                  <Text style={styles.fyExcerpt} numberOfLines={expanded ? undefined : 3}>
                    “{item.excerpt}”
                  </Text>
                ) : null}

                {expanded ? (
                  <View style={styles.evidencePanel}>
                    <Text style={styles.evidenceHeading}>Where this surfaced</Text>
                    {item.traces.map((trace) => (
                      <View key={trace.id} style={styles.traceRow}>
                        {trace.date ? <Text style={styles.traceDate}>{trace.date}</Text> : null}
                        <Text style={styles.traceText} numberOfLines={3}>
                          {trace.excerpt}
                        </Text>
                      </View>
                    ))}
                    <View style={styles.actionRow}>
                      {onNavigateToBook ? (
                        <Pressable
                          onPress={() => handleOpenPassage(item.ref, item.bookId, item.bookName)}
                          hitSlop={8}
                        >
                          <Text style={styles.openLink}>Open in Word →</Text>
                        </Pressable>
                      ) : (
                        <View />
                      )}
                      <View style={styles.feedbackRow}>
                        <Pressable
                          onPress={() => handleKeep(item)}
                          style={[styles.feedbackBtn, kept && styles.feedbackBtnKept]}
                        >
                          <Text style={[styles.feedbackBtnText, kept && styles.feedbackBtnTextKept]}>
                            {kept ? 'Kept ✓' : 'Keep'}
                          </Text>
                        </Pressable>
                        <Pressable onPress={() => handleDismiss(item)} style={styles.feedbackBtn}>
                          <Text style={styles.dismissText}>Not quite</Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })
        ) : (
          <View style={styles.card}>
            <Text style={styles.emptyItalic}>
              As you write journal entries and add notes, passages from Scripture and your library that keep sitting near your words will surface here.
            </Text>
          </View>
        )}
      </View>

      {/* Trails Across Days */}
      {trails.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Trails Across Days</Text>
          {trails.map((trail) => (
            <TrailCard key={trail.id} trail={trail} onOpenPassage={handleOpenPassage} />
          ))}
        </View>
      ) : null}

      {/* Recurring Threads (compact pills when themes exist without dominating) */}
      {themes.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Recurring Threads</Text>
          <View style={styles.card}>
            <View style={styles.themeRow}>
              {themes.map((t) => (
                <View key={t.id} style={styles.themePill}>
                  <Text style={styles.themePillText}>{t.label}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      ) : null}

      {/* Quiet Question with inline Journal reply */}
      <QuietQuestionCard
        promptText={reflection ?? summary?.quietQuestion ?? 'What are you noticing these days?'}
        reflecting={reflecting}
        onRefreshPrompt={onReflect}
        onSaveReply={onSaveQuietReply}
      />
    </View>
  );
}

function TrailCard({
  trail,
  onOpenPassage,
}: {
  trail: PatternTrail;
  onOpenPassage: (ref: string, bookId?: string | null) => void;
}): ReactNode {
  const steps = trail.steps ?? [];
  return (
    <View style={styles.card}>
      <View style={styles.trailHeader}>
        <Text style={styles.trailTitle}>{trail.label}</Text>
        <Text style={styles.fySpan}>{trail.span ?? trail.summary}</Text>
      </View>
      {steps.length > 0 ? (
        <View style={styles.stepsList}>
          {steps.map((step, idx) => (
            <View key={`${trail.id}-${idx}`} style={styles.stepRow}>
              <View style={styles.stepRail}>
                <View
                  style={[
                    styles.stepDot,
                    { backgroundColor: STEP_COLORS[step.type] ?? '#8b7355' },
                  ]}
                />
                {idx < steps.length - 1 ? <View style={styles.stepConnector} /> : null}
              </View>
              <Pressable
                style={styles.stepContent}
                disabled={step.type === 'journal'}
                onPress={() => onOpenPassage(step.ref, step.bookId)}
              >
                <Text style={styles.stepMeta}>
                  {step.date} · {step.ref}
                </Text>
                <Text style={styles.stepText} numberOfLines={3}>
                  {step.text}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.hint}>{trail.summary}</Text>
      )}
    </View>
  );
}

export function QuietQuestionCard({
  promptText,
  reflecting,
  onRefreshPrompt,
  onSaveReply,
}: {
  promptText: string;
  reflecting: boolean;
  onRefreshPrompt: () => void;
  onSaveReply: (text: string) => Promise<boolean>;
}): ReactNode {
  const [replyOpen, setReplyOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedExcerpt, setSavedExcerpt] = useState<string | null>(null);

  const handleSave = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const ok = await onSaveReply(trimmed);
      if (ok) {
        setSavedExcerpt(trimmed);
        setDraft('');
        setReplyOpen(false);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>A Quiet Question</Text>
        <Pressable onPress={onRefreshPrompt} disabled={reflecting} hitSlop={8}>
          {reflecting ? (
            <ActivityIndicator size="small" color="#8b7355" />
          ) : (
            <Text style={styles.sectionSub}>Reflect</Text>
          )}
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text style={styles.questionText}>{promptText}</Text>

        {savedExcerpt ? (
          <View style={styles.savedBox}>
            <Text style={styles.savedLabel}>Saved to Journal</Text>
            <Text style={styles.savedText}>“{savedExcerpt}”</Text>
          </View>
        ) : replyOpen ? (
          <View style={styles.replyWrap}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              multiline
              placeholder="Write a few lines… saved directly to your Journal"
              placeholderTextColor="#b8b0a4"
              style={styles.replyInput}
            />
            <View style={styles.replyActions}>
              <Pressable onPress={() => setReplyOpen(false)} hitSlop={8}>
                <Text style={styles.dismissText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSave}
                disabled={saving || draft.trim().length === 0}
                style={[styles.saveBtn, (saving || draft.trim().length === 0) && styles.saveBtnDisabled]}
              >
                <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save to Journal'}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable onPress={() => setReplyOpen(true)} hitSlop={6}>
            <Text style={styles.openLink}>Write a response in Journal →</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 16,
  },
  section: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  sectionLabel: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: '#9a9388',
  },
  sectionSub: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 11,
    color: '#8b7355',
  },
  card: {
    borderWidth: 1,
    borderColor: '#e8e5e0',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 15,
    gap: 10,
  },
  recentlyText: {
    fontFamily: 'Cormorant Garamond, Georgia, serif',
    fontSize: 16.5,
    lineHeight: 24,
    color: '#3a3530',
  },
  hint: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 11.5,
    color: '#9a9388',
    lineHeight: 17,
  },
  emptyItalic: {
    fontFamily: 'Cormorant Garamond, Georgia, serif',
    fontStyle: 'italic',
    fontSize: 15,
    lineHeight: 22,
    color: '#7a7368',
  },
  fyHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  fyTitleWrap: {
    flex: 1,
    gap: 2,
  },
  fyTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  kindDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  fyRef: {
    fontFamily: 'Cormorant Garamond, Georgia, serif',
    fontSize: 17.5,
    fontWeight: '600',
    color: '#3a3530',
  },
  unreadPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#fbf5e9',
    borderWidth: 1,
    borderColor: '#ead9b7',
  },
  unreadPillText: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 10,
    color: '#8b7355',
  },
  fySpan: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 11,
    color: '#9a9388',
  },
  evidenceBtn: {
    borderWidth: 1,
    borderColor: '#e8e5e0',
    backgroundColor: '#faf9f6',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  evidenceBtnText: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 11,
    fontWeight: '500',
    color: '#8b7355',
  },
  fyExcerpt: {
    fontFamily: 'Cormorant Garamond, Georgia, serif',
    fontStyle: 'italic',
    fontSize: 15,
    lineHeight: 22,
    color: '#5c554c',
  },
  evidencePanel: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f0eee9',
    gap: 8,
  },
  evidenceHeading: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#9a9388',
  },
  traceRow: {
    paddingLeft: 10,
    borderLeftWidth: 1.5,
    borderLeftColor: '#c9a25a',
    gap: 2,
  },
  traceDate: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 10,
    color: '#9a9388',
  },
  traceText: {
    fontFamily: 'Cormorant Garamond, Georgia, serif',
    fontSize: 14.5,
    lineHeight: 20,
    color: '#3a3530',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
    gap: 8,
  },
  openLink: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 11.5,
    fontWeight: '600',
    color: '#8b7355',
  },
  feedbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  feedbackBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e8e5e0',
    backgroundColor: '#ffffff',
  },
  feedbackBtnKept: {
    borderColor: '#8b7355',
    backgroundColor: '#8b7355',
  },
  feedbackBtnText: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 11,
    color: '#7a7368',
  },
  feedbackBtnTextKept: {
    color: '#faf9f6',
    fontWeight: '500',
  },
  dismissText: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 11,
    color: '#9a9388',
  },
  trailHeader: {
    gap: 2,
  },
  trailTitle: {
    fontFamily: 'Cormorant Garamond, Georgia, serif',
    fontSize: 17.5,
    fontWeight: '600',
    color: '#3a3530',
  },
  stepsList: {
    gap: 2,
    paddingLeft: 2,
  },
  stepRow: {
    flexDirection: 'row',
    gap: 10,
  },
  stepRail: {
    alignItems: 'center',
    width: 10,
  },
  stepDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginTop: 5,
  },
  stepConnector: {
    flex: 1,
    width: 1,
    backgroundColor: '#e8e5e0',
    marginVertical: 3,
  },
  stepContent: {
    flex: 1,
    paddingBottom: 10,
    gap: 2,
  },
  stepMeta: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: '#9a9388',
  },
  stepText: {
    fontFamily: 'Cormorant Garamond, Georgia, serif',
    fontSize: 15,
    lineHeight: 21,
    color: '#3a3530',
  },
  themeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  themePill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e8e5e0',
    backgroundColor: '#faf9f6',
  },
  themePillText: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 12,
    color: '#3a3530',
  },
  questionText: {
    fontFamily: 'Cormorant Garamond, Georgia, serif',
    fontStyle: 'italic',
    fontSize: 17,
    lineHeight: 25,
    color: '#3a3530',
  },
  savedBox: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#faf9f6',
    borderWidth: 1,
    borderColor: '#e8e5e0',
    gap: 2,
  },
  savedLabel: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    color: '#8b7355',
  },
  savedText: {
    fontFamily: 'Cormorant Garamond, Georgia, serif',
    fontSize: 15,
    color: '#3a3530',
  },
  replyWrap: {
    gap: 8,
  },
  replyInput: {
    minHeight: 68,
    borderWidth: 1,
    borderColor: '#e8e5e0',
    borderRadius: 8,
    backgroundColor: '#faf9f6',
    padding: 10,
    fontFamily: 'Cormorant Garamond, Georgia, serif',
    fontSize: 15.5,
    color: '#3a3530',
    textAlignVertical: 'top',
  },
  replyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
  },
  saveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#8b7355',
  },
  saveBtnDisabled: {
    opacity: 0.45,
  },
  saveBtnText: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 11.5,
    fontWeight: '500',
    color: '#faf9f6',
  },
});
