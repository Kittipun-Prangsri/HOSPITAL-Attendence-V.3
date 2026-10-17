/**
 * Who may review (approve/reject) whose requests.
 *   admin / super → everyone
 *   department head (department_heads) → staff of those departments, never themselves
 *   anyone else → nobody
 * Cached per person for a minute; changes to department_heads clear the cache.
 */
const { pool, hosofficePool } = require('../config/db');

const TTL_MS = 60 * 1000;
const cache = new Map(); // hr_person_id → { at, scope }

const isAdmin = u => Boolean(u && (u.role === 'admin' || u.role === 'super'));

async function load(personId) {
  let deptRows;
  try {
    [deptRows] = await pool.query('SELECT department_id FROM department_heads WHERE hr_person_id = ?', [personId]);
  } catch (err) {
    return null; // before migration 010
  }
  if (!deptRows.length) return null;
  const departments = deptRows.map(r => Number(r.department_id));
  const [people] = await hosofficePool.query(
    `SELECT ID, FINGLE_ID, HR_CID FROM hr_person WHERE HR_DEPARTMENT_ID IN (?) AND ID <> ?`, [departments, personId]);
  return {
    all: false,
    departments,
    personIds: new Set(people.map(p => String(p.ID))),
    // employee ids appear as FINGLE_ID or HR_CID depending on how the person signed in
    employeeIds: new Set(people.flatMap(p => [p.FINGLE_ID, p.HR_CID].filter(Boolean).map(String)))
  };
}

/** Resolves to { all: true } | { all: false, departments, personIds, employeeIds } | null. */
async function reviewScope(user) {
  if (!user) return null;
  if (isAdmin(user)) return { all: true };
  const hit = cache.get(String(user.id));
  if (hit && Date.now() - hit.at < TTL_MS) return hit.scope;
  const scope = await load(user.id);
  cache.set(String(user.id), { at: Date.now(), scope });
  return scope;
}

/** May this scope review a request by this person? (pass hr_person_id and/or employee_id) */
function canReview(scope, { hrPersonId, employeeId } = {}) {
  if (!scope) return false;
  if (scope.all) return true;
  return (hrPersonId != null && scope.personIds.has(String(hrPersonId))) ||
    (employeeId != null && scope.employeeIds.has(String(employeeId)));
}

/** SQL fragment + params restricting a list to the scope; '' for everyone. */
function scopeFilter(scope, { personCol, employeeCol }) {
  if (!scope || scope.all) return { sql: '', params: [] };
  const persons = [...scope.personIds];
  const emps = [...scope.employeeIds];
  const parts = [];
  const params = [];
  if (personCol && persons.length) { parts.push(`${personCol} IN (?)`); params.push(persons); }
  if (employeeCol && emps.length) { parts.push(`${employeeCol} IN (?)`); params.push(emps); }
  return parts.length ? { sql: `(${parts.join(' OR ')})`, params } : { sql: '1 = 0', params: [] };
}

function clearReviewScopeCache() { cache.clear(); }

module.exports = { reviewScope, canReview, scopeFilter, clearReviewScopeCache, isAdmin };
