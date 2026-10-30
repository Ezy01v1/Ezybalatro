import { StyleSheet, View } from 'react-native';
import { Sheet } from '@/components/shared/Sheet';
import { es } from '@/i18n/es';
import { spacing } from '@/theme/tokens';
import { Button } from '@/ui/primitives';

const t = es.table;

/** The ⋮ menu: leave the table, sit out / back to the table. */
export function TableMenu({
  visible,
  sittingOut,
  onLeave,
  onToggleSitOut,
  onClose,
}: {
  visible: boolean;
  sittingOut: boolean;
  onLeave: () => void;
  onToggleSitOut: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} title={t.menuTitle} onClose={onClose} testID="table-menu">
      <View style={styles.body}>
        <Button
          label={sittingOut ? t.sitIn : t.sitOut}
          variant="secondary"
          onPress={onToggleSitOut}
        />
        <Button label={t.leaveTable} onPress={onLeave} />
        <Button label={t.cancel} variant="ghost" onPress={onClose} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({ body: { gap: spacing.md } });
