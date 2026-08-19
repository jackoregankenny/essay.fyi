import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '#/lib/cn'
import { CloseIcon } from '#/lib/icons'
import {
  ACCENTS,
  THEMES,
  type ThemeId,
} from '#/lib/appearance'
import { MEASURES, type MeasureId } from '#/lib/measure'
import { PROSE_FONTS, type ProseFontId } from '#/lib/proseFont'
import { IMAGE_STORES, type ImageStoreId } from '#/lib/imageStore'
import { FILE_RAILS, type FileRailId } from '#/lib/fileRail'

/**
 * Every preference in one place, which until now was the missing half of a
 * pattern the app already had.
 *
 * The choices themselves are not new. Writing width was a footer select, the
 * prose face and the pasted-image destination were palette commands that
 * *cycled* — press again, get the next one — and the theme was a toggle that
 * forgot itself on every launch. Cycling is a fine verb for a keyboard, and
 * those commands stay; it is a bad way to *find out what the options are*. A
 * setting nobody can enumerate is a setting nobody knows they have, which is
 * how an app ends up with a dozen preferences and a reputation for having
 * none.
 *
 * A page rather than a dialog, and the same page shape as `FontsPage`, for the
 * reason stated there: these are properties of the machine and the person, not
 * of the manuscript, so they do not belong in a companion slot that is about
 * navigating *this document*. It is summoned over the manuscript and dismissed
 * back to it, and the editor never unmounts underneath.
 *
 * Every control writes through on change — there is no Save button and no
 * Cancel, because every one of these is reversible by making the other choice
 * and none of them touches the author's file. `Esc` closes.
 */
interface SettingsPageProps {
  theme: ThemeId
  onTheme: (id: ThemeId) => void
  accent: string
  onAccent: (id: string) => void
  measure: MeasureId
  onMeasure: (id: MeasureId) => void
  proseFont: ProseFontId
  onProseFont: (id: ProseFontId) => void
  imageStore: ImageStoreId
  onImageStore: (id: ImageStoreId) => void
  fileRail: FileRailId
  onFileRail: (id: FileRailId) => void
  /** Typefaces are their own page — browsing faces means seeing them. */
  onOpenFonts: () => void
  /** Explorer roots are edited where they are used, not duplicated here. */
  onOpenFolders: () => void
  onClose: () => void
  className?: string
}

function Section({ title, blurb, children }: { title: string; blurb?: string; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--essay-border)] py-7 first:border-t-0 first:pt-0">
      <h2 className="text-[13px] font-[590] text-[var(--essay-text)]">{title}</h2>
      {blurb && (
        <p className="mt-1 max-w-prose text-[12px] leading-relaxed text-[var(--essay-text-faint)]">
          {blurb}
        </p>
      )}
      <div className="mt-4 flex flex-col gap-5">{children}</div>
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-[12px] font-[510] text-[var(--essay-text)]">{label}</span>
        {hint && (
          <span className="text-[11px] leading-relaxed text-[var(--essay-text-faint)]">{hint}</span>
        )}
      </div>
      {children}
    </div>
  )
}

/**
 * A row of choices rather than a dropdown. There are never more than five of
 * anything here, and a segmented row shows the whole option space at a glance
 * — which is the entire reason this page exists over the cycling commands.
 */
function Choices<T extends string>({
  value,
  options,
  onChange,
  name,
}: {
  value: T
  options: readonly { id: T; label: string; detail?: string }[]
  onChange: (id: T) => void
  name: string
}) {
  const selected = options.find((option) => option.id === value)
  return (
    <div className="flex flex-col gap-2">
      <div
        role="radiogroup"
        aria-label={name}
        className="flex flex-wrap gap-1 rounded-lg bg-[var(--essay-surface)] p-1"
      >
        {options.map((option) => {
          const active = option.id === value
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.id)}
              className={cn(
                'rounded-md px-3 py-1.5 text-[12px] transition-colors duration-[var(--essay-speed-quick)]',
                // Raised, not coloured. This used to be the accent tint, which
                // is the ground for *actions* — so choosing a theme left a
                // blue chip sitting in the panel afterwards, saying nothing
                // except that it had been chosen.
                active
                  ? 'bg-[var(--essay-surface-selected)] text-[var(--essay-text)]'
                  : 'text-[var(--essay-text-muted)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]',
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
      {/* The detail belongs to the current choice, not to every option at
          once: a wall of explanations is read as none. */}
      {selected?.detail && (
        <p className="text-[11px] leading-relaxed text-[var(--essay-text-faint)]">
          {selected.detail}
        </p>
      )}
    </div>
  )
}

export function SettingsPage({
  theme,
  onTheme,
  accent,
  onAccent,
  measure,
  onMeasure,
  proseFont,
  onProseFont,
  imageStore,
  onImageStore,
  fileRail,
  onFileRail,
  onOpenFonts,
  onOpenFolders,
  onClose,
  className,
}: SettingsPageProps) {
  const closeRef = useRef<HTMLButtonElement>(null)

  // Focus lands on the page, not in the manuscript behind it, or the first
  // keystroke meant for settings is typed into the document.
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className={cn(
        'essay-fade flex flex-col overflow-hidden bg-[var(--essay-editor-bg)]',
        className,
      )}
      role="dialog"
      aria-label="Settings"
      aria-modal="true"
    >
      <header className="flex shrink-0 items-center justify-between px-8 pt-7 pb-4">
        <h1 className="text-[15px] font-[590] text-[var(--essay-text)]">Settings</h1>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="rounded-md p-1.5 text-[var(--essay-text-faint)] transition-colors duration-[var(--essay-speed-quick)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]"
        >
          <CloseIcon size={16} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-16">
        <div className="mx-auto max-w-xl">
          <Section
            title="Appearance"
            blurb="How the room looks. None of this reaches the file."
          >
            <Field label="Theme">
              <Choices name="Theme" value={theme} options={THEMES} onChange={onTheme} />
            </Field>

            <Field
              label="Accent"
              hint="The one saturated element in the frame — the caret, the lit tick on the spine, the dot on a section with unresolved work."
            >
              <div
                role="radiogroup"
                aria-label="Accent"
                className="flex flex-wrap gap-2"
              >
                {ACCENTS.map((option) => {
                  const active = option.id === accent
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={option.label}
                      title={option.label}
                      onClick={() => onAccent(option.id)}
                      className={cn(
                        'size-7 rounded-full transition-[box-shadow,transform] duration-[var(--essay-speed-quick)]',
                        active
                          ? 'scale-110 ring-2 ring-[var(--essay-text)] ring-offset-2 ring-offset-[var(--essay-editor-bg)]'
                          : 'ring-1 ring-[var(--essay-border)] hover:scale-105',
                      )}
                      // The swatch is the colour it names, at the lightness and
                      // chroma the current theme would give it — so what the
                      // author sees here is what the caret will be.
                      style={{
                        background: `oklch(var(--essay-accent-l, 0.71) var(--essay-accent-c, 0.135) ${option.hue})`,
                      }}
                    />
                  )
                })}
              </div>
            </Field>
          </Section>

          <Section
            title="Writing"
            blurb="The shape of the page you write on. A preference, not a document property — it travels with you, and the same file opens at whatever width the next machine prefers."
          >
            <Field label="Writing width">
              <Choices
                name="Writing width"
                value={measure}
                options={MEASURES.map((entry) => ({ id: entry.id, label: entry.label }))}
                onChange={onMeasure}
              />
            </Field>

            <Field
              label="Prose face"
              hint="Swaps the manuscript face only. The chrome stays Geist."
            >
              <Choices
                name="Prose face"
                value={proseFont}
                options={PROSE_FONTS}
                onChange={onProseFont}
              />
            </Field>

            <Field
              label="Typefaces"
              hint="Essay embeds no fonts — it uses the machine's, and this is where you add more."
            >
              <button
                type="button"
                onClick={onOpenFonts}
                className="self-start rounded-md bg-[var(--essay-surface)] px-3 py-1.5 text-[12px] text-[var(--essay-text-muted)] transition-colors duration-[var(--essay-speed-quick)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]"
              >
                Manage typefaces…
              </button>
            </Field>
          </Section>

          <Section
            title="Files"
            blurb="Changing where images go never moves one that has already landed — a reference that works keeps working."
          >
            <Field label="Pasted images">
              <Choices
                name="Pasted images"
                value={imageStore}
                options={IMAGE_STORES}
                onChange={onImageStore}
              />
            </Field>

            <Field
              label="File explorer"
              hint="Pinned keeps a column beside the manuscript. Below a narrow window it folds back to summoned — the preference is kept, not honoured."
            >
              <Choices
                name="File explorer"
                value={fileRail}
                options={FILE_RAILS}
                onChange={onFileRail}
              />
            </Field>

            <Field
              label="Folders"
              hint="The roots the explorer walks and project search covers. Any number of them — this is not a vault."
            >
              <button
                type="button"
                onClick={onOpenFolders}
                className="self-start rounded-md bg-[var(--essay-surface)] px-3 py-1.5 text-[12px] text-[var(--essay-text-muted)] transition-colors duration-[var(--essay-speed-quick)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]"
              >
                Browse folders…
              </button>
            </Field>
          </Section>
        </div>
      </div>
    </div>
  )
}
