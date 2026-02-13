export interface SeededIds {
  adminUserId?: string;
  staffUserId?: string;
  customerId?: string;
  appointmentId?: string;
}

export function loadSeededIds(): SeededIds {
  return {
    adminUserId: process.env.E2E_ADMIN_USER_ID,
    staffUserId: process.env.E2E_STAFF_USER_ID,
    customerId: process.env.E2E_CUSTOMER_ID,
    appointmentId: process.env.E2E_APPOINTMENT_ID,
  };
}

