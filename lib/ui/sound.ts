/**
 * One quiet synthesised thump for a cube landing (no audio file, no library). `pitch` is the note's low end in Hz: the
 * cube lands a little higher on each stair, and the crash is lower and louder. Silent if the browser hasn't allowed
 * audio yet (no click on the page so far) or anything throws; sound is only ever a bonus.
 */
let ctx: AudioContext | null = null;

export function thump(pitch = 190, volume = 0.1) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state !== "running") { void ctx.resume(); return; }   // this one is lost; the next lands once audio is allowed
    const t = ctx.currentTime, osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(pitch * 2.2, t);
    osc.frequency.exponentialRampToValueAtTime(pitch, t + 0.07);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.22);
  } catch { /* no audio: carry on */ }
}
