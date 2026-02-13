import { useMemo, useState } from "react";
import { isTestRecord, shouldHideTestRecordsByDefault } from "../../../utils/isTestRecord";

export default function CustomerTable({
  customersLoading,
  customersError,
  customers,
  shortenId,
  onOpenEditModal,
  canManageTestRecords = false,
}) {
  const [showTestRecords, setShowTestRecords] = useState(
    () => !shouldHideTestRecordsByDefault()
  );
  const effectiveShowTestRecords = canManageTestRecords ? showTestRecords : false;
  const visibleCustomers = useMemo(() => {
    if (effectiveShowTestRecords) return customers;
    return customers.filter((customer) => !isTestRecord(customer));
  }, [customers, effectiveShowTestRecords]);

  return (
    <>
      {canManageTestRecords ? (
        <div className="booking-queue-filter booking-queue-filter--customer">
          <label className="booking-test-filter" htmlFor="customer-show-e2e">
            <input
              id="customer-show-e2e"
              type="checkbox"
              checked={showTestRecords}
              onChange={(event) => setShowTestRecords(event.target.checked)}
            />
            <span>แสดงข้อมูลทดสอบ (E2E)</span>
          </label>
        </div>
      ) : null}
      <table className="booking-table">
        <thead>
          <tr>
            <th>รหัสลูกค้า</th>
            <th>ชื่อ-สกุล</th>
            <th>แก้ไข</th>
          </tr>
        </thead>
        <tbody>
          {customersLoading ? (
            <tr>
              <td colSpan="3">กำลังโหลด...</td>
            </tr>
          ) : customersError ? (
            <tr>
              <td colSpan="3">เกิดข้อผิดพลาด: {customersError}</td>
            </tr>
          ) : visibleCustomers.length === 0 ? (
            <tr>
              <td colSpan="3">ไม่มีข้อมูล</td>
            </tr>
          ) : (
            visibleCustomers.map((customer) => (
              <tr key={customer.id || customer.fullName}>
                <td title={customer.id}>{shortenId(customer.id)}</td>
                <td>{customer.fullName}</td>
                <td>
                  <button
                    type="button"
                    className="booking-edit-button"
                    aria-label="Edit customer"
                    onClick={() => onOpenEditModal(customer)}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      className="booking-edit-icon"
                    >
                      <path
                        d="M3 17.25V21h3.75L19.81 7.94l-3.75-3.75L3 17.25z"
                        fill="currentColor"
                      />
                      <path
                        d="M20.71 6.04a1 1 0 0 0 0-1.41l-1.34-1.34a1 1 0 0 0-1.41 0l-1.13 1.13 3.75 3.75 1.13-1.13z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );
}
