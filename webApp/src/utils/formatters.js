/**
 * TABAK++ Formatting Utilities
 * Standardized data formatting for consistent UI presentation.
 */

/**
 * Formats a date string into a user-friendly display format.
 * Parses YYYY-MM-DD as a calendar date (UTC) so timezones never shift the day.
 * @param {string} dateString - ISO date string (YYYY-MM-DD)
 * @returns {string} Formatted date (e.g., "MON 15 JUN")
 */
export const formatDateDisplay = (dateString) => {
  if (!dateString) return '---';
  try {
    const [y, m, d] = String(dateString).split('-').map(Number);
    if (!y || !m || !d) return dateString;
    return new Date(Date.UTC(y, m - 1, d))
      .toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      })
      .toUpperCase();
  } catch {
    return dateString;
  }
};

/**
 * Converts a hex color to an RGB comma-separated string for CSS variables.
 * @param {string} hex - Hex color code
 * @returns {string} "R, G, B" string
 */
export const hexToRgbValues = (hex) => {
  try {
    const h = String(hex || '#00d2ff').trim();
    // firestore.rules accepts #abc as well as #aabbcc, so a 3-digit accent is a
    // legitimate stored value. Matching only the 6-digit form left --accent on
    // the user's color while --accent-rgb silently fell back to cyan, so
    // accent-tinted fills and glows disagreed with accent text.
    const short = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(h);
    const full = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
    const parts = full
      ? [full[1], full[2], full[3]]
      : short
        ? [short[1] + short[1], short[2] + short[2], short[3] + short[3]]
        : null;
    return parts
      ? parts.map((p) => parseInt(p, 16)).join(', ')
      : '0, 210, 255';
  } catch {
    return '0, 210, 255';
  }
};
