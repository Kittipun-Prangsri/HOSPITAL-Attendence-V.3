const { buildHrWorkbook } = require('../services/hrExport');
const { logAudit } = require('../utils/audit');

/** GET /api/report/monthly/hr-export?month=&year=&department= — the monthly HR pack as .xlsx (admins). */
exports.hrExport = async (req, res) => {
  const month = Number(req.query.month);
  const year = Number(req.query.year);
  const department = typeof req.query.department === 'string' ? req.query.department.trim().slice(0, 150) : '';
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) {
    return res.status(400).json({ success: false, error: 'เดือน/ปีไม่ถูกต้อง' });
  }
  try {
    const { buffer, filename, rows } = await buildHrWorkbook({ year, month, department: department || null, generatedBy: req.session.user.fullname });
    logAudit(req, 'export', 'hr_monthly_report', `${year}-${String(month).padStart(2, '0')}`, { department: department || undefined, rows });
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="khh-hrm-${year}-${String(month).padStart(2, '0')}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, no-store'
    });
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[report] hr export failed:', err);
    res.status(500).json({ success: false, error: 'สร้างไฟล์รายงานไม่สำเร็จ' });
  }
};
