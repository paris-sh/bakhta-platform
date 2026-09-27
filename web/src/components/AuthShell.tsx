"use client";

import type { ReactNode } from "react";
import { CloverPattern, GLOW, Glow, LogoMark } from "./brand";

/** Centered card used by sign-in and registration, over a soft emerald backdrop. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="container-page overflow-x-clip py-10 sm:py-16">
      <div className="relative mx-auto max-w-md">
        <div className="pointer-events-none absolute -inset-x-6 -top-10 bottom-10 -z-10 overflow-hidden rounded-[2.5rem] bg-brand-50/70">
          <CloverPattern opacity={0.35} className="[&_pattern_g]:stroke-brand-300" />
          <Glow className="-top-24 start-1/4 h-80 w-80" color={GLOW.goldSoft} />
        </div>
        <div className="card card-pad animate-fade-up shadow-md">
          <div className="mb-6 flex flex-col items-center text-center">
            <LogoMark size={48} />
            <h1 className="mt-4 text-2xl font-extrabold tracking-tight">{title}</h1>
            <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
          </div>
          {children}
        </div>
        {footer && <div className="mt-5 text-center text-sm text-muted">{footer}</div>}
      </div>
    </div>
  );
}
