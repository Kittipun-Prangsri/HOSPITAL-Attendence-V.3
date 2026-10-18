const { DEPARTMENTS } = require('./departments');

// Single source for sidebar, breadcrumb and quick-search menu.
// access: 'all' = every signed-in user, 'admin' = admin + super, 'super' = super only,
//         'reviewer' = admin + super + department heads
const NAV_SECTIONS = [
  {
    title: 'ภาพรวม',
    items: [
      { href: '/', label: 'แดชบอร์ด', icon: 'bi-grid-1x2', access: 'all' }
    ]
  },
  {
    title: 'บริการตนเอง',
    items: [
      { href: '/schedule', label: 'ตารางเวรของฉัน', icon: 'bi-calendar-check', access: 'all' },
      { href: '/leave', label: 'การลา', icon: 'bi-calendar2-x', access: 'all' },
      { href: '/ot', label: 'ขอทำงานล่วงเวลา (OT)', icon: 'bi-stopwatch', access: 'all' },
      { href: '/excuses', label: 'แจ้งสาเหตุการลงเวลา', icon: 'bi-clipboard2-pulse', access: 'all' },
      { href: '/security', label: 'ความปลอดภัยบัญชี', icon: 'bi-shield-check', access: 'all' }
    ]
  },
  {
    title: 'บุคลากรและเวลา',
    items: [
      { href: '/personnel', label: 'ทะเบียนบุคลากร', icon: 'bi-people', access: 'admin' },
      { href: '/attendance', label: 'ตรวจสอบเข้า–ออกงาน', icon: 'bi-person-check', access: 'admin' },
      { href: '/scheduling', label: 'จัดตารางเวร', icon: 'bi-calendar2-week', access: 'admin' }
    ]
  },
  {
    title: 'รายงาน',
    items: [
      { href: '/reports', label: 'ภาพรวมการวิเคราะห์', icon: 'bi-graph-up-arrow', access: 'admin' },
      { href: '/report/daily', label: 'รายงานรายวัน', icon: 'bi-bar-chart-line', access: 'admin' },
      { href: '/report/monthly', label: 'รายงานรายเดือน', icon: 'bi-calendar3', access: 'admin' },
      { href: '/report/hours', label: 'สรุปชั่วโมงทำงาน', icon: 'bi-clock-history', access: 'admin' },
      // Department detail pages (/department/:id) are reached from this overview
      { href: '/departments', label: 'ภาพรวมกลุ่มงาน', icon: 'bi-diagram-3', access: 'admin', activePrefix: '/department' }
    ]
  },
  {
    title: 'ตั้งค่าระบบ',
    items: [
      { href: '/admin/calendar', label: 'วันหยุดและนโยบายการลา', icon: 'bi-calendar-heart', access: 'admin' },
      { href: '/admin/face', label: 'ใบหน้า / สแกนมือถือ', icon: 'bi-person-bounding-box', access: 'reviewer' },
      { href: '/admin/users', label: 'จัดการผู้เข้าใช้', icon: 'bi-person-gear', access: 'super' },
      { href: '/admin/permissions', label: 'สิทธิ์ตามบทบาท', icon: 'bi-shield-lock', access: 'super' },
      { href: '/admin/audit', label: 'บันทึกการใช้งาน', icon: 'bi-journal-text', access: 'super' },
      { href: '/flex-preview', label: 'จำลอง LINE Flex', icon: 'bi-line', access: 'super' }
    ]
  }
];

function canAccess(access, role, isHead = false) {
  if (access === 'all') return true;
  if (access === 'reviewer') return role === 'admin' || role === 'super' || Boolean(isHead);
  if (access === 'admin') return role === 'admin' || role === 'super';
  if (access === 'super') return role === 'super';
  return false;
}

function isActive(item, route) {
  return route === item.href || Boolean(item.activePrefix && route.startsWith(item.activePrefix + '/'));
}

function findNavItem(route) {
  for (const section of NAV_SECTIONS) {
    const item = section.items.find(i => i.href === route);
    if (item) return { section: section.title, item };
    const parent = section.items.find(i => isActive(i, route));
    if (parent) {
      const dept = DEPARTMENTS.find(d => `/department/${d.id}` === route);
      return { section: section.title, group: parent.label, item: { href: route, label: dept ? dept.name : parent.label } };
    }
  }
  return null;
}

module.exports = { NAV_SECTIONS, canAccess, findNavItem, isActive };
