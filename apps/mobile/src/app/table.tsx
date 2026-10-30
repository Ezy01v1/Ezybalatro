import { router, Stack } from 'expo-router';
import { useMe } from '@/api/me';
import { TableScreen } from '@/components/table/TableScreen';
import { useTableStore } from '@/table/useTableStore';

/** Table mode route: quick seat on mount; leaving goes through the screen's own confirmation. */
export default function TableRoute() {
  const me = useMe();
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
