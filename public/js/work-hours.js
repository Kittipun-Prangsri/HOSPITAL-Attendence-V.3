/* Work-hours calculation from HOSoffice service_work_scans rows.
   Shared by the hours-summary page (browser) and unit tests (Node). */
(function (root) {
  const TIME_RE = /^(\d{1,2}):(\d{2})/;

  function toMinutes(value) {
    const m = TIME_RE.exec(String(value == null ? '' : value).trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  // Duration between two clock times; an end before the start means the shift crossed midnight
  function spanHours(inValue, outValue) {
    const a = toMinutes(inValue);
    const b = toMinutes(outValue);
    if (a == null || b == null || a === b) return 0;
    const mins = b > a ? b - a : b + 1440 - a;
    return mins > 16 * 60 ? 0 : mins / 60; // >16h between punches is a missing scan, not a shift
  }

  /**
   * Per-day hours for one person.
   * template '1' (normal): morning di{d} → afternoon do{d}
   * template '2' (8-hour shifts): dmi/dmo + dai/dao + dni/dno pairs
   */
  function dailyHours(rows, template, daysInMonth) {
    const m = rows.morning || {};
    const a = rows.afternoon || {};
    const n = rows.night || {};
    const out = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const hours = template === '2'
        ? spanHours(m['dmi' + d], m['dmo' + d]) + spanHours(a['dai' + d], a['dao' + d]) + spanHours(n['dni' + d], n['dno' + d])
        : spanHours(m['di' + d], a['do' + d]);
      out.push(Math.round(hours * 100) / 100);
    }
    return out;
  }

  function summarizeHours(perDay, otThreshold) {
    const worked = perDay.filter(h => h > 0);
    const total = worked.reduce((s, h) => s + h, 0);
    const ot = worked.reduce((s, h) => s + Math.max(0, h - otThreshold), 0);
    return {
      days: worked.length,
      total: Math.round(total * 10) / 10,
      avg: worked.length ? Math.round((total / worked.length) * 10) / 10 : 0,
      ot: Math.round(ot * 10) / 10,
      max: worked.length ? Math.max(...worked) : 0
    };
  }

  const api = { toMinutes, spanHours, dailyHours, summarizeHours };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WorkHours = api;
})(typeof window !== 'undefined' ? window : globalThis);
