"use client";

import { useSyncExternalStore } from "react";
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { ChileFlag, UsFlag } from "@/components/flags";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function SiteControls() {
  const { locale, t, setLocale } = useI18n();
  const { resolvedTheme, setTheme } = useTheme();
  // resolvedTheme is unknown on the server, so only expose it to the DOM after hydration.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  return (
    <div className="flex items-center gap-3">
      {/* Language: the flag shows the current language; click to switch. */}
      <button
        type="button"
        onClick={() => setLocale(locale === "en" ? "es" : "en")}
        aria-label={t.switchLanguage}
        title={t.switchLanguage}
        className="cursor-pointer overflow-hidden rounded-sm ring-1 ring-border transition-[opacity,transform] hover:opacity-80 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {/* Both flags stay mounted and cross-fade with a slight flip when the language changes. */}
        <span className="relative block h-5 w-[30px] [perspective:200px]">
          <UsFlag
            className={cn(
              "absolute inset-0 block size-full transition-all duration-300 ease-out",
              locale === "en" ? "rotate-y-0 scale-100 opacity-100" : "-rotate-y-90 scale-75 opacity-0",
            )}
          />
          <ChileFlag
            className={cn(
              "absolute inset-0 block size-full transition-all duration-300 ease-out",
              locale === "es" ? "rotate-y-0 scale-100 opacity-100" : "rotate-y-90 scale-75 opacity-0",
            )}
          />
        </span>
      </button>

      {/* Theme: on/off switch whose thumb shows a sun (light) or moon (dark). */}
      <button
        type="button"
        role="switch"
        aria-checked={mounted && resolvedTheme === "dark"}
        aria-label={t.toggleTheme}
        title={t.toggleTheme}
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        className="group relative h-6 w-11 shrink-0 cursor-pointer rounded-full bg-input transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:bg-primary/40"
      >
        <span className="absolute top-0.5 left-0.5 flex size-5 items-center justify-center rounded-full bg-background text-foreground shadow transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-active:scale-90 dark:translate-x-5">
          {/* Both icons stay in the DOM and cross-fade/rotate via CSS, so SSR/hydration can't mismatch. */}
          <SunIcon className="absolute size-3.5 rotate-0 scale-100 opacity-100 transition-all duration-300 dark:-rotate-90 dark:scale-0 dark:opacity-0" />
          <MoonIcon className="absolute size-3.5 rotate-90 scale-0 opacity-0 transition-all duration-300 dark:rotate-0 dark:scale-100 dark:opacity-100" />
        </span>
      </button>
    </div>
  );
}
