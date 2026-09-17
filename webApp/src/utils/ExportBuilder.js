/**
 * Web-side export serialization — parity with Android ExportBuilder.kt.
 * Both formats embed the full `generatedAt` ISO-8601 stamp and the complete
 * snapshot returned by RegistryService.readCompleteExportSnapshot.
 *
 * JSON format: spec item 2 — full state, deterministic field order.
 * CSV format:  spec item 3 — full activity log (day counts + manual entries)
 *              with stamped historical economics where available.
 */


/**
 * Build a deterministic JSON blob from a complete export snapshot.
 * Mirrors Android ExportBuilder.buildJson exactly.
 * @param {object} snapshot - CompleteExportSnapshot from RegistryService
 * @param {string} generatedAt - optional override ISO string (rare)
 * @returns {string} canonical JSON string
 */
export function buildJson(snapshot, generatedAt = null) {
  const ts = generatedAt || new Date().toISOString();

  const orderedConfigs = (snapshot.configs || [])
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0) || (a.id || '').localeCompare(b.id || ''))
    .map((c) => {
      const obj = {
        id: c.id,
        name: c.name,
        limit: c.limit,
        order: c.order,
      };
      if (c.type !== undefined) obj.type = c.type;
      if (c.pricePerUnit !== undefined) obj.pricePerUnit = c.pricePerUnit;
      if (c.isFinanciallyTracked !== undefined) obj.isFinanciallyTracked = c.isFinanciallyTracked;
      if (c.baseline !== undefined && c.baseline !== null) obj.baseline = c.baseline;
      if (c.createdAt !== undefined) obj.createdAt = c.createdAt;
      if (c.updatedAt !== undefined) obj.updatedAt = c.updatedAt;
      return obj;
    });

  const orderedDays = (snapshot.days || [])
    .slice()
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .map((d) => {
      const obj = {
        date: d.date,
        counts: d.counts || {},
      };
      if (d.trackerSnapshots !== undefined && Object.keys(d.trackerSnapshots).length > 0) {
        obj.trackerSnapshots = d.trackerSnapshots;
      }
      if (d.aggregateCredit !== undefined) obj.aggregateCredit = d.aggregateCredit;
      if (d.status !== undefined) obj.status = d.status;
      if (d.createdAt !== undefined) obj.createdAt = d.createdAt;
      if (d.updatedAt !== undefined) obj.updatedAt = d.updatedAt;
      if (d.closedAt !== undefined) obj.closedAt = d.closedAt;
      return obj;
    });

  const orderedLogs = (snapshot.logs || [])
    .slice()
    .sort((a, b) => {
      if (a.logDate !== b.logDate) return a.logDate.localeCompare(b.logDate);
      return (a.id || '').localeCompare(b.id || '');
    })
    .map((l) => {
      const obj = {
        id: l.id,
        logDate: l.logDate,
        counts: l.counts || {},
      };
      if (l.isArchive !== undefined) obj.isArchive = l.isArchive;
      if (l.isManual !== undefined) obj.isManual = l.isManual;
      if (l.origin !== undefined) obj.origin = l.origin;
      if (l.aggregateCredit !== undefined) obj.aggregateCredit = l.aggregateCredit;
      if (l.finalizedAt !== undefined) obj.finalizedAt = l.finalizedAt;
      if (l.clientTimestamp !== undefined) obj.clientTimestamp = l.clientTimestamp;
      return obj;
    });

  const exportDoc = {
    exportVersion: snapshot.exportVersion || 1,
    generatedAt: ts,
    application: { name: 'Tabakpp' },
    profile: snapshot.profile ? {
      name: snapshot.profile.name || '',
      unitPrice: snapshot.profile.unitPrice || 0.5,
      unitsPerPack: snapshot.profile.unitsPerPack || 20,
      pouchPrice: snapshot.profile.pouchPrice || 0.0,
      estimatedYield: snapshot.profile.estimatedYield || 0,
      dayStartHour: snapshot.profile.dayStartHour || 6,
      accent: snapshot.profile.accent || '#FF5F5F',
      widgetSize: snapshot.profile.widgetSize || 'MEDIUM',
      purchaseType: snapshot.profile.purchaseType || 'PACK',
      activeCounts: snapshot.profile.activeCounts || {},
      lifetimeAggregates: snapshot.profile.lifetimeAggregates || null,
      smokingUnitsMigrated: snapshot.profile.smokingUnitsMigrated || false,
      avatar: snapshot.profile.avatar || null,
      schemaVersion: snapshot.profile.schemaVersion || 0,
      migratingLegacyCounts: snapshot.profile.migratingLegacyCounts || {},
      migratingLegacyDate: snapshot.profile.migratingLegacyDate || null,
      createdAt: snapshot.profile.createdAt || null,
      updatedAt: snapshot.profile.updatedAt || null,
    } : null,
    profileMeta: snapshot.profileMeta ? {
      avatar: (snapshot.profileMeta && snapshot.profileMeta.avatar) || null,
    } : null,
    configs: orderedConfigs,
    days: orderedDays,
    logs: orderedLogs,
  };

  return JSON.stringify(exportDoc, null, 2);
}

/**
 * Build a CSV export of historical activity.
 *
 * Mirrors Android ExportBuilder.buildCsv — one row per tracker per date.
 * Provenance is preserved via the `source` column. Historical economics use
 * stamped snapshots when available; otherwise numeric fields are blank (null).
 *
 * @param {object} snapshot - CompleteExportSnapshot
 * @param {number} defaultUnitPrice - fallback price for missing config prices
 * @returns {string} CSV string
 */
export function buildCsv(snapshot, defaultUnitPrice = 0.5) {
  const configs = snapshot.configs || [];
  const configById = {};
  configs.forEach((c) => {
    configById[c.id] = c;
  });

  const rows = [];

  // Day documents: use stamped trackerSnapshots for historical economics (spec item 9)
  const sortedDays = (snapshot.days || []).slice().sort((a, b) =>
    (a.date || '').localeCompare(b.date || '')
  );
  for (const day of sortedDays) {
    const counts = day.counts || {};
    const snapshots = day.trackerSnapshots || {};
    for (const [trackerId, count] of Object.entries(counts)) {
      const snap = snapshots[trackerId];
      const config = configById[trackerId];
      const countVal = count;
      const econ = computeDayEconomics(countVal, snap, config, defaultUnitPrice);
      rows.push({
        date: day.date,
        source: 'day',
        trackerId: trackerId,
        trackerName: (snap && snap.name) || (config && config.name) || null,
        count: countVal,
        target: (snap && snap.target) || (config && config.limit) || null,
        baseline: (snap && snap.baseline) || (config && config.baseline) || null,
        unitPrice: (snap && snap.unitPrice) || (config && config.pricePerUnit) || null,
        spent: econ.spent,
        saved: econ.saved,
        status: day.status || null,
      });
    }
  }

  // Logs: manual entries and legacy archives
  const sortedLogs = (snapshot.logs || []).slice().sort((a, b) => {
    const da = new Date(a.logDate).getTime();
    const db = new Date(b.logDate).getTime();
    if (da !== db) return da - db;
    return (a.id || '').localeCompare(b.id || '');
  });
  for (const log of sortedLogs) {
    const isArchive =
      log.origin === 'DAY_RESET' || (log.id || '').endsWith('_DAY');
    const source = isArchive ? 'legacy_day_archive' : 'manual_entry';
    const counts = log.counts || {};
    for (const [trackerId, count] of Object.entries(counts)) {
      const config = configById[trackerId];
      const countVal = count;
      // Logs do not carry stamped economics — null where unavailable (spec item 9)
      rows.push({
        date: log.logDate,
        source: source,
        trackerId: trackerId,
        trackerName: config ? config.name : null,
        count: countVal,
        target: null,
        baseline: null,
        unitPrice: null,
        spent: null,
        saved: null,
        status: null,
      });
    }
  }

  // Header
  const header = [
    'date',
    'source',
    'tracker_id',
    'tracker_name',
    'count',
    'target',
    'baseline',
    'unit_price',
    'spent',
    'saved',
    'status',
  ];
  const lines = [header.join(',')];

  for (const row of rows) {
    const csvRow = [
      csvField(row.date),
      csvField(row.source),
      csvField(row.trackerId),
      csvField(row.trackerName),
      csvField(row.count),
      csvIntField(row.target),
      csvIntField(row.baseline),
      csvField(row.unitPrice),
      csvField(row.spent),
      csvField(row.saved),
      csvField(row.status),
    ];
    lines.push(csvRow.join(','));
  }

  return lines.join('\n');
}

/**
 * Compute spent/saved from stamped snapshot values, or null when
 * historical economics are unavailable (spec item 9: do not use current
 * config to fill historical values).
 */
function computeDayEconomics(count, snap, config, defaultUnitPrice) {
  if (!snap) {
    // No stamped snapshot — cannot compute historical economics without risk
    return { spent: null, saved: null };
  }
  const price =
    snap.unitPrice != null
      ? snap.unitPrice
      : defaultUnitPrice;
  const target = snap.target;
  const actual = Math.max(0, count || 0);
  const isFinanciallyTracked = snap.isFinanciallyTracked !== undefined ? snap.isFinanciallyTracked : true;
  const spent = isFinanciallyTracked ? actual * price : null;
  const saved = isFinanciallyTracked
    ? Math.max(0, (target || 0) - actual) * price
    : null;
  return { spent, saved };
}

/**
 * Proper CSV field serializer (spec item 11):
 * - Fields containing comma, quote, CR, or LF are wrapped in double quotes
 * - Internal double-quotes are doubled
 * - Null fields become empty strings
 * - Formula-prefix neutralization for user-controlled text cells (spec item 12)
 */
function csvField(value) {
  if (value === null || value === undefined) return '';
  let s = stringValue(value);
  if (s === '') return '';
  // Formula-injection neutralization (spec item 12): prefix with single quote
  // so spreadsheet software treats it as text, not a formula.
  // Only applies to string values that originate from user input.
  // Numeric fields pass through unchanged.
  if (typeof value === 'string') {
    s = neutralizeFormula(s);
  }
  // Standard CSV escaping (spec item 11)
  if (
    s.indexOf(',') !== -1 ||
    s.indexOf('"') !== -1 ||
    s.indexOf('\n') !== -1 ||
    s.indexOf('\r') !== -1
  ) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Format a numeric value as a string matching Kotlin's Double.toString() semantics (spec item 10):
 * - Whole-number doubles (e.g. 3.0) render as "3.0", not "3"
 * - Other doubles use JS default string representation
 * - Strings pass through
 */
function stringValue(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toFixed(1);
    return String(value);
  }
  return String(value);
}

/**
 * Format an Int value for CSV (spec item 10): integers render without decimal
 * (e.g. "20", not "20.0"), matching Kotlin's Int.toString().
 */
function csvIntField(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (s.includes('.') || s.includes('e') || s.includes('E')) {
    s = String(Math.trunc(Number(value)));
  }
  if (s === '') return '';
  if (s.length > 0 && (s[0] === '=' || s[0] === '+' || s[0] === '-' || s[0] === '@' || s[0] === '\t' || s[0] === '\r')) {
    s = "'" + s;
  }
  if (
    s.indexOf(',') !== -1 ||
    s.indexOf('"') !== -1 ||
    s.indexOf('\n') !== -1 ||
    s.indexOf('\r') !== -1
  ) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Neutralize formula-injection vectors by prefixing with a single quote
 * (spec item 12). Does NOT modify the stored value — only the CSV representation.
 */
function neutralizeFormula(value) {
  if (
    value.length > 0 &&
    (value[0] === '=' || value[0] === '+' || value[0] === '-' || value[0] === '@')
  ) {
    return "'" + value;
  }
  return value;
}
