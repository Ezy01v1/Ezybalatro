import { fireEvent, render, screen } from '@testing-library/react-native';
import { BetSelector, type BetRange } from '@/components/table/BetSelector';

const quick = [
  { key: 'min' as const, amount: 120, valid: true },
  { key: 'half' as const, amount: 50, valid: false },
  { key: 'pot' as const, amount: 300, valid: true },
  { key: 'all' as const, amount: 1000, valid: true },
];

async function setup(range: BetRange = { type: 'raise', min: 120, max: 1000 }) {
  const onConfirm = jest.fn();
  await render(
    <BetSelector
      range={range}
      quick={quick}
      step={20}
      disabled={false}
      onConfirm={onConfirm}
      onCancel={jest.fn()}
    />,
  );
  return onConfirm;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('BetSelector', () => {
  it('confirms "Subir a 120" with the min, +/- step by the big blind and clamp', async () => {
    const onConfirm = await setup();
    await fireEvent.press(screen.getByRole('button', { name: 'Bajar monto' }));
    expect(screen.getByText('Subir a 120')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Subir monto' }));
    expect(screen.getByText('Subir a 140')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Bajar monto' }));
    await fireEvent.press(screen.getByText('Subir a 120'));
    expect(onConfirm).toHaveBeenCalledWith({ type: 'raise', to: 120 });
  });

  it('bet uses "Apostar n" and amount', async () => {
    const onConfirm = await setup({ type: 'bet', min: 60, max: 1000 });
    await fireEvent.press(screen.getByText('Apostar 60'));
    expect(onConfirm).toHaveBeenCalledWith({ type: 'bet', amount: 60 });
  });

  it('invalid quick amounts are disabled; valid ones set the amount', async () => {
    await setup();
    expect(screen.getByRole('button', { name: '½ bote' }).props.accessibilityState.disabled).toBe(
      true,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Bote' }));
    expect(screen.getByText('Subir a 300')).toBeTruthy();
  });

  it('"Todo" needs a second tap', async () => {
    const onConfirm = await setup();
    await fireEvent.press(screen.getByRole('button', { name: 'Todo' }));
    expect(screen.getByText('Toca de nuevo para ir con todo')).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Todo' }));
    expect(onConfirm).toHaveBeenCalledWith({ type: 'allIn' });
  });
});
