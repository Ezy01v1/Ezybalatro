import { router, Stack } from 'expo-router';
import { useEffect } from 'react';
import { invalidateMe, useMe } from '@/api/me';
import { TableScreen } from '@/components/table/TableScreen';
import { useTableStore } from '@/table/useTableStore';

/** Table mode route: quick seat on mount; leaving goes through the screen's own confirmation. */
export default function TableRoute() {
  const me = useMe();
  const status = useTableStore((s) => s.status);
  // Sitting down moved the buy-in out of the wallet: refetch it for the top bar.
  useEffect(() => {
    if (status === 'seated') void invalidateMe();
  }, [status]);
  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <TableScreen
        useStore={useTableStore}
        balance={me.data?.balance ?? null}
        onExit={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
    </>
  );
}
