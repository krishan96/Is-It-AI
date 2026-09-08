/**
 * Reverse-image-search link-outs. Free, no API key, and often more conclusive
 * than any probability: finding the original beats guessing at pixels.
 *
 * These engines need a public URL or their own upload flow, so we send the user
 * to the upload page rather than pretending we can hand over a local file.
 */
export const REVERSE_SEARCH_ENGINES = [
  { name: 'Google Lens', url: 'https://lens.google.com/upload', note: 'Broadest index; good for stock and news photos' },
  { name: 'TinEye', url: 'https://tineye.com/', note: 'Sorts by oldest match — useful for finding the original' },
  { name: 'Yandex', url: 'https://yandex.com/images/', note: 'Strongest on faces and near-duplicate crops' },
];
