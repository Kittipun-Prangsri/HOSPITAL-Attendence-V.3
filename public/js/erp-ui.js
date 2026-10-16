/* ==========================================================================
   ERP UI helpers shared by Tailwind pages (personnel, attendance, users, …)
   Classes used here are picked up by tailwind.config.js `content` globs.
   ========================================================================== */
(function () {
  /* Same-origin fetch wrapper: attach the CSRF token to state-changing requests and
     send the user to the login page when the session has expired (API answers 401). */
  if (typeof window !== 'undefined' && window.fetch && !window.fetch.__erpWrapped) {
    const nativeFetch = window.fetch.bind(window);
    const tokenMeta = document.querySelector('meta[name="csrf-token"]');
    const csrfToken = tokenMeta ? tokenMeta.getAttribute('content') : '';
    const wrapped = (input, init = {}) => {
      const method = String(init.method || (input && input.method) || 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const sameOrigin = url.startsWith('/') || url.startsWith(location.origin);
      if (csrfToken && sameOrigin && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        const headers = new Headers(init.headers || (input && input.headers) || {});
        headers.set('X-CSRF-Token', csrfToken);
        init = Object.assign({}, init, { headers });
      }
      return nativeFetch(input, init).then(res => {
        if (res.status === 401 && sameOrigin && url.startsWith('/api/')) {
          window.location.href = '/login';
        }
        return res;
      });
    };
    wrapped.__erpWrapped = true;
    window.fetch = wrapped;
  }

  const TONES = {
    green: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    brand: 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200',
    amber: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
    sky: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200',
    violet: 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200',
    red: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
    slate: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200'
  };

  const AV_COLORS = ['#DB2777', '#9333EA', '#0F766E', '#1D4ED8', '#B45309', '#475569', '#0E7490', '#9D174D'];

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function badge(label, tone) {
    return `<span class="erp-badge ${TONES[tone] || TONES.slate}">${escapeHtml(label)}</span>`;
  }

  // Stable colour per key so the same person keeps the same avatar colour
  function avatarColor(key) {
    const str = String(key == null ? '' : key);
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return AV_COLORS[hash % AV_COLORS.length];
  }

  function avatar(name, key, size = 'h-8 w-8 text-xs') {
    const initial = escapeHtml((String(name || '?').trim() || '?').charAt(0));
    return `<div class="flex ${size} shrink-0 items-center justify-center rounded-md font-semibold text-white" style="background:${avatarColor(key == null ? name : key)}">${initial}</div>`;
  }

  function toast(message, tone = 'default') {
    let el = document.getElementById('erpToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'erpToast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    const bg = tone === 'error' ? 'bg-red-600' : tone === 'success' ? 'bg-emerald-700' : 'bg-slate-900';
    el.className = `erp pointer-events-none fixed bottom-6 left-1/2 z-[10002] -translate-x-1/2 rounded-md px-4 py-2.5 text-[13px] text-white shadow-lg transition-opacity ${bg}`;
    el.textContent = message;
    el.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.style.opacity = '0'; }, 2600);
  }

  /**
   * Render numbered pagination into a <ul>. `onChange(page)` fires on click.
   * Returns the clamped current page.
   */
  function pager(listEl, { page, total, perPage, onChange }) {
    const pages = Math.max(1, Math.ceil(total / perPage));
    const current = Math.min(Math.max(1, page), pages);
    const btn = (label, target, { active = false, disabled = false, aria = '' } = {}) =>
      `<li><button type="button" data-page="${target}" ${disabled ? 'disabled' : ''} ${aria ? `aria-label="${aria}"` : ''} ${active ? 'aria-current="page"' : ''}
        class="inline-flex h-7 min-w-[28px] items-center justify-center rounded px-2 text-xs ${active ? 'bg-brand-600 font-semibold text-white' : 'text-slate-600 hover:bg-slate-200'} disabled:opacity-40 disabled:hover:bg-transparent">${label}</button></li>`;
    const nums = [];
    for (let p = 1; p <= pages; p++) {
      if (p === 1 || p === pages || Math.abs(p - current) <= 1) nums.push(p);
      else if (nums[nums.length - 1] !== '…') nums.push('…');
    }
    listEl.innerHTML =
      btn('<i class="bi bi-chevron-left"></i>', current - 1, { disabled: current === 1, aria: 'หน้าก่อนหน้า' }) +
      nums.map(n => (n === '…' ? '<li class="px-1 text-slate-400">…</li>' : btn(n, n, { active: n === current }))).join('') +
      btn('<i class="bi bi-chevron-right"></i>', current + 1, { disabled: current === pages, aria: 'หน้าถัดไป' });
    listEl._onPage = onChange;
    if (!listEl._erpBound) {
      listEl._erpBound = true;
      listEl.addEventListener('click', e => {
        const b = e.target.closest('button[data-page]');
        if (b && !b.disabled && listEl._onPage) listEl._onPage(Number(b.dataset.page));
      });
    }
    return current;
  }

  function pagerText(start, count, total) {
    return total ? `แสดง ${start + 1}–${start + count} จาก ${total.toLocaleString('th-TH')} รายการ` : 'ไม่มีรายการ';
  }

  function downloadCsv(filename, header, rows) {
    const csv = [header, ...rows]
      .map(r => r.map(v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function fillSelect(select, values) {
    const current = select.value;
    select.length = 1;
    values.forEach(v => select.add(new Option(v, v)));
    if (values.includes(current)) select.value = current;
  }

  function uniqueSorted(list, key) {
    return [...new Set(list.map(x => x[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'th'));
  }

  function emptyRow(colspan, message, icon = 'bi-inbox') {
    return `<tr><td colspan="${colspan}" class="px-4 py-16 text-center text-slate-400"><i class="bi ${icon} mb-2 block text-2xl"></i>${escapeHtml(message)}</td></tr>`;
  }

  function todayIso() {
    return new Date().toLocaleDateString('sv-SE');
  }

  /** Open/close an overlay element that uses the `hidden` utility, locking page scroll. */
  function showOverlay(el, open) {
    el.classList.toggle('hidden', !open);
    document.body.style.overflow = open ? 'hidden' : '';
  }

  window.ERP = {
    TONES, escapeHtml, badge, avatar, avatarColor, toast, pager, pagerText,
    downloadCsv, fillSelect, uniqueSorted, emptyRow, todayIso, showOverlay
  };
})();
