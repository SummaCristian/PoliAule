// Hidden search keywords. Typing one of `keywords` as the whole query (case,
// accents and extra spaces ignored) puts its classrooms first, the first one
// as the Top Hit under an egg label instead of "Top Hit". Partial words and
// typos never match, and the keywords stay out of the typo vocabulary, so an
// egg can't surface during an ordinary search. See classroom-search-data.js.
//
// `rooms`: classroom ids (from data/classrooms.json), not names — ids are what
//   favourites and photos key on, and they don't change when a room is renamed.
// `note` (optional): replaces the row's building line; a string, or
//   { en, it } per language.
//
// Example:
//   { keywords: ['nap room', 'pisolino'], rooms: [1234], note: { en: 'Shh.', it: 'Silenzio.' } },
export const EASTER_EGGS = [
  {
    keywords: [
      'chiesa',
      'church',
      'scomoda',
      'scomodo',
      'uncomfortable',
      'legno',
      'wood'
    ], rooms: [
      10,   // 6.0.1
      33,   // 2.0.2
      28,   // 8.1.1
      8,    // 9.0.2
      5,    // 7.1.2
    ], note: {
      en: 'Pain everywhere.',
      it: 'Dolori ovunque.'
    }
  },
];
