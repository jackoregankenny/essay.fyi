import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { ArrowClockwise, FolderSimplePlus, X } from '@phosphor-icons/react'
import { IconButton } from './ui/icon-button'
import { Tip } from './ui/tooltip'
import { loadRecentFiles, type RecentFile } from '#/lib/recents'
import {
  joinPath,
  listMarkdownTree,
  loadExpandedDirs,
  loadWorkspaceFolders,
  onTreeChange,
  pickWorkspaceFolder,
  saveExpandedDirs,
  saveWorkspaceFolders,
  watchWorkspaceRoots,
  type WorkspaceFolder,
} from '#/lib/workspace'

// Browser preview has no filesystem; show a static demo tree instead so the
// explorer stays designable outside the desktop shell.
const DEMO_FOLDER: WorkspaceFolder = { path: '', name: 'example' }
const DEMO_PATHS = [
  'drafts/',
  'drafts/board-memo.md',
  'drafts/distribution-essay.md',
  'research/',
  'research/interviews/',
  'research/interviews/2026-06-pilots.md',
  'notes.md',
]

/** Each root's listing, or null while its first walk is in flight. */
type Listings = Record<string, string[] | null>

/**
 * Everything the explorer knows and can do, host-agnostic. `useExplorer` owns
 * the folders, the walks, and the root watcher; `ExplorerContent` renders it.
 * Split so the floating `FilesPanel` and any other host share one logic body —
 * two copies of the watcher wiring would be two chances to break its
 * "only unmounting stops watching" discipline.
 */
export interface ExplorerState {
  desktop: boolean
  folders: WorkspaceFolder[]
  recents: RecentFile[]
  listings: Listings
  addFolder: () => Promise<void>
  removeFolder: (folder: WorkspaceFolder) => void
  walk: (root: string) => void
}

export function useExplorer(): ExplorerState {
  const desktop = isTauri()
  const [folders, setFolders] = useState<WorkspaceFolder[]>(() =>
    desktop ? loadWorkspaceFolders() : [DEMO_FOLDER],
  )
  // Read once per mount rather than subscribed to: the explorer lives inside
  // surfaces that unmount when they close, so "once per mount" is once per
  // time the author looks at it. Not gated on the desktop shell — nothing is
  // ever recorded outside it, because that is the only place a file can be
  // opened by path at all.
  const [recents] = useState<RecentFile[]>(loadRecentFiles)
  const [listings, setListings] = useState<Listings>(() =>
    desktop ? {} : { [DEMO_FOLDER.path]: DEMO_PATHS },
  )

  const addFolder = useCallback(async () => {
    const folder = await pickWorkspaceFolder()
    if (!folder) return
    setFolders((current) => {
      if (current.some((f) => f.path === folder.path)) return current
      const next = [...current, folder]
      if (desktop) saveWorkspaceFolders(next)
      return next
    })
  }, [desktop])

  const walked = useRef(new Set<string>())

  /** Forget a folder's listing along with the folder. Without this, adding one
      back after removing it would show whatever was in it last time, with
      nothing scheduled to correct it — no walk (it has been walked) and no
      watcher event (nothing on disk has changed). */
  const removeFolder = useCallback(
    (folder: WorkspaceFolder) => {
      setFolders((current) => {
        const next = current.filter((f) => f !== folder)
        if (desktop) saveWorkspaceFolders(next)
        return next
      })
      walked.current.delete(folder.path)
      setListings((current) => {
        const next = { ...current }
        delete next[folder.path]
        return next
      })
    },
    [desktop],
  )

  const walk = useCallback((root: string) => {
    listMarkdownTree(root)
      .then((paths) => setListings((current) => ({ ...current, [root]: paths })))
      .catch(() => setListings((current) => ({ ...current, [root]: [] })))
  }, [])

  // One listing per folder, walked the first time it is seen. Tracked in a ref
  // rather than derived from `listings`, so that the arrival of a listing
  // cannot re-run the effect that asked for it.
  useEffect(() => {
    if (!desktop) return
    for (const folder of folders) {
      if (walked.current.has(folder.path)) continue
      walked.current.add(folder.path)
      walk(folder.path)
    }
  }, [desktop, folders, walk])

  /**
   * Keep the tree honest while it is on screen.
   *
   * Watching starts when the explorer mounts and stops when it unmounts, which
   * is exactly the window in which a stale tree is something the author can
   * see. A recursive watch on a large folder is not free, and the listing is
   * walked fresh on the next open regardless — so paying for it while the
   * panel is shut would buy nothing.
   *
   * The event carries the new listing, so nothing here walks the folder again.
   */
  useEffect(() => {
    if (!desktop) return
    let dispose: (() => void) | undefined
    let live = true
    void onTreeChange((change) => {
      setListings((current) => ({ ...current, [change.root]: change.paths }))
    }).then((fn) => {
      // Unmounted before the subscription landed: unsubscribe it rather than
      // hold a listener that outlives the pane and setStates into nothing.
      if (live) dispose = fn
      else fn()
    })
    return () => {
      live = false
      dispose?.()
      void watchWorkspaceRoots([])
    }
  }, [desktop])

  // Deliberately separate from the subscription above, and with no cleanup of
  // its own. Adding a folder must not stop and restart the watch: those are
  // two commands in flight at once, and the one that arrives second wins — so
  // a "stop" landing after its "start" would leave the explorer silently dead
  // for the rest of the session. Only unmounting stops watching.
  useEffect(() => {
    if (!desktop) return
    void watchWorkspaceRoots(folders.map((folder) => folder.path))
  }, [desktop, folders])

  return { desktop, folders, recents, listings, addFolder, removeFolder, walk }
}

/**
 * The scrolling body of the explorer — recents, then one section per root.
 * Brings no chrome of its own; the host supplies the header, the surface and
 * the scroll container.
 */
export function ExplorerContent({
  explorer,
  onOpenFile,
}: {
  explorer: ExplorerState
  onOpenFile: (absolutePath: string) => void
}) {
  const { desktop, folders, recents, listings, addFolder, removeFolder, walk } =
    explorer

  return (
    <>
      {/* Above the folders on purpose: a document opened ten minutes ago is
          more likely to be the one being looked for than any given file in
          a tree, and it may not be under a workspace folder at all. */}
      {recents.length > 0 && (
        <div className="mb-2">
          <div className="flex h-6 items-center px-1.5">
            <span className="text-[11px] font-medium tracking-wider text-[var(--essay-text-faint)] uppercase">
              Recent
            </span>
          </div>
          {recents.map((recent) => (
            <button
              key={recent.path}
              type="button"
              title={recent.path}
              onClick={() => onOpenFile(recent.path)}
              className="flex h-6 w-full items-center rounded px-1.5 text-left text-[13px] text-[var(--essay-text-muted)] transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]"
            >
              <span className="truncate">{recent.name}</span>
            </button>
          ))}
        </div>
      )}

      {folders.length === 0 ? (
        // An empty workspace is a fact about the session, not a failure of the
        // pane — say what will happen, not what is missing.
        <div className="px-2 py-4 text-[13px] leading-relaxed text-[var(--essay-text-faint)]">
          <p>
            Point Essay at a folder and its Markdown gathers here — any number
            of folders, never a single vault.
          </p>
          {desktop && (
            <button
              type="button"
              onClick={() => void addFolder()}
              className="mt-3 rounded-md border border-[var(--essay-border)] px-2.5 py-1 text-[12px] text-[var(--essay-text-muted)] transition-colors duration-100 hover:bg-[var(--essay-surface-hover)] hover:text-[var(--essay-text)]"
            >
              Add a folder
            </button>
          )}
        </div>
      ) : (
        folders.map((folder) => (
          <RootSection
            key={folder.path || folder.name}
            folder={folder}
            demo={!desktop}
            paths={listings[folder.path] ?? null}
            onOpenFile={onOpenFile}
            onRefresh={() => walk(folder.path)}
            onRemove={() => removeFolder(folder)}
          />
        ))
      )}
    </>
  )
}

/**
 * The explorer with its own header and scroll — the shape the full-bleed
 * layer in `Workspace` still mounts. New hosts should prefer `FilesPanel`
 * (the centered floating card) or compose `useExplorer` + `ExplorerContent`
 * directly.
 */
export function ExplorerPane({
  onOpenFile,
}: {
  onOpenFile: (absolutePath: string) => void
}) {
  const explorer = useExplorer()

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-1 px-3 pt-3 pb-1">
        <h2 className="text-[11px] font-medium tracking-wider text-[var(--essay-text-faint)] uppercase">
          Files
        </h2>
        <div className="ml-auto">
          <Tip
            label={
              explorer.desktop
                ? 'Add folder to workspace'
                : 'Available in the desktop app'
            }
            trigger={
              <IconButton
                className="h-6 w-6"
                disabled={!explorer.desktop}
                onClick={() => void explorer.addFolder()}
              >
                <FolderSimplePlus size={15} weight="bold" />
              </IconButton>
            }
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <ExplorerContent explorer={explorer} onOpenFile={onOpenFile} />
      </div>
    </section>
  )
}

function RootSection({
  folder,
  demo,
  paths,
  onOpenFile,
  onRefresh,
  onRemove,
}: {
  folder: WorkspaceFolder
  demo: boolean
  paths: string[] | null
  onOpenFile: (absolutePath: string) => void
  onRefresh: () => void
  onRemove: () => void
}) {
  return (
    <div className="group/root mb-1">
      <div className="flex h-6 items-center gap-1 rounded px-1.5">
        <span
          className="truncate text-[11px] font-medium tracking-wider text-[var(--essay-text-faint)] uppercase"
          title={folder.path || undefined}
        >
          {folder.name}
        </span>
        <div className="ml-auto flex items-center opacity-0 transition-opacity group-hover/root:opacity-100">
          {!demo && (
            // Kept even though the tree is watched: a watch can fail silently
            // on a network share or a permission-denied subtree, and this is
            // the only way back from that.
            <Tip
              label="Refresh"
              trigger={
                <IconButton className="h-5 w-5" onClick={onRefresh}>
                  <ArrowClockwise size={12} />
                </IconButton>
              }
            />
          )}
          <Tip
            label="Remove from workspace"
            trigger={
              <IconButton className="h-5 w-5" onClick={onRemove}>
                <X size={12} />
              </IconButton>
            }
          />
        </div>
      </div>
      {paths === null ? (
        <p className="px-2 py-1 text-[12px] text-[var(--essay-text-faint)]">
          Loading…
        </p>
      ) : paths.length === 0 ? (
        <p className="px-2 py-1 text-[12px] text-[var(--essay-text-faint)]">
          No Markdown here yet — files appear as they are written.
        </p>
      ) : (
        <RootTree
          root={folder.path}
          paths={paths}
          onOpen={(rel) =>
            demo ? undefined : onOpenFile(joinPath(folder.path, rel))
          }
        />
      )}
    </div>
  )
}

type TreeModel = ReturnType<typeof useFileTree>['model']

/**
 * The tree adopts the surface it sits on.
 *
 * `@pierre/trees` renders in a shadow root and paints its own sidebar surface
 * by default — `light-dark(#f8f8f8, #141415)`, resolved by the element's
 * `color-scheme`, which Essay never sets (theming is `data-theme` +
 * `--essay-*`). In the webview that resolved dark, and the tree read as a
 * dark slab inside light panels. Custom properties inherit through a shadow
 * boundary, so the library's documented `-override` variables are set here on
 * the host and the tree takes the panel's own colors in both themes; no
 * selector ever needs to pierce the shadow root. File-type icon colors take
 * the same inheritance but not the same pattern: every `--trees-file-icon-
 * color-*` falls back to one un-overridden master, `--trees-file-icon-color`,
 * so setting that alone retints every icon — Markdown's IDE-bright green
 * included — to the app's own ink instead of the library's language palette.
 */
const TREE_THEME = {
  '--trees-bg-override': 'transparent',
  '--trees-fg-override': 'var(--essay-text-muted)',
  '--trees-fg-muted-override': 'var(--essay-text-faint)',
  // Hover and selection match the app's own rows (surface-hover), not the
  // library's accent-tinted defaults.
  '--trees-bg-muted-override': 'var(--essay-surface-hover)',
  '--trees-selected-bg-override': 'var(--essay-surface-hover)',
  '--trees-selected-fg-override': 'var(--essay-text)',
  '--trees-accent-override': 'var(--essay-accent)',
  '--trees-focus-ring-color-override': 'var(--essay-accent)',
  '--trees-indent-guide-bg-override': 'var(--essay-border)',
  '--trees-font-family-override': 'var(--essay-font-ui)',
  '--trees-font-size-override': '13px',
  // The master file-icon hook (see comment above) — quiets Markdown's
  // bright default green along with every other language's icon color.
  '--trees-file-icon-color': 'var(--essay-text-faint)',
} as CSSProperties

/**
 * The directories currently showing their contents, root-relative.
 *
 * Only the rows the projection can see, so a directory left open *inside* a
 * folder the author has since collapsed is forgotten. That is the right
 * reading: collapsing something is saying "put this away", and reopening it to
 * its first level is what a folder does the first time anyway.
 */
function expandedDirs(model: TreeModel): string[] {
  return model
    .getVisibleRows(0, model.getVisibleCount())
    .filter((row) => row.kind === 'directory' && row.isExpanded)
    .map((row) => row.path)
}

/**
 * The top level of a listing — what `initialExpansion: 1` would have opened.
 *
 * Computed here rather than left to the tree widget because expansion has to
 * be stated in full. `initialExpansion` and `initialExpandedPaths` are
 * additive, and `resetPaths` keeps the former while replacing the latter — so
 * a tree left on depth 1 would re-open every top-level folder the author had
 * collapsed, every time a file appeared anywhere under the root. Saying
 * `closed` plus an explicit set makes the model's expansion exactly what this
 * component believes it is, at construction and at every reset.
 */
function firstLevelDirs(paths: string[]): string[] {
  return paths.filter(
    (path) => path.endsWith('/') && path.indexOf('/') === path.length - 1,
  )
}

function RootTree({
  root,
  paths,
  onOpen,
}: {
  root: string
  paths: string[]
  onOpen: (relPath: string) => void
}) {
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  // Read once, at construction: the model owns expansion from here on, and
  // re-reading storage would fight the author's clicks. A folder nobody has
  // opened before falls back to its first level — and `null` is why
  // `loadExpandedDirs` has to distinguish "never recorded" from "recorded as
  // empty", which is the author having collapsed everything on purpose.
  const [restored] = useState(
    () => loadExpandedDirs(root) ?? firstLevelDirs(paths),
  )

  const { model } = useFileTree({
    paths,
    initialExpansion: 'closed',
    initialExpandedPaths: restored,
    flattenEmptyDirectories: true,
    // 24px rows: the library's default 30px is an IDE sidebar's density, and
    // beside the app's own 24px rows (recents, palette) it read padded.
    density: 'compact',
    onSelectionChange: (selected) => {
      const rel = selected[0]
      if (rel && !rel.endsWith('/')) onOpenRef.current(rel)
    },
  })

  /**
   * A new listing arrived — the watcher saw a file appear, or the author hit
   * refresh. Reset the paths in place rather than remounting the tree: a
   * remount would throw away scroll position and expansion to redraw a tree
   * that has one more row in it.
   *
   * `resetPaths` builds a fresh store, so the expansion has to be handed back
   * across explicitly. Skipped on the first run — the model was constructed
   * with these paths.
   */
  const built = useRef(paths)
  useEffect(() => {
    if (built.current === paths) return
    built.current = paths
    model.resetPaths(paths, { initialExpandedPaths: expandedDirs(model) })
  }, [model, paths])

  // The tree virtualizes inside a bounded host; in the stacked multi-root
  // list each root sizes to its visible rows and the host scrolls.
  const [height, setHeight] = useState<number>()
  useEffect(() => {
    // Persisted from the same subscription that measures, because both answer
    // to the same event and a second subscription would double the work on
    // every scroll and selection. Compared before writing: the model notifies
    // for focus and selection too, and most of those leave expansion alone.
    let written = restored.join('\n')
    const update = () => {
      setHeight(model.getVisibleCount() * model.getItemHeight())
      const now = expandedDirs(model).join('\n')
      if (now === written) return
      written = now
      saveExpandedDirs(root, now === '' ? [] : now.split('\n'))
    }
    update()
    return model.subscribe(update)
  }, [model, root, restored])

  return (
    <FileTree
      model={model}
      className="essay-file-tree"
      style={{ height, ...TREE_THEME }}
    />
  )
}
