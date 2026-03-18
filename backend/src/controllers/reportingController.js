import { query } from '../db.js';
import { getMonthlyKpiDashboardReport } from '../services/monthlyKpiDashboardService.js';

export async function getMonthlyKpiDashboard(req, res) {
  try {
    const report = await getMonthlyKpiDashboardReport({
      month: req.query?.month,
      queryFn: query,
    });
    return res.json({ ok: true, report });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({
        ok: false,
        error: error.message,
        details: error.details || null,
      });
    }
    console.error(error);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}
