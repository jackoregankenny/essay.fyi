import { Popover } from '@base-ui-components/react/popover'
import { ArrowUpRight, Question, Sparkle } from '@phosphor-icons/react'
import { latestRelease, releases } from '#/lib/changelog'

export interface HelpPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Open the changelog in the manuscript surface. */
  onOpenChangelog: () => void
  /** Open the welcome document in the manuscript surface. */
  onOpenWelcome: () => void
}

/**
 * The help tab: the footer's second affordance, answering "what changed?" and
 * "how does this work?" without either question needing a place in the chrome
 * the rest of the time.
 *
 * It lives *in* the footer rather than floating above it. The first version of
 * this was absolutely positioned in the bottom-left corner, which put a button
 * over the manuscript at a spot the footer already owns — two surfaces
 * claiming one corner, and the floating one reading as something that had not
 * been placed so much as dropped. The footer is already the home for the one
 * control that is not a fact about the document (Settings), so this is its
 * counterpart rather than a new thing to notice: same 13px, same faint ink,
 * same hover.
 *
 * At the trailing edge, not beside Settings. Stacked together the two read as
 * a toolbar forming in the corner, and the word counts — which are the point
 * of the footer — get pushed off their own left margin. Bracketing them
 * instead keeps the facts about the document in the middle where they belong,
 * and puts the least urgent control in the room at the far corner of the whole
 * window, which is the last place the eye arrives.
 *
 * It shows *and* opens, which is the point. The popover carries the newest
 * release — a line about it and the shape of what changed — because that is
 * usually the whole question, and a click that leaves the manuscript to answer
 * "anything new?" is a click most people will not spend. When the answer is
 * worth more than a line, the buttons open the changelog and the welcome as
 * manuscripts, typeset in the editor like any other document. That is the same
 * reasoning as `content/welcome.md`: Essay's best surface for reading a
 * document is the one it spent all its effort on, and reimplementing a worse
 * one inside a popover would be an odd thing to do with it.
 *
 * Every release is listed rather than only the newest, because "dig into any
 * of them" is the ask; they all open the same document, which is where the
 * history actually lives.
 */
export function HelpPanel({
  open,
  onOpenChange,
  onOpenChangelog,
  onOpenWelcome,
}: HelpPanelProps) {
  const older = releases.slice(1)

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange} modal={false}>
      {/* No `Tip` wrapper, deliberately. `Tip` mounts its child through Base
          UI's `render` prop, which takes over the element — nesting a
          `Popover.Trigger` inside one produces a button that tooltips
          correctly and never opens the popover. `FilesPanel` hit the same wall
          and answered it the same way: the native `title` attribute, which
          costs the styled tooltip and keeps the button working. */}
      {/* Styled as its neighbour in the footer, not as a control of its own:
          13px, faint until pointed at, no fill or edge. The footer is
          `pointer-events-none` so its text never intercepts a click meant for
          the manuscript, which is why this opts back in explicitly. */}
      <Popover.Trigger
        aria-label="Help and what's new"
        title="Help and what's new"
        className="pointer-events-auto shrink-0 rounded text-[var(--essay-text-faint)] transition-colors duration-[var(--essay-speed-quick)] hover:text-[var(--essay-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)] data-[popup-open]:text-[var(--essay-text)]"
      >
        <Question size={13} />
      </Popover.Trigger>
      <Popover.Portal>
        {/* Opens upward and leftward. `side="top"` because the trigger sits at
            the bottom of the window, so `bottom` has nowhere to go and Base UI
            would flip it anyway — naming the side it will actually use keeps
            the entrance animation travelling in the right direction. And
            `align="end"` because the trigger is now the last thing in the
            footer: aligned to its start, a 20rem popup would hang off the right
            edge of the window and get shunted back by the collision handler,
            which lands it somewhere nobody chose. */}
        <Popover.Positioner
          side="top"
          align="end"
          sideOffset={8}
          className="z-[var(--essay-z-float)]"
        >
          <Popover.Popup
            id="essay-help-panel"
            aria-label="Help and what's new"
            initialFocus={(interaction) => interaction === 'keyboard'}
            className="essay-files-popover flex w-[min(20rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-xl"
          >
            <header className="flex h-10 shrink-0 items-center gap-2 px-3">
              <h2 className="text-[12px] font-[510] text-[var(--essay-text)]">
                What&rsquo;s new
              </h2>
              {latestRelease && (
                <span className="ml-auto text-[10.5px] tabular-nums text-[var(--essay-text-faint)]">
                  {latestRelease.version}
                  {latestRelease.when ? ` · ${latestRelease.when}` : ''}
                </span>
              )}
            </header>

            {latestRelease ? (
              <div className="px-3 pb-2">
                {latestRelease.summary && (
                  <p className="text-[11.5px] leading-[1.5] text-[var(--essay-text-muted)]">
                    {latestRelease.summary}
                  </p>
                )}
                {latestRelease.sections.length > 0 && (
                  // The shape of the release rather than its detail. Chips,
                  // not a bulleted list: this is a table of contents for the
                  // document one click away, and setting it as prose would
                  // invite reading it as the release notes themselves.
                  <ul className="mt-2 flex flex-wrap gap-1">
                    {latestRelease.sections.map((section) => (
                      <li
                        key={section}
                        className="rounded-full bg-[var(--essay-surface-hover)] px-2 py-0.5 text-[10.5px] text-[var(--essay-text-muted)]"
                      >
                        {section}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="px-3 pb-2 text-[11.5px] text-[var(--essay-text-faint)]">
                No releases yet.
              </p>
            )}

            <div className="px-2 pb-1">
              <HelpAction
                icon={<Sparkle size={13} />}
                label="Read the full changelog"
                onClick={onOpenChangelog}
              />
              <HelpAction
                icon={<Question size={13} />}
                label="Getting started"
                onClick={onOpenWelcome}
              />
            </div>

            {older.length > 0 && (
              <>
                <div
                  aria-hidden
                  className="mx-3 my-1 h-px bg-[var(--essay-border)]"
                />
                <div className="px-2 pb-2">
                  <h3 className="px-2 pt-1 pb-1 text-[10px] font-[510] tracking-wide text-[var(--essay-text-faint)] uppercase">
                    Earlier releases
                  </h3>
                  {/* Capped, and the changelog is the overflow. A popover that
                      grows without limit becomes a scroll container, and a
                      scroll container in the corner of the window is a worse
                      way to read a changelog than the changelog. */}
                  {older.slice(0, 6).map((release) => (
                    <HelpAction
                      key={release.version}
                      label={release.version}
                      detail={release.when}
                      onClick={onOpenChangelog}
                    />
                  ))}
                </div>
              </>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

function HelpAction({
  icon,
  label,
  detail,
  onClick,
}: {
  icon?: React.ReactNode
  label: string
  detail?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11.5px] text-[var(--essay-text-muted)] transition-[color,background-color] duration-[var(--essay-speed-quick)] hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--essay-accent)]"
    >
      {icon && <span className="shrink-0 opacity-70">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail && (
        <span className="shrink-0 text-[10.5px] text-[var(--essay-text-faint)]">
          {detail}
        </span>
      )}
      <ArrowUpRight
        size={11}
        aria-hidden
        className="shrink-0 opacity-0 transition-opacity duration-[var(--essay-speed-quick)] group-hover:opacity-60"
      />
    </button>
  )
}
