import { fireEvent, render, screen } from '@testing-library/react-native';
import { ActionBar } from '@/components/table/ActionBar';
import type { ActionBarModel } from '@/table/viewModel';

function setup(model: ActionBarModel, disabled = false) {
  const onAct = jest.fn();
  const onOpenBet = jest.fn();
  const onSitIn = jest.fn();
  return {
    onAct,
    onOpenBet,
    onSitIn,
    ui: (
      <ActionBar
        model={model}
        disabled={disabled}
        onAct={onAct}
        onOpenBet={onOpenBet}
        onSitIn={onSitIn}
      />
    ),
  };
}

describe('ActionBar', () => {
  it('waiting shows who acts and no buttons', async () => {
    await render(setup({ kind: 'waiting', actor: 'Sol' }).ui);
    expect(screen.getByText('Esperando a Sol…')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('check / bet', async () => {
    const s = setup({
      kind: 'turn',
      fold: true,
      middle: { type: 'check' },
      right: { type: 'bet', min: 20, max: 900 },
    });
    await render(s.ui);
    await fireEvent.press(screen.getByRole('button', { name: 'Retirarse' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Pasar' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Apostar' }));
    expect(s.onAct.mock.calls).toEqual([[{ type: 'fold' }], [{ type: 'check' }]]);
    expect(s.onOpenBet).toHaveBeenCalled();
  });

  it('call / raise with amount and thousands separator', async () => {
    const s = setup({
      kind: 'turn',
      fold: true,
      middle: { type: 'call', amount: 1200 },
      right: { type: 'raise', min: 2400, max: 9000 },
    });
    await render(s.ui);
    await fireEvent.press(screen.getByRole('button', { name: 'Pagar 1.200' }));
    expect(screen.getByRole('button', { name: 'Subir' })).toBeTruthy();
    expect(s.onAct).toHaveBeenCalledWith({ type: 'call' });
  });

  it('call all-in hides the raise and sends allIn', async () => {
    const s = setup({
      kind: 'turn',
      fold: true,
      middle: { type: 'callAllIn', amount: 180 },
      right: null,
    });
    await render(s.ui);
    await fireEvent.press(screen.getByRole('button', { name: 'Pagar todo (180)' }));
    expect(screen.queryByRole('button', { name: 'Subir' })).toBeNull();
    expect(s.onAct).toHaveBeenCalledWith({ type: 'allIn' });
  });

  it('sitIn', async () => {
    const s = setup({ kind: 'sitIn' });
    await render(s.ui);
    await fireEvent.press(screen.getByRole('button', { name: 'Volver a la mesa' }));
    expect(s.onSitIn).toHaveBeenCalled();
  });

  it('is locked while an action is pending', async () => {
    const s = setup({ kind: 'turn', fold: true, middle: { type: 'check' }, right: null }, true);
    await render(s.ui);
    await fireEvent.press(screen.getByRole('button', { name: 'Pasar' }));
    expect(s.onAct).not.toHaveBeenCalled();
  });
});
