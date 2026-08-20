(function createStaffScheduleModal(global) {
  'use strict';

  const state = {
    employee: null,
    staffId: null,
    year: null,
    month: null,
    lastFocused: null,
    previousBodyOverflow: '',
    requestId: 0
  };

  const defaultColors = ['#4f46e5', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];
  const dayNames = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  const monthNames = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

  const config = {
    apiBase: '/api/schedule/staff',
    timeZone: 'Asia/Bangkok',
    loadSchedule: null,
    getEmployees: () => typeof employees !== 'undefined' ? employees : [],
    getColors: () => typeof AV_COLORS !== 'undefined' ? AV_COLORS : defaultColors,
    getShiftDefinitions: () => typeof SHIFTS !== 'undefined' ? SHIFTS : {},
    getSettings: () => typeof loadSettings === 'function' ? loadSettings() : { shifts: [] },
    getServiceWork: () => typeof serviceWorkData !== 'undefined' ? serviceWorkData : []
  };

  const elements = {};

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
  }

  function localDateKey(date = new Date()) {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: config.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  }

  function initialize() {
    elements.modal = document.getElementById('staffScheduleModal');
    if (!elements.modal || elements.modal.dataset.initialized === 'true') return Boolean(elements.modal);

    elements.dialog = elements.modal.querySelector('.staff-schedule-dialog');
    elements.avatar = document.getElementById('staffScheduleAvatar');
    elements.name = document.getElementById('staffScheduleName');
    elements.meta = document.getElementById('staffScheduleMeta');
    elements.chips = document.getElementById('staffScheduleChips');
    elements.period = document.getElementById('staffSchedulePeriod');
    elements.calendar = document.getElementById('staffScheduleCalendar');
    elements.close = elements.modal.querySelector('[data-staff-schedule-close]');

    elements.close.addEventListener('click', close);
    elements.modal.querySelector('[data-staff-schedule-previous]').addEventListener('click', () => changeMonth(-1));
    elements.modal.querySelector('[data-staff-schedule-next]').addEventListener('click', () => changeMonth(1));
    elements.modal.addEventListener('click', event => {
      if (event.target === elements.modal) close();
    });
    elements.modal.addEventListener('keydown', trapDialogFocus);
    elements.modal.dataset.initialized = 'true';
    return true;
  }

  function configure(overrides = {}) {
    Object.assign(config, overrides);
    return api;
  }

  function findEmployee(employeeOrId) {
    if (employeeOrId && typeof employeeOrId === 'object') return employeeOrId;
    const list = config.getEmployees() || [];
    return list.find(employee => String(employee.id) === String(employeeOrId));
  }

  function statusMarkup(status) {
    const labels = {
      in: '<span class="status-chip chip-in">เข้างาน</span>',
      out: '<span class="status-chip chip-out">ออกงาน</span>',
      late: '<span class="status-chip chip-late">มาสาย</span>',
      leave: '<span class="status-chip" style="background:#fef3c7;color:#92400e;">ลา</span>',
      none: '<span class="status-chip chip-absent">ยังไม่มา</span>'
    };
    return labels[status] || '<span class="staff-schedule-chip">ไม่ระบุสถานะ</span>';
  }

  function renderEmployeeHeader(employee) {
    const list = config.getEmployees() || [];
    const configuredColors = config.getColors();
    const colors = Array.isArray(configuredColors) && configuredColors.length ? configuredColors : defaultColors;
    const colorIndex = Math.max(0, list.indexOf(employee)) % colors.length;
    const shiftDefinitions = config.getShiftDefinitions() || {};
    const shiftKey = String(employee.shift || '').toLowerCase();
    const shiftLabel = shiftDefinitions[shiftKey]?.label || employee.shift || '—';

    elements.avatar.textContent = employee.name ? employee.name.charAt(0) : '?';
    elements.avatar.style.background = colors[colorIndex] || defaultColors[0];
    elements.name.textContent = employee.name || 'ไม่ระบุชื่อ';
    elements.meta.textContent = [employee.id, employee.dept].filter(Boolean).join(' • ');
    elements.chips.innerHTML = `
      <span class="staff-schedule-chip"><i class="bi bi-person-badge" aria-hidden="true"></i>${escapeHtml(employee.role || '—')}</span>
      <span class="staff-schedule-divider" aria-hidden="true">|</span>
      <span class="staff-schedule-chip"><i class="bi bi-building" aria-hidden="true"></i>${escapeHtml(employee.dept || '—')}</span>
      <span class="staff-schedule-divider" aria-hidden="true">|</span>
      <span class="staff-schedule-chip"><i class="bi bi-clock" aria-hidden="true"></i>${escapeHtml(shiftLabel)}</span>
      <span class="staff-schedule-divider" aria-hidden="true">|</span>
      ${statusMarkup(employee.status)}
      ${employee.in ? `<span class="time-tag"><i class="bi bi-box-arrow-in-right" aria-hidden="true"></i>${escapeHtml(employee.in)}</span>` : ''}
      ${employee.out ? `<span class="time-tag out"><i class="bi bi-box-arrow-right" aria-hidden="true"></i>${escapeHtml(employee.out)}</span>` : ''}
      ${employee.hours && employee.hours !== '0' ? `<span class="status-chip chip-in"><i class="bi bi-hourglass-split" aria-hidden="true"></i>${escapeHtml(employee.hours)} ชม.</span>` : ''}
    `;
  }

  async function open(employeeOrId) {
    if (!initialize()) return false;
    const employee = findEmployee(employeeOrId);
    if (!employee) {
      console.warn('[StaffScheduleModal] Employee not found:', employeeOrId);
      return false;
    }

    state.employee = employee;
    state.staffId = String(employee.id);
    const now = new Date();
    state.year = now.getFullYear();
    state.month = now.getMonth() + 1;
    if (elements.modal.hidden) {
      state.lastFocused = document.activeElement;
      state.previousBodyOverflow = document.body.style.overflow;
    }

    renderEmployeeHeader(employee);
    elements.modal.hidden = false;
    document.body.style.overflow = 'hidden';
    elements.close.focus({ preventScroll: true });
    await renderCalendar();
    return true;
  }

  function close() {
    if (!initialize() || elements.modal.hidden) return;
    state.requestId += 1;
    elements.modal.hidden = true;
    document.body.style.overflow = state.previousBodyOverflow;
    if (state.lastFocused && typeof state.lastFocused.focus === 'function') state.lastFocused.focus({ preventScroll: true });
  }

  function changeMonth(delta) {
    state.month += delta;
    if (state.month > 12) { state.month = 1; state.year += 1; }
    if (state.month < 1) { state.month = 12; state.year -= 1; }
    renderCalendar();
  }

  function changePeriod() {
    const monthSelect = document.getElementById('staffScheduleMonth');
    const yearSelect = document.getElementById('staffScheduleYear');
    state.month = Number(monthSelect.value);
    state.year = Number(yearSelect.value);
    renderCalendar();
  }

  function trapDialogFocus(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(elements.modal.querySelectorAll('button:not([disabled]), select:not([disabled]), [href]'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function renderPeriodSelectors() {
    const currentYear = new Date().getFullYear();
    const monthOptions = monthNames.slice(1).map((name, index) =>
      `<option value="${index + 1}" ${index + 1 === state.month ? 'selected' : ''}>${name}</option>`
    ).join('');
    const yearOptions = Array.from({ length: 11 }, (_, index) => currentYear - 5 + index).map(year =>
      `<option value="${year}" ${year === state.year ? 'selected' : ''}>${year + 543}</option>`
    ).join('');

    elements.period.innerHTML = `
      <select id="staffScheduleMonth" class="staff-schedule-period-select" aria-label="เดือน">${monthOptions}</select>
      <select id="staffScheduleYear" class="staff-schedule-period-select" aria-label="ปี">${yearOptions}</select>
    `;
    document.getElementById('staffScheduleMonth').addEventListener('change', changePeriod);
    document.getElementById('staffScheduleYear').addEventListener('change', changePeriod);
  }

  function getShiftStyles() {
    const defaults = [
      { name: 'เช้า', color: '#f59e0b' },
      { name: 'บ่าย', color: '#2563eb' },
      { name: 'ดึก', color: '#7c3aed' }
    ];
    const settings = config.getSettings() || {};
    const shifts = Array.isArray(settings.shifts) && settings.shifts.length ? settings.shifts : defaults;
    const styles = {};
    shifts.forEach(shift => {
      if (shift.name === 'เช้า') styles[shift.name] = { cls: 'morning', bg: '#fffbeb', text: '#92400e' };
      else if (shift.name === 'บ่าย') styles[shift.name] = { cls: 'afternoon', bg: '#eff6ff', text: '#1e40af' };
      else if (shift.name === 'ดึก') styles[shift.name] = { cls: 'night', bg: '#f5f3ff', text: '#5b21b6' };
      else styles[shift.name] = { cls: '', bg: '#dcfce7', text: '#166534' };
    });
    return styles;
  }

  function fallbackTodayData(leaveDays, timesMap) {
    const now = new Date();
    if (state.month !== now.getMonth() + 1 || state.year !== now.getFullYear()) return;
    const day = now.getDate();
    const serviceWork = config.getServiceWork() || [];
    const work = serviceWork.find(entry => entry.name === state.employee?.name);
    if (work) {
      const leave = (work.morning && !/^\d{2}:\d{2}/.test(work.morning)) || (work.afternoon && !/^\d{2}:\d{2}/.test(work.afternoon));
      if (leave) leaveDays[day] = true;
    }
    if (state.employee?.in) timesMap[day] = { in: state.employee.in, out: state.employee.out };
  }

  async function loadScheduleData(requestId) {
    const shiftMap = {};
    const leaveDays = {};
    const timesMap = {};
    const yearMonth = `${state.year}-${String(state.month).padStart(2, '0')}`;

    try {
      let data;
      if (typeof config.loadSchedule === 'function') {
        data = await config.loadSchedule({
          staffId: state.staffId,
          year: state.year,
          month: state.month,
          yearMonth
        });
      } else {
        const response = await fetch(`${config.apiBase.replace(/\/$/, '')}/${encodeURIComponent(state.staffId)}/${yearMonth}`, {
          headers: { Accept: 'application/json' },
          credentials: 'same-origin'
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = await response.json();
      }
      if (!data || typeof data !== 'object') throw new Error('Invalid schedule response');
      if (requestId !== state.requestId) return null;
      (data.shifts || []).forEach(item => { shiftMap[item.day] = item.shift; });
      (data.leaves || []).forEach(item => { leaveDays[item.day] = item.reason || true; });
      (data.times || []).forEach(item => { timesMap[item.day] = { in: item.time_in, out: item.time_out }; });
    } catch (error) {
      console.warn('[StaffScheduleModal] Schedule request failed; showing available local data.', error.message);
      fallbackTodayData(leaveDays, timesMap);
    }
    return { shiftMap, leaveDays, timesMap };
  }

  async function renderCalendar() {
    if (!initialize() || !state.staffId) return;
    const requestId = ++state.requestId;
    renderPeriodSelectors();
    elements.calendar.innerHTML = '<div class="loading-state" style="grid-column:1/-1;min-height:220px;"><span class="spinner-border spinner-border-sm" aria-hidden="true"></span><span>กำลังโหลดตารางเวร…</span></div>';
    const data = await loadScheduleData(requestId);
    if (!data || requestId !== state.requestId) return;

    const { shiftMap, leaveDays, timesMap } = data;
    const shiftStyles = getShiftStyles();
    const daysInMonth = new Date(state.year, state.month, 0).getDate();
    const firstDay = new Date(state.year, state.month - 1, 1).getDay();
    const today = localDateKey();
    let html = dayNames.map(name => `<div class="staff-schedule-weekday">${name}</div>`).join('');
    html += Array.from({ length: firstDay }, () => '<div class="staff-schedule-empty-day" aria-hidden="true"></div>').join('');

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(state.year, state.month - 1, day);
      const dateKey = `${state.year}-${String(state.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const leaveEntry = leaveDays[day];
      const isLeave = Boolean(leaveEntry);
      const leaveReason = typeof leaveEntry === 'string' ? leaveEntry : '';
      const shift = shiftMap[day];
      const times = timesMap[day];
      const shiftStyle = shiftStyles[shift];
      const classes = [
        'staff-schedule-day',
        isLeave ? 'leave' : (shiftStyle?.cls || (date.getDay() === 0 || date.getDay() === 6 ? 'weekend' : '')),
        dateKey === today ? 'today' : ''
      ].filter(Boolean).join(' ');

      let shiftMarkup = '<span class="staff-schedule-off">OFF</span>';
      if (isLeave) {
        const leaveLabel = leaveReason || 'ลา';
        const titleAttr = leaveReason ? ` title="${escapeHtml(leaveReason)}"` : '';
        shiftMarkup = `<span class="staff-schedule-shift" style="background:#fef3c7;color:#92400e;"${titleAttr}>${escapeHtml(leaveLabel)}</span>`;
      } else if (shift) {
        const style = shiftStyle || { bg: '#dcfce7', text: '#166534' };
        shiftMarkup = `<span class="staff-schedule-shift" style="background:${style.bg};color:${style.text};">${escapeHtml(shift)}</span>`;
      }

      let timeMarkup = '';
      if (times?.in) timeMarkup += `<span class="staff-schedule-time"><i class="bi bi-box-arrow-in-right" style="color:#166534" aria-hidden="true"></i>${escapeHtml(String(times.in).substring(0, 5))}</span>`;
      if (times?.out && times.out !== times.in) timeMarkup += `<span class="staff-schedule-time"><i class="bi bi-box-arrow-right" style="color:#b91c1c" aria-hidden="true"></i>${escapeHtml(String(times.out).substring(0, 5))}</span>`;

      html += `<div class="${classes}"><span class="staff-schedule-day-number">${day}</span>${shiftMarkup}${timeMarkup}</div>`;
    }
    elements.calendar.innerHTML = html;
  }

  const api = { configure, open, close, changeMonth, render: renderCalendar };
  global.StaffScheduleModal = api;
  global.viewStaff = employeeOrId => api.open(employeeOrId);
  global.closeStaffModal = close;
  global.smChangeMonth = changeMonth;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})(window);
