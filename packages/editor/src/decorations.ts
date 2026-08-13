/**
 * The decoration substrate: one plugin, named layers, deterministic order.
 *
 * Find, comments, spellcheck and agent presence all need to paint ranges over
 * the same prose, and each must be settable and clearable without rebuilding
 * the others (docs/authoring-backlog.md, package A). So there is exactly one
 * plugin, holding one DecorationSet per layer, and hosts talk to it only
 * through `setDecorationLayer` / `clearDecorationLayer`.
 *
 * Precedence is fixed, lowest to highest: agent < spelling < comment < find <
 * find-active. Overlapping ranges land every layer's class on the same span —
 * ProseMirror merges inline decorations rather than stacking elements — so
 * the order is enforced where it can be: the combined set is built in layer
 * order, and prose.css keeps its rules in the same order so the higher layer
 * wins the ties. A consumer that needs a range to *read* as two layers uses
 * translucent paint, not a second plugin.
 *
 * Perf shape (invariant 5): between explicit sets, every layer maps through
 * transactions — position arithmetic, never a doc walk on a keystroke. The
 * combined set maps the same way and is rebuilt only when a layer is
 * explicitly replaced, which happens on the consumer's own schedule (find
 * recomputes debounced; comments on anchor changes), never per keystroke.
 */
import { Extension, type Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/** The layers, in visual priority order (lowest first). */
export const DECORATION_LAYERS = [
  'agent',
  'spelling',
  'comment',
  'find',
  'find-active',
] as const

export type DecorationLayer = (typeof DECORATION_LAYERS)[number]

/** The stable class each layer's spans carry — what prose.css styles. */
const LAYER_CLASS: Record<DecorationLayer, string> = {
  agent: 'essay-deco-agent',
  spelling: 'essay-deco-spelling',
  comment: 'essay-deco-comment',
  find: 'essay-deco-find',
  'find-active': 'essay-deco-find-active',
}

export interface DecorationRange {
  from: number
  to: number
  /**
   * Extra attributes for this range's spans. `class` is *appended* to the
   * layer's stable class (a comment thread id, an agent name); anything else
   * lands on the span verbatim — `data-*` is the intended shape.
   */
  attrs?: Record<string, string>
}

interface LayerState {
  layers: Map<DecorationLayer, DecorationSet>
  /** All layers flattened, in precedence order. What the view reads. */
  combined: DecorationSet
}

interface SetLayerMeta {
  layer: DecorationLayer
  decorations: Decoration[]
}

const layersKey = new PluginKey<LayerState>('essayDecorationLayers')

function combine(
  doc: ProseMirrorNode,
  layers: Map<DecorationLayer, DecorationSet>,
): DecorationSet {
  const all: Decoration[] = []
  for (const layer of DECORATION_LAYERS) {
    const set = layers.get(layer)
    if (set) all.push(...set.find())
  }
  return DecorationSet.create(doc, all)
}

export const DecorationLayers = Extension.create({
  name: 'essayDecorationLayers',
  addProseMirrorPlugins() {
    return [
      new Plugin<LayerState>({
        key: layersKey,
        state: {
          init: () => ({ layers: new Map(), combined: DecorationSet.empty }),
          apply(tr, value) {
            const meta = tr.getMeta(layersKey) as SetLayerMeta | undefined
            if (!meta) {
              // Typing: map, never rebuild.
              if (!tr.docChanged) return value
              const layers = new Map<DecorationLayer, DecorationSet>()
              for (const [name, set] of value.layers) {
                layers.set(name, set.map(tr.mapping, tr.doc))
              }
              return { layers, combined: value.combined.map(tr.mapping, tr.doc) }
            }
            const layers = new Map(value.layers)
            // A set transaction never changes the doc itself, but a caller
            // could batch one with an edit; map the untouched layers first so
            // both cases stay correct.
            if (tr.docChanged) {
              for (const [name, set] of layers) {
                layers.set(name, set.map(tr.mapping, tr.doc))
              }
            }
            if (meta.decorations.length === 0) layers.delete(meta.layer)
            else layers.set(meta.layer, DecorationSet.create(tr.doc, meta.decorations))
            return { layers, combined: combine(tr.doc, layers) }
          },
        },
        props: {
          decorations(state) {
            return layersKey.getState(state)?.combined ?? null
          },
        },
      }),
    ]
  },
})

/**
 * Replace one layer's ranges wholesale. Whole-state on purpose — the
 * consumers each own a recompute of their own (find's debounce, a comment
 * anchor pass), and a delta protocol would make the plugin the second place
 * that state lives.
 */
export function setDecorationLayer(
  editor: Editor,
  layer: DecorationLayer,
  ranges: DecorationRange[],
): void {
  const decorations: Decoration[] = []
  for (const range of ranges) {
    // An inverted or empty range renders nothing; dropping it here keeps the
    // set's invariants simple.
    if (!(range.to > range.from)) continue
    const { class: extra, ...rest } = range.attrs ?? {}
    decorations.push(
      Decoration.inline(range.from, range.to, {
        class: extra ? `${LAYER_CLASS[layer]} ${extra}` : LAYER_CLASS[layer],
        ...rest,
      }),
    )
  }
  editor.view.dispatch(editor.state.tr.setMeta(layersKey, { layer, decorations }))
}

export function clearDecorationLayer(editor: Editor, layer: DecorationLayer): void {
  setDecorationLayer(editor, layer, [])
}

/**
 * The layer's current ranges, mapped to wherever the document has moved them.
 * For tests and for consumers that need to know where a range is *now*
 * without keeping their own map.
 */
export function decorationLayerRanges(
  editor: Editor,
  layer: DecorationLayer,
): Array<{ from: number; to: number }> {
  const set = layersKey.getState(editor.state)?.layers.get(layer)
  if (!set) return []
  return set.find().map((deco) => ({ from: deco.from, to: deco.to }))
}
