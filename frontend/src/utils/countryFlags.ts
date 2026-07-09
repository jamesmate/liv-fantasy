/**
 * Maps the country name strings ESPN returns (e.g. "USA", "England",
 * "South Korea") to an ISO 3166-1 alpha-2 code, used to build a
 * flagcdn.com image URL.
 *
 * Emoji flags were tried first but are unreliable - many systems
 * (notably some Windows configurations) don't have a font that
 * composites the two-letter "regional indicator" characters into an
 * actual flag image, so they show as literal text like "MX" instead.
 * Using real flag images via flagcdn.com (free, no API key, served
 * over CDN) renders identically on every device regardless of OS/font
 * support.
 *
 * ESPN uses a mix of country names and a few non-ISO regional names
 * (England/Scotland/Wales/Northern Ireland instead of "United
 * Kingdom"), so this is a manual lookup table rather than a generic
 * ISO-code converter.
 */
const COUNTRY_TO_ISO: Record<string, string> = {
  USA: "us",
  England: "gb-eng",
  Scotland: "gb-sct",
  Wales: "gb-wls",
  "Northern Ireland": "gb-nir",
  Spain: "es",
  Mexico: "mx",
  Sweden: "se",
  "South Africa": "za",
  "South Korea": "kr",
  Australia: "au",
  "New Zealand": "nz",
  Germany: "de",
  France: "fr",
  Belgium: "be",
  Chile: "cl",
  Colombia: "co",
  Japan: "jp",
  India: "in",
  Poland: "pl",
  Philippines: "ph",
  Zimbabwe: "zw",
  Canada: "ca",
  Italy: "it",
  Ireland: "ie",
  Argentina: "ar",
  Denmark: "dk",
  Norway: "no",
  Austria: "at",
  Thailand: "th",
  China: "cn",
  "Chinese Taipei": "tw",
  Finland: "fi",
  Netherlands: "nl",
  Switzerland: "ch",
  Portugal: "pt",
  Venezuela: "ve",
  Paraguay: "py",
  Fiji: "fj",
};

/**
 * Returns a flagcdn.com image URL for a country name, or null if
 * unrecognized. gb-eng/gb-sct/gb-wls/gb-nir are flagcdn's supported
 * UK constituent-country codes (flagcdn hosts these even though
 * they're not standalone ISO 3166-1 codes).
 */
export function getCountryFlagUrl(countryCode: string | null | undefined): string | null {
  if (!countryCode) return null;
  const iso = COUNTRY_TO_ISO[countryCode];
  if (!iso) return null;
  return `https://flagcdn.com/24x18/${iso}.png`;
}
