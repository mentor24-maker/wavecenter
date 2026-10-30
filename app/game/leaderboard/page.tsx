import GamePlaceholder from "../GamePlaceholder";

/** The Game leaderboard: a placeholder until a later task builds it. */
export default function Leaderboard() {
  return (
    <GamePlaceholder
      current="leaderboard"
      message="The leaderboard is not built yet. It is coming in a later task, and will show how members' points compare."
    />
  );
}
