// A spring from 0 to 1, as a CSS linear() easing plus the duration it takes
// to settle, so a Web Animation on translate/scale can move like a spring and
// still run on the compositor. Browsers without linear() get `fallback`.
export function springEasing({ stiffness, damping, mass }, fallback = { duration: 450, easing: 'cubic-bezier(0.2, 0.9, 0.1, 1)' }) {
  if (!CSS.supports('animation-timing-function', 'linear(0, 1)')) return fallback;
  const dt = 1 / 240;
  let x = 0, v = 0, t = 0;
  const samples = [0];
  while (t < 3 && (Math.abs(1 - x) > 0.001 || Math.abs(v) > 0.01)) {
    v += ((stiffness * (1 - x) - damping * v) / mass) * dt;
    x += v * dt;
    t += dt;
    samples.push(x);
  }
  samples[samples.length - 1] = 1;
  // ~60 stops are plenty for a smooth curve.
  const step = Math.max(1, Math.round(samples.length / 60));
  const stops = samples.filter((_, i) => i % step === 0 || i === samples.length - 1);
  return {
    duration: Math.round(t * 1000),
    easing: `linear(${stops.map(v => +v.toFixed(4)).join(', ')})`,
  };
}
