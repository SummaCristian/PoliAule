// The app's current accent colour, for the star burst's one tinted shade.
export function getAccentColor() {
  const c = getComputedStyle(document.documentElement).getPropertyValue('--text-color-accent').trim();
  return c || '#f59e0b';
}
