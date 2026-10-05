import type { JokerInstance } from '@naipes/engine';
import { es, JOKER_TEXTS } from '@/i18n/es';
import { Button, Text } from '@/ui/primitives';
import { Sheet } from './Sheet';

export function JokerDetailSheet({
  joker,
  onClose,
  action,
}: {
  joker: JokerInstance | null;
  onClose: () => void;
  /** Extra action (e.g. sell in the shop). */
  action?: { label: string; onPress: () => void; testID?: string };
}) {
  const text = joker
    ? (JOKER_TEXTS[joker.jokerId] ?? { name: joker.jokerId, description: '' })
    : null;
  return (
    <Sheet visible={!!joker} title={text?.name ?? ''} onClose={onClose} testID="joker-detail">
      <Text variant="body" center>
        {text?.description}
      </Text>
      {action ? (
        <Button
          testID={action.testID}
          variant="secondary"
          label={action.label}
          onPress={action.onPress}
        />
      ) : null}
      <Button variant="ghost" label={es.game.close} onPress={onClose} />
    </Sheet>
  );
}
