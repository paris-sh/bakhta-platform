"use client";

import type { PublicWinning } from "@/lib/types";
import { SelectionDisplay } from "@/components/SelectionDisplay";

/** A published winning result, drawn like a ticket. Six Chance shows the numbers sorted
 * (how players compare them); the physical draw order is shown separately on the detail page. */
export function PublicWinningView({ winning, size = "md", order = "sorted" }: { winning: PublicWinning; size?: "sm" | "md"; order?: "sorted" | "draw" }) {
  if (winning.kind === "FOUR_LEAF") {
    return <SelectionDisplay selection={{ kind: "FOUR_LEAF", numberValue: winning.numberValue }} size={size} />;
  }
  return (
    <SelectionDisplay
      selection={{ kind: "SIX_CHANCE", numbers: order === "draw" ? winning.drawOrder : winning.sortedNumbers, symbol: winning.symbol }}
      size={size}
    />
  );
}
