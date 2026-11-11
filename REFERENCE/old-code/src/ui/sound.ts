// Buzzer sound while simulating: a soft 2.3 kHz tone made in the app
// (no sound files, nothing downloaded).

let ctx: AudioContext | null = null;
let osc: OscillatorNode | null = null;
let gain: GainNode | null = null;

/** Plays the buzzer tone at `level` (0 = silent, 1 = loudest). */
export function buzz(level: number): void {
  if (level <= 0) {
    if (gain && ctx) gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    return;
  }
  try {
    if (!ctx) {
      ctx = new AudioContext();
      gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = 2300;
      osc.connect(gain);
      osc.start();
    }
    void ctx.resume();
    gain?.gain.setTargetAtTime(0.02 + 0.05 * level, ctx.currentTime, 0.02);
  } catch {
    // No sound device: the picture still shows the buzzer working.
  }
}
