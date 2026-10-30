import GamePlaceholder from "../GamePlaceholder";

/** Game management: a placeholder until a later task builds it. */
export default function Manage() {
  return (
    <GamePlaceholder
      current="manage"
      message="Game management is not built yet. It is coming in a later task."
    />
  );
}
