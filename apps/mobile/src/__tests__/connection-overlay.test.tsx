import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConnectionOverlay } from '@/components/table/ConnectionOverlay';
import type { TableStatus } from '@/table/tableStore';

async function setup(status: TableStatus) {
  const h = { onCancel: jest.fn(), onRetry: jest.fn(), onExit: jest.fn() };
  await render(<ConnectionOverlay status={status} {...h} />);
  return h;
}

describe('ConnectionOverlay', () => {
  it('connecting', async () => {
    await setup('connecting');
    expect(screen.getByText('Buscando mesa…')).toBeTruthy();
    expect(screen.queryByText(/despertando/)).toBeNull();
  });
  it('waking adds the hint and Cancelar', async () => {
    const h = await setup('waking');
    expect(
      screen.getByText('El servidor está despertando. Puede tardar hasta un minuto.'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
    expect(h.onCancel).toHaveBeenCalled();
  });
  it('reconnecting band', async () => {
    await setup('reconnecting');
    expect(screen.getByText('Reconectando…')).toBeTruthy();
  });
  it('failed: Reintentar / Volver al menú', async () => {
    const h = await setup('failed');
    expect(screen.getByText('No pudimos conectar con la mesa. Revisa tu conexión.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Volver al menú' }));
    expect(h.onRetry).toHaveBeenCalled();
    expect(h.onExit).toHaveBeenCalled();
  });
  it('seated shows nothing', async () => {
    await setup('seated');
    expect(screen.queryByText('Buscando mesa…')).toBeNull();
  });
});
