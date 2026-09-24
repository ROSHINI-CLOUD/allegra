/**
 * The Web Audio graph behind the main <audio> element:
 *
 *   element → source → dry ┐
 *                          ├→ bus → destination
 *   (karaoke instrumental) ┘
 *
 * createMediaElementSource works once per element and cannot be undone, so the graph is
 * built once, cached on the element, and shared by every feature that needs it. After
 * that the element is only audible while the context runs, so the context is resumed on
 * every play.
 *
 * Build it from a user gesture (a click handler) so the context starts running.
 */
export interface ElementGraph {
  readonly context: AudioContext;
  readonly source: MediaElementAudioSourceNode;
  /** The element's own audio. Karaoke turns this down where it plays the instrumental. */
  readonly dry: GainNode;
  /** Everything audible passes through here; analysers tap it. */
  readonly bus: GainNode;
}

interface ElementWithGraph extends HTMLAudioElement {
  __allegraGraph?: ElementGraph;
}

type AudioContextCtor = new () => AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  const scope = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/**
 * Resume unless running or closed. Safari and Chrome 136+ also park a context in
 * "interrupted" (phone call, screen lock, another app taking audio), and a check for
 * "suspended" alone would leave the whole player silent after one.
 */
function wake(context: AudioContext): void {
  const state: string = context.state;
  if (state !== 'running' && state !== 'closed') void context.resume().catch(() => undefined);
}

export function ensureElementGraph(audio: HTMLAudioElement): ElementGraph | null {
  const el = audio as ElementWithGraph;
  if (el.__allegraGraph) {
    wake(el.__allegraGraph.context);
    return el.__allegraGraph;
  }
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;
  try {
    const context = new Ctor();
    const source = context.createMediaElementSource(audio);
    const dry = context.createGain();
    const bus = context.createGain();
    source.connect(dry).connect(bus).connect(context.destination);
    const graph: ElementGraph = { context, source, dry, bus };
    el.__allegraGraph = graph;
    audio.addEventListener('play', () => wake(context));
    wake(context);
    return graph;
  } catch {
    // No graph: the element keeps playing directly and features that need one opt out.
    return null;
  }
}
