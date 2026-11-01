// π's digits, for Pi Day's search (components/pi-day.js has the rest of the
// day). A query that is a run of them is answered with how many decimals were
// right before the first mistake.

// The first 200 decimals, after the 3
const PI_DECIMALS = '14159265358979323846264338327950288419716939937510582097494459230781640628620899862803482534211706798214808651328230664709384460955058223172535940812848111745028410270193852110555964462294895493038196';

// "3.14159…" one glyph at a time, `max` of them at most (the 15:14 run along
// the screen in components/pi-day.js takes as many as fit)
export function piGlyphs(max) {
  return ('3.' + PI_DECIMALS).slice(0, max);
}

// A few decimals at least, so "3.14" (or a room's "3.1.4") is just a search
const MIN_TYPED = 4;

// null unless the whole query is "3.14159…" (comma too, spaces between
// groups of digits ignored); else { typed, right, wrong, beyond }:
// how many decimals were typed and how many of them were right, the first
// mistake ({ got, expected }) if any, and whether every decimal we know was
// right and there were more.
export function checkPiDigits(query) {
  const m = /^3[.,](\d+)$/.exec(query.replace(/\s+/g, ''));
  if (!m || m[1].length < MIN_TYPED) return null;
  const typed = m[1];
  let right = 0;
  while (right < typed.length && right < PI_DECIMALS.length && typed[right] === PI_DECIMALS[right]) right++;
  const wrong = right < typed.length && right < PI_DECIMALS.length ? { got: typed[right], expected: PI_DECIMALS[right] } : null;
  return { typed: typed.length, right, wrong, beyond: !wrong && typed.length > PI_DECIMALS.length };
}
