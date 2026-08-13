import { Select } from '@base-ui-components/react/select'
import { ArrowsHorizontal, Check } from '@phosphor-icons/react'
import { MEASURES, type MeasureId } from '#/lib/measure'

/**
 * Writing-column width, in the footer beside the other view controls.
 *
 * Deliberately quiet: it sits at the footer's weight until you look for it,
 * because it is a decision made once every few documents, not while writing.
 */
export function MeasureSelect({
  value,
  onChange,
}: {
  value: MeasureId
  onChange: (value: MeasureId) => void
}) {
  return (
    <Select.Root
      value={value}
      onValueChange={(next) => next && onChange(next)}
      items={MEASURES.map((measure) => ({
        value: measure.id,
        label: measure.label,
      }))}
    >
      <Select.Trigger
        aria-label="Writing width"
        className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] text-[var(--essay-text-muted)] transition-colors duration-[var(--essay-speed-quick)] ease-[var(--essay-ease-out)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)] data-[popup-open]:bg-[var(--essay-surface-hover)] data-[popup-open]:text-[var(--essay-text)]"
      >
        <ArrowsHorizontal size={11} className="shrink-0" />
        <Select.Value />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          side="top"
          align="start"
          sideOffset={8}
          // Native-select behaviour floats the popup over the trigger; from a
          // footer that reads as a panel opening over the manuscript.
          alignItemWithTrigger={false}
          className="z-50"
        >
          {/* Entrance by the motion rules, not .essay-pop's fixed 130ms: a
              popover settling at the pointer is quick/ease-out-quint. The
              keyframes are shared; only the timing is spoken in tokens.
              motion-safe gates it, matching what the class does via media
              query. */}
          <Select.Popup className="min-w-[150px] rounded-lg border border-[var(--essay-border)] bg-[var(--essay-surface)] p-1 shadow-[var(--essay-shadow-palette)] outline-none motion-safe:animate-[essay-pop_var(--essay-speed-quick)_var(--essay-ease-out-quint)_both]">
            <Select.List>
              {MEASURES.map((measure) => (
                <Select.Item
                  key={measure.id}
                  value={measure.id}
                  className="flex h-7 cursor-default select-none items-center gap-2 rounded-md px-2 text-[12px] text-[var(--essay-text-muted)] outline-none data-[highlighted]:bg-[var(--essay-surface-hover)] data-[highlighted]:text-[var(--essay-text)] data-[selected]:text-[var(--essay-text)]"
                >
                  {/* The slot is reserved by the wrapper, not the indicator:
                      the indicator only renders when selected, and labels
                      must not shift as the selection moves. */}
                  <span className="flex w-3 shrink-0 justify-center">
                    <Select.ItemIndicator className="text-[var(--essay-accent)]">
                      <Check size={11} weight="bold" />
                    </Select.ItemIndicator>
                  </span>
                  <Select.ItemText className="flex-1">
                    {measure.label}
                  </Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}
