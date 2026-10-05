import { Redirect, router } from 'expo-router';
import { GameScreen } from '@/components/roguelike/GameScreen';
import { RoundWonSheet } from '@/components/roguelike/RoundWonSheet';
import { RunOverScreen } from '@/components/roguelike/RunOverScreen';
import { ShopScreen } from '@/components/roguelike/ShopScreen';
import { useGame } from '@/game/store';

/** The run route renders the screen that matches the engine phase. */
export default function RunRoute() {
  const run = useGame((s) => s.run);
  const roundSummary = useGame((s) => s.roundSummary);
  const playback = useGame((s) => s.playback);
  const dismissRoundSummary = useGame((s) => s.dismissRoundSummary);
  const startRun = useGame((s) => s.startRun);
  const exitRun = useGame((s) => s.exitRun);

  // Nothing to show (e.g. opened without a run): go home.
  if (!run) return <Redirect href="/" />;

  if (run.phase === 'ended' && !playback) {
    return (
      <RunOverScreen
        run={run}
        onNewRun={() => startRun()}
        onReplay={() => startRun(run.seed)}
        onHome={() => {
          exitRun();
          router.replace('/');
        }}
      />
    );
  }

  if (run.phase === 'shop' && !playback && !roundSummary) return <ShopScreen run={run} />;

  return (
    <>
      <GameScreen run={run} />
      <RoundWonSheet summary={playback ? null : roundSummary} onContinue={dismissRoundSummary} />
    </>
  );
}
