// The shape of Essay's font handling, and the one way the frontend asks about
// typefaces.
//
// Essay embeds no fonts. What a document can be set in is whatever this
// machine offers, plus whatever the author has installed into Essay's own
// directory — which is the reason this module exists at all. Without it a
// manuscript typesets in a platform fallback and the author has no way to say
// otherwise short of installing fonts system-wide, which is exactly the chore
// they were trying to avoid.
//
// Nothing here reads a font file. `essay-render` owns the database, the
// parsing and the directory, so the typesetter and this panel can never
// disagree about which faces exist.

import { invoke, isTauri } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'

/** A family an author can name in a template. */
export interface FontFamily {
  name: string
  /** Regular, bold, italic and so on. */
  faces: number
  /** Installed into Essay's directory rather than provided by the system —
      the ones that can be removed again. */
  installedByAuthor: boolean
}

/** The extensions Typst can actually read. Deliberately not `.woff2`: a web
    font is compressed and subsetted, and Essay would accept it, install it,
    and then set type with holes in it. */
export const FONT_EXTENSIONS = ['ttf', 'otf', 'ttc', 'otc']

/**
 * Every family the typesetter can resolve, alphabetically.
 *
 * Empty outside the desktop shell: the browser preview has no font database
 * and no directory to install into.
 */
export async function listFontFamilies(): Promise<FontFamily[]> {
  if (!isTauri()) return []
  return invoke<FontFamily[]>('list_font_families')
}

/**
 * Ask for font files and install them. Resolves the names that landed, or an
 * empty array if the author cancelled.
 *
 * The picker is multi-select because a family is several files — installing
 * "Libertinus Serif" means regular, italic, bold and bold italic, and asking
 * four times would be the wrong shape of chore.
 */
export async function installFontsFromDisk(): Promise<string[]> {
  if (!isTauri()) return []
  const chosen = await openDialog({
    multiple: true,
    filters: [{ name: 'Fonts', extensions: FONT_EXTENSIONS }],
  })
  const paths = Array.isArray(chosen) ? chosen : chosen ? [chosen] : []
  if (paths.length === 0) return []
  return invoke<string[]>('install_font_files', { paths })
}

/** Remove a family Essay installed. System families are refused by the host. */
export async function removeFontFamily(family: string): Promise<number> {
  if (!isTauri()) return 0
  return invoke<number>('remove_font_family', { family })
}
