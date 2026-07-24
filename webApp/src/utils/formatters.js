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
    const h = hex || '#00d2ff';
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
    return result
      ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
      : '0, 210, 255';
  } catch {
    return '0, 210, 255';
  }
};
