import { query } from '../db.js';

export async function listCustomers(req, res) {
  try {
    const { rows } = await query(
      `
        SELECT
          id,
          full_name,
          created_at
        FROM customers
        WHERE lower(trim(full_name)) NOT IN ('test user', 'unknown')
        ORDER BY created_at DESC
        LIMIT 200
      `
    );

    return res.json({ ok: true, rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

export async function getCustomerProfile(req, res) {
  const customerId = req.params.customerId;
  if (!customerId) {
    return res.status(400).json({ ok: false, error: 'Missing customerId' });
  }

  try {
    const customerResult = await query(
      `
        SELECT
          id,
          full_name,
          created_at
        FROM customers
        WHERE id = $1
        LIMIT 1
      `,
      [customerId]
    );

    if (customerResult.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Customer not found' });
    }

    let packages = [];
    try {
      const packagesResult = await query(
        `
          SELECT
            cp.id AS customer_package_id,
            cp.status,
            cp.purchased_at,
            NULLIF((to_jsonb(cp) ->> 'expires_at'), '')::timestamptz AS expires_at,
            p.code AS package_code,
            p.title AS package_title,
            p.sessions_total,
            p.mask_total,
            p.price_thb,
            COALESCE(u.sessions_used, 0) AS sessions_used,
            COALESCE(u.mask_used, 0) AS mask_used
          FROM customer_packages cp
          JOIN packages p ON p.id = cp.package_id
          LEFT JOIN (
            SELECT
              customer_package_id,
              COUNT(*)::int AS sessions_used,
              COUNT(*) FILTER (WHERE used_mask IS TRUE)::int AS mask_used
            FROM package_usages
            GROUP BY customer_package_id
          ) u ON u.customer_package_id = cp.id
          WHERE cp.customer_id = $1
          ORDER BY cp.purchased_at DESC NULLS LAST
        `,
        [customerId]
      );

      packages = packagesResult.rows.map((row) => {
      const sessionsTotal = Number(row.sessions_total) || 0;
      const maskTotal = Number(row.mask_total) || 0;
      const sessionsUsed = Number(row.sessions_used) || 0;
      const maskUsed = Number(row.mask_used) || 0;

      return {
        customer_package_id: row.customer_package_id,
        status: row.status || 'active',
        purchased_at: row.purchased_at,
        expires_at: row.expires_at,
        package: {
          code: row.package_code,
          title: row.package_title,
          sessions_total: sessionsTotal,
          mask_total: maskTotal,
          price_thb: row.price_thb,
        },
        usage: {
          sessions_used: sessionsUsed,
          sessions_remaining: Math.max(sessionsTotal - sessionsUsed, 0),
          mask_used: maskUsed,
          mask_remaining: Math.max(maskTotal - maskUsed, 0),
        },
      };
      });
    } catch (error) {
      if (error?.code === '42P01') {
        packages = [];
      } else {
        throw error;
      }
    }

    let usageRows = [];
    try {
      const usageResult = await query(
        `
          SELECT
            pu.used_at,
            pu.session_no,
            pu.used_mask,
            p.code AS package_code,
            p.title AS package_title,
            s.display_name AS staff_display_name,
            a.id AS appointment_id,
            a.scheduled_at,
            a.branch_id
          FROM package_usages pu
          JOIN customer_packages cp ON cp.id = pu.customer_package_id
          JOIN packages p ON p.id = cp.package_id
          LEFT JOIN staffs s ON s.id = pu.staff_id
          LEFT JOIN appointments a ON a.id = pu.appointment_id
          WHERE cp.customer_id = $1
          ORDER BY pu.used_at DESC
          LIMIT 50
        `,
        [customerId]
      );

      usageRows = usageResult.rows;
    } catch (error) {
      if (error?.code === '42P01') {
        usageRows = [];
      } else if (error?.code === '42703') {
        try {
          const fallbackResult = await query(
            `
              SELECT
                pu.used_at,
                p.code AS package_code,
                p.title AS package_title,
                s.display_name AS staff_display_name,
                a.id AS appointment_id,
                a.scheduled_at,
                a.branch_id
              FROM package_usages pu
              JOIN customer_packages cp ON cp.id = pu.customer_package_id
              JOIN packages p ON p.id = cp.package_id
              LEFT JOIN staffs s ON s.id = pu.staff_id
              LEFT JOIN appointments a ON a.id = pu.appointment_id
              WHERE cp.customer_id = $1
              ORDER BY pu.used_at DESC
              LIMIT 50
            `,
            [customerId]
          );
          usageRows = fallbackResult.rows;
        } catch (fallbackError) {
          console.error('Usage fallback failed', fallbackError);
          usageRows = [];
        }
      } else {
        throw error;
      }
    }

    let appointmentRows = [];
    try {
      const limitRaw = typeof req.query?.appointment_limit === 'string' ? req.query.appointment_limit : '';
      const parsedLimit = Number.parseInt(limitRaw, 10);
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50;

      const appointmentResult = await query(
        `
          SELECT
            a.id,
            a.scheduled_at,
            a.status,
            a.branch_id,
            t.code AS treatment_code,
            t.title_th AS treatment_title_th,
            t.title_en AS treatment_title_en
          FROM appointments a
          JOIN treatments t ON t.id = a.treatment_id
          WHERE a.customer_id = $1
          ORDER BY a.scheduled_at DESC
          LIMIT $2
        `,
        [customerId, limit]
      );

      appointmentRows = appointmentResult.rows;
    } catch (error) {
      if (error?.code === '42P01') {
        appointmentRows = [];
      } else {
        throw error;
      }
    }

    return res.json({
      ok: true,
      customer: customerResult.rows[0],
      packages,
      usage_history: usageRows.map((row) => ({
        used_at: row.used_at,
        package_code: row.package_code,
        package_title: row.package_title,
        session_no: row.session_no,
        used_mask: row.used_mask,
        staff_display_name: row.staff_display_name,
        appointment_id: row.appointment_id,
        scheduled_at: row.scheduled_at,
        branch_id: row.branch_id,
      })),
      appointment_history: appointmentRows.map((row) => ({
        id: row.id,
        scheduled_at: row.scheduled_at,
        status: row.status,
        branch_id: row.branch_id,
        treatment_code: row.treatment_code,
        treatment_title_th: row.treatment_title_th,
        treatment_title_en: row.treatment_title_en,
      })),
    });
  } catch (error) {
    console.error('getCustomerProfile failed', error);
    const message = error?.message || 'Server error';
    const code = error?.code || null;
    return res.status(500).json({ ok: false, error: message, code });
  }
}
