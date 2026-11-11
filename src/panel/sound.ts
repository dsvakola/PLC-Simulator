// Quiet sounds for a buzzer or hooter that is on while the simulation runs.
// Made with the Web Audio API, so no sound files are needed.

let ctx: AudioContext | null = null;
let buzz: { osc: OscillatorNode; gain: GainNode } | null = null;
let hoot: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null = null;

const VOLUME = 0.035;

function audio(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function fade(g: GainNode, to: number): void {
  if (!ctx) return;
  g.gain.cancelScheduledValues(ctx.currentTime);
  g.gain.setTargetAtTime(to, ctx.currentTime, 0.02);
}

/** Switches the buzzer and hooter sounds on or off. */
export function setSounds(buzzer: boolean, hooter: boolean): void {
  if (buzzer && !buzz) {
    const a = audio();
    if (a) {
      const osc = a.createOscillator();
      const gain = a.createGain();
      osc.type = "square";
      osc.frequency.value = 2300;
      gain.gain.value = 0;
      osc.connect(gain).connect(a.destination);
      osc.start();
      fade(gain, VOLUME * 0.5);
      buzz = { osc, gain };
    }
  } else if (!buzzer && buzz) {
    const b = buzz;
    buzz = null;
    fade(b.gain, 0);
    b.osc.stop((ctx?.currentTime ?? 0) + 0.15);
  }
  if (hooter && !hoot) {
    const a = audio();
    if (a) {
      const osc = a.createOscillator();
      const lfo = a.createOscillator();
      const depth = a.createGain();
      const gain = a.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = 520;
      lfo.frequency.value = 2.5;
      depth.gain.value = 140;
      lfo.connect(depth).connect(osc.frequency);
      gain.gain.value = 0;
      osc.connect(gain).connect(a.destination);
      osc.start();
      lfo.start();
      fade(gain, VOLUME);
      hoot = { osc, lfo, gain };
    }
  } else if (!hooter && hoot) {
    const h = hoot;
    hoot = null;
    fade(h.gain, 0);
    const t = (ctx?.currentTime ?? 0) + 0.15;
    h.osc.stop(t);
    h.lfo.stop(t);
  }
}
