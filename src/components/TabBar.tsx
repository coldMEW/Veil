import { useRef, type ComponentType, type KeyboardEvent } from 'react';
import { motion } from 'motion/react';
import type { IconProps } from '@phosphor-icons/react';

export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon: ComponentType<IconProps>;
}

interface TabBarProps<T extends string> {
  tabs: ReadonlyArray<TabDef<T>>;
  active: T;
  onChange: (id: T) => void;
  idPrefix: string;
  /** `pill` sits in the desktop top bar; `dock` is the phone bottom bar. */
  variant: 'pill' | 'dock';
  className?: string;
}

const SLIDE = { type: 'spring', stiffness: 420, damping: 36 } as const;

/** WAI-ARIA tabs: arrow keys move between tabs, Home and End jump to the ends. */
export function TabBar<T extends string>({ tabs, active, onChange, idPrefix, variant, className = '' }: TabBarProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const next =
      event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    const tab = tabs[next];
    if (!tab) return;
    onChange(tab.id);
    refs.current[next]?.focus();
  };

  const container =
    variant === 'pill'
      ? 'gap-1 rounded-full border border-line bg-panel/70 p-1 shadow-[0_8px_24px_-12px_rgb(0_0_0/0.6)]'
      : 'grid grid-cols-3';

  return (
    <div role="tablist" aria-label="Workspace" className={`flex ${container} ${className}`}>
      {tabs.map((tab, index) => {
        const selected = tab.id === active;
        const Icon = tab.icon;
        const look =
          variant === 'pill'
            ? `h-9 gap-2 rounded-full px-4 text-sm ${selected ? 'text-gold-ink font-semibold' : 'text-muted hover:text-ink'}`
            : `h-16 flex-col justify-center gap-1 text-xs ${selected ? 'text-gold font-semibold' : 'text-muted'}`;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls="workspace-panel"
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`relative flex items-center font-medium transition-colors duration-200 active:scale-[0.97] ${look}`}
          >
            {selected &&
              (variant === 'pill' ? (
                <motion.span
                  layoutId={`${idPrefix}-indicator`}
                  className="absolute inset-0 rounded-full bg-gold shadow-[0_6px_18px_-6px_rgb(255_199_44/0.55)]"
                  transition={SLIDE}
                />
              ) : (
                <motion.span
                  layoutId={`${idPrefix}-indicator`}
                  className="absolute left-1/2 top-0 h-0.5 w-10 -translate-x-1/2 rounded-full bg-gold"
                  transition={SLIDE}
                />
              ))}
            <motion.span
              className="relative flex items-center"
              animate={{ scale: selected && variant === 'dock' ? 1.08 : 1 }}
              transition={SLIDE}
            >
              <Icon size={variant === 'pill' ? 16 : 22} weight={selected ? 'fill' : 'regular'} aria-hidden />
            </motion.span>
            <span className="relative">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
