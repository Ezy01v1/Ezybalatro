import { useNetInfo } from '@react-native-community/netinfo';
import { NICKNAME_REGEX } from '@naipes/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { patchMe, useMe } from '@/api/me';
import { queryClient } from '@/api/queryClient';
import { deleteAccount } from '@/auth/account';
import { ChipIcon } from '@/components/menu/BalanceBadge';
import { formatNumber } from '@/game/format';
import { es } from '@/i18n/es';
import { colors, layout, radii, spacing, touchTarget, typography } from '@/theme/tokens';
import { Button, DecoRule, Screen, Text } from '@/ui/primitives';

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; text: string };
type DeleteState =
  { kind: 'idle' } | { kind: 'confirm' } | { kind: 'deleting' } | { kind: 'error'; text: string };

/** Maps a failed DELETE /v1/me to a message; a thrown TypeError is fetch failing to reach the server. */
function deleteErrorText(error: unknown): string {
  if (error instanceof TypeError) return es.profile.deleteOffline;
  if (error instanceof Error && error.message === 'ACCOUNT_BUSY') return es.profile.deleteBusy;
  return es.profile.deleteFailed;
}

export default function ProfileScreen() {
  const me = useMe();
  const online = useNetInfo().isConnected !== false;
  const [draft, setDraft] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [del, setDel] = useState<DeleteState>({ kind: 'idle' });

  const profile = me.data;
  const nickname = draft ?? profile?.nickname ?? '';
  const valid = NICKNAME_REGEX.test(nickname);
  const changed = !!profile && nickname !== profile.nickname;
  const deleting = del.kind === 'deleting';

  const onSave = async () => {
    if (!valid) return setSave({ kind: 'error', text: es.profile.nicknameInvalid });
    setSave({ kind: 'saving' });
    try {
      const updated = await patchMe({ nickname });
      queryClient.setQueryData(['me'], updated);
      setDraft(null);
      setSave({ kind: 'saved' });
    } catch (error) {
      const taken = error instanceof Error && error.message === 'NICKNAME_TAKEN';
      setSave({ kind: 'error', text: taken ? es.profile.nicknameTaken : es.profile.saveFailed });
    }
  };

  const onDelete = async () => {
    setDel({ kind: 'deleting' });
    try {
      await deleteAccount();
    } catch (error) {
      setDel({ kind: 'error', text: deleteErrorText(error) });
      return;
    }
    router.replace('/');
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text variant="display" accessibilityRole="header">
          {es.profile.title}
        </Text>
        <DecoRule />

        {!online ? (
          <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
            {es.profile.offline}
          </Text>
        ) : null}

        {!profile ? (
          <View style={styles.section}>
            <Text tone="muted" accessibilityLiveRegion="polite">
              {me.isError ? es.profile.loadFailed : '…'}
            </Text>
            {me.isError ? (
              <Button
                testID="profile-retry"
                variant="secondary"
                label={es.profile.retry}
                disabled={!online}
                onPress={() => void me.refetch()}
              />
            ) : null}
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <Text variant="bodyMedium" nativeID="nickname-label">
                {es.profile.nicknameLabel}
              </Text>
              <TextInput
                testID="nickname-input"
                accessibilityLabelledBy="nickname-label"
                accessibilityLabel={es.profile.nicknameLabel}
                value={nickname}
                onChangeText={(value) => {
                  setDraft(value);
                  setSave({ kind: 'idle' });
                }}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={20}
                editable={online && !deleting}
                returnKeyType="done"
                onSubmitEditing={() => changed && online && void onSave()}
                style={styles.input}
              />
              {save.kind === 'error' ? (
                <Text variant="caption" tone="danger" accessibilityLiveRegion="assertive">
                  {save.text}
                </Text>
              ) : save.kind === 'saved' ? (
                <Text variant="caption" tone="success" accessibilityLiveRegion="polite">
                  {es.profile.saved}
                </Text>
              ) : (
                <Text variant="caption" tone="muted">
                  {es.profile.nicknameHelp}
                </Text>
              )}
              <Button
                testID="nickname-save"
                label={save.kind === 'saving' ? es.profile.saving : es.profile.save}
                disabled={!changed || !online || save.kind === 'saving' || deleting}
                onPress={() => void onSave()}
              />
            </View>

            <View style={styles.section}>
              <Text variant="bodyMedium">{es.profile.balanceLabel}</Text>
              <View style={styles.balanceRow}>
                <ChipIcon size={20} />
                <Text variant="numeric" testID="profile-balance">
                  {formatNumber(profile.balance)}
                </Text>
              </View>
              <Text variant="caption" tone="muted">
                {es.profile.refill}
              </Text>
            </View>

            {profile.isGuest ? (
              <View style={styles.section}>
                <Text variant="bodyMedium">{es.profile.guestTitle}</Text>
                <Text variant="caption" tone="muted">
                  {es.profile.guestBody}
                </Text>
              </View>
            ) : null}

            <View style={[styles.section, styles.danger]}>
              <Text variant="bodyMedium" tone="danger">
                {es.profile.deleteTitle}
              </Text>
              {del.kind === 'idle' || del.kind === 'error' ? (
                <>
                  {del.kind === 'error' ? (
                    <Text variant="caption" tone="danger" accessibilityLiveRegion="assertive">
                      {del.text}
                    </Text>
                  ) : null}
                  <Button
                    testID="delete-account"
                    variant="ghost"
                    label={es.profile.deleteAction}
                    disabled={!online}
                    onPress={() => setDel({ kind: 'confirm' })}
                    style={styles.dangerButton}
                  />
                </>
              ) : (
                <>
                  <Text variant="caption" accessibilityLiveRegion="polite">
                    {es.profile.deleteWarning}
                  </Text>
                  <Button
                    testID="delete-confirm"
                    label={deleting ? es.profile.deleting : es.profile.deleteConfirm}
                    disabled={deleting}
                    onPress={() => void onDelete()}
                    style={styles.confirmButton}
                  />
                  <Button
                    testID="delete-cancel"
                    variant="secondary"
                    label={es.profile.deleteCancel}
                    disabled={deleting}
                    onPress={() => setDel({ kind: 'idle' })}
                  />
                </>
              )}
            </View>
          </>
        )}

        <Button
          testID="profile-back"
          variant="ghost"
          label={es.profile.back}
          disabled={deleting}
          onPress={() => router.back()}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: layout.gutter, gap: spacing.lg, paddingTop: spacing.xl },
  section: { gap: spacing.xs },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    ...typography.subtitle,
    color: colors.fg,
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  danger: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radii.md,
  },
  dangerButton: { borderColor: colors.danger },
  confirmButton: { backgroundColor: colors.danger },
});
