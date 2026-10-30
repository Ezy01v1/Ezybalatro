import type { ReactNode } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { formatNumber } from '@/game/format';
import { es } from '@/i18n/es';
import { colors, radii, spacing } from '@/theme/tokens';
import { Button, Text } from '@/ui/primitives';

const t = es.table;

function Dialog({
  testID,
  message,
  children,
}: {
  testID: string;
  message: string;
  children: ReactNode;
}) {
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.box} testID={testID} accessibilityViewIsModal>
          <Text variant="subtitle" center>
            {message}
          </Text>
          {children}
        </View>
      </View>
    </Modal>
  );
}

export type TableDialog =
  | { kind: 'closed' }
  | { kind: 'left'; chips: number }
  | { kind: 'replaced' }
  | { kind: 'leaveConfirm' };

/** End-of-table and confirmation dialogs. */
export function TableDialogs({
  dialog,
  onExit,
  onFindAnother,
  onConfirmLeave,
  onCancelLeave,
}: {
  dialog: TableDialog | null;
  onExit: () => void;
  onFindAnother: () => void;
  onConfirmLeave: () => void;
  onCancelLeave: () => void;
}) {
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'closed':
      return (
        <Dialog testID="dialog-closed" message={t.tableClosed}>
          <Button label={t.findAnother} onPress={onFindAnother} />
          <Button label={t.backToMenu} variant="secondary" onPress={onExit} />
        </Dialog>
      );
    case 'left':
      return (
        <Dialog testID="dialog-left" message={t.leftWith(formatNumber(dialog.chips))}>
          <Button label={t.backToMenu} onPress={onExit} />
        </Dialog>
      );
    case 'replaced':
      return (
        <Dialog testID="dialog-replaced" message={t.replaced}>
          <Button label={t.backToMenu} onPress={onExit} />
        </Dialog>
      );
    case 'leaveConfirm':
      return (
        <Dialog testID="dialog-leave" message={t.leaveConfirm}>
          <Button label={t.leave} onPress={onConfirmLeave} />
          <Button label={t.cancel} variant="secondary" onPress={onCancelLeave} />
        </Dialog>
      );
  }
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  box: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
});
