/** Words that stay lowercase inside a title, unless they open or close it. */
const MINOR = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into",
  "nor", "of", "on", "onto", "or", "over", "per", "the", "to", "up", "via",
  "with", "within",
]);

/**
 * Turns a block-capitals title into title case, and leaves anything else alone.
 *
 * Cambodian thesis covers are set in full capitals, so that is what the cover
 * reader returns and what earlier uploads already stored. Rendered at heading
 * size a 150-character all-caps title is close to unreadable and roughly a
 * third wider than the same words in mixed case.
 *
 * A string containing any lowercase letter is returned untouched, so a title
 * someone typed by hand is never second-guessed.
 */
export function titleCase(value: string): string {
  if (!value || value !== value.toUpperCase()) return value;

  const words = value.toLowerCase().split(/(\s+)/); // keeps the separators
  const wordIndexes = words
    .map((w, i) => (w.trim() ? i : -1))
    .filter((i) => i !== -1);
  const first = wordIndexes[0];
  const last = wordIndexes[wordIndexes.length - 1];

  return words
    .map((word, index) => {
      if (!word.trim()) return word;

      // Anything the cover put in brackets is an acronym - (ASYAC), (RUA) -
      // and gets its capitals back.
      const bracketed = word.match(/^([([{]+)(.*?)([)\]}]*[,.;:]?)$/);
      if (bracketed && bracketed[1]) {
        return bracketed[1] + bracketed[2].toUpperCase() + bracketed[3];
      }

      const core = word.replace(/[^a-z0-9'’-]/g, "");
      if (MINOR.has(core) && index !== first && index !== last) return word;

      // Capitalise after a space, and after a hyphen or slash inside a word,
      // so "socio-economic" and "and/or" both come out right.
      return word.replace(
        /(^|[-/(])([a-z])/g,
        (_, sep: string, ch: string) => sep + ch.toUpperCase(),
      );
    })
    .join("");
}
