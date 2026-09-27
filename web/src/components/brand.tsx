"use client";

import { useId } from "react";
import type { GameType } from "@/lib/types";
import type { ChanceSymbolKey } from "@/lib/chance-symbols";
import { SymbolGlyph } from "./ChanceSymbol";

// Inline SVG brand primitives: no image downloads, crisp at any size, and themable through
// currentColor / props. Pattern and gradient ids come from useId so several instances can
// coexist on one page.

function svgId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, "");
}

/** Four round leaves around a centre — the Bakhta clover, used in the mark and patterns. */
function Clover({ cx, cy, r, ...rest }: { cx: number; cy: number; r: number } & React.SVGProps<SVGGElement>) {
  const d = r * 0.98;
  return (
    <g {...rest}>
      <circle cx={cx} cy={cy - d} r={r} />
      <circle cx={cx + d} cy={cy} r={r} />
      <circle cx={cx} cy={cy + d} r={r} />
      <circle cx={cx - d} cy={cy} r={r} />
    </g>
  );
}

export function LogoMark({ size = 36 }: { size?: number }) {
  const id = svgId(useId());
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#13875f" />
          <stop offset="1" stopColor="#053325" />
        </linearGradient>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f3d68f" />
          <stop offset="1" stopColor="#c99a3b" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill={`url(#${id}-bg)`} />
      <rect x="0.75" y="0.75" width="38.5" height="38.5" rx="11.25" fill="none" stroke="rgb(255 255 255 / 0.14)" />
      <Clover cx={20} cy={20} r={5.4} fill={`url(#${id}-gold)`} />
      <circle cx="20" cy="20" r="2.1" fill="#053325" />
    </svg>
  );
}

/** Very low-opacity clover line pattern for dark emerald surfaces. */
export function CloverPattern({ className = "", opacity = 0.09 }: { className?: string; opacity?: number }) {
  const id = svgId(useId());
  return (
    <svg className={`pointer-events-none absolute inset-0 h-full w-full ${className}`} aria-hidden="true" focusable="false">
      <defs>
        <pattern id={id} width="56" height="56" patternUnits="userSpaceOnUse" patternTransform="rotate(12)">
          <Clover cx={14} cy={14} r={4.2} fill="none" stroke="#ffffff" strokeWidth="1" />
          <Clover cx={42} cy={42} r={3} fill="none" stroke="#ffffff" strokeWidth="0.9" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} opacity={opacity} />
    </svg>
  );
}

/** Six Chance surface pattern: lottery-ball outlines and the five chance symbols, drawn in
 * white at very low opacity. The clover is deliberately absent — it belongs to Four Leaf. */
export function BallsPattern({ className = "", opacity = 0.085 }: { className?: string; opacity?: number }) {
  const id = svgId(useId());
  const placements: { key: ChanceSymbolKey; x: number; y: number; r: number }[] = [
    { key: "sun", x: 58, y: 6, r: 0 },
    { key: "moon", x: 104, y: 52, r: -12 },
    { key: "star", x: 8, y: 86, r: 10 },
    { key: "diamond", x: 62, y: 100, r: 0 },
    { key: "crown", x: 112, y: 118, r: -6 },
  ];
  return (
    <svg className={`pointer-events-none absolute inset-0 h-full w-full ${className}`} aria-hidden="true" focusable="false">
      <defs>
        <pattern id={id} width="150" height="150" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="#ffffff" strokeWidth="1">
            <circle cx="24" cy="30" r="15" />
            <circle cx="104" cy="92" r="10" />
          </g>
          <text x="24" y="34.5" fill="#ffffff" fontSize="12" fontWeight="700" fontFamily="system-ui, sans-serif" textAnchor="middle">
            6
          </text>
          {placements.map((p) => (
            <g key={p.key} transform={`translate(${p.x} ${p.y}) rotate(${p.r} 11 11) scale(0.92)`}>
              <SymbolGlyph symbolKey={p.key} color="#ffffff" />
            </g>
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} opacity={opacity} />
    </svg>
  );
}

export const GLOW = {
  gold: "rgb(230 198 122 / 0.26)",
  green: "rgb(127 195 163 / 0.22)",
  ocean: "rgb(127 179 194 / 0.28)",
  goldSoft: "rgb(245 232 196 / 0.9)",
} as const;

/** Soft radial glow behind hero/game headers — a true radial gradient (smooth falloff, no
 * blur filter), positioned and sized by `className`. */
export function Glow({ className, color }: { className: string; color: string }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute rounded-full ${className}`}
      style={{ background: `radial-gradient(closest-side, ${color}, transparent)` }}
    />
  );
}

/** Small illustrated badge identifying each game. */
export function GameIcon({ gameType, size = 44 }: { gameType: GameType | string; size?: number }) {
  const id = svgId(useId());
  if (gameType === "SIX_CHANCE") {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id={`${id}-ball`} cx="0.35" cy="0.3" r="0.8">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.55" stopColor="#f4ead2" />
            <stop offset="1" stopColor="#d7b56a" />
          </radialGradient>
        </defs>
        <circle cx="24" cy="24" r="22" fill="rgb(255 255 255 / 0.1)" stroke="rgb(255 255 255 / 0.25)" />
        <circle cx="24" cy="24" r="15" fill={`url(#${id}-ball)`} />
        <circle cx="24" cy="24" r="8.2" fill="#ffffff" stroke="#104457" strokeWidth="1.2" />
        <text x="24" y="28.3" textAnchor="middle" fontSize="12" fontWeight="800" fill="#104457" fontFamily="system-ui, sans-serif">
          6
        </text>
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-leaf`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f3d68f" />
          <stop offset="1" stopColor="#c99a3b" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill="rgb(255 255 255 / 0.1)" stroke="rgb(255 255 255 / 0.25)" />
      <Clover cx={24} cy={22} r={6.2} fill={`url(#${id}-leaf)`} />
      <circle cx="24" cy="22" r="2.2" fill="#06432f" />
      <path d="M24 28 C 24 33, 26 36, 29 38" stroke="#e6c67a" strokeWidth="2.2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** Per-game visual identity, so pages and cards stay consistent. */
export const GAME_THEME: Record<string, { header: string; pattern: "clover" | "balls"; accent: string; ring: string }> = {
  FOUR_LEAF: {
    header: "bg-[linear-gradient(135deg,var(--brand-500)_0%,var(--brand-700)_45%,var(--brand-900)_100%)]",
    pattern: "clover",
    accent: "text-brand",
    ring: "hover:border-brand-300",
  },
  SIX_CHANCE: {
    header: "bg-[linear-gradient(135deg,var(--ocean-500)_0%,var(--ocean-700)_50%,var(--ocean-900)_100%)]",
    pattern: "balls",
    accent: "text-ocean-700",
    ring: "hover:border-ocean-300",
  },
};

export function gameTheme(gameType: string) {
  return GAME_THEME[gameType] ?? GAME_THEME.FOUR_LEAF;
}

export function GamePattern({ gameType }: { gameType: string }) {
  return gameTheme(gameType).pattern === "balls" ? <BallsPattern /> : <CloverPattern />;
}
