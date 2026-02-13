import { useMemo, useState } from "react";
import QueueTable from "./QueueTable";
import { isTestRecord, shouldHideTestRecordsByDefault } from "../../../utils/isTestRecord";

export default function QueuePanel({
  queueDateFilter,
  onChangeQueueDateFilter,
  onClearQueueDateFilter,
  loading,
  error,
  rows,
  onOpenServiceModal,
  formatAppointmentStatus,
  canManageTestRecords = false,
}) {
  const [showTestRecords, setShowTestRecords] = useState(
    () => !shouldHideTestRecordsByDefault()
  );
  const effectiveShowTestRecords = canManageTestRecords ? showTestRecords : false;
  const visibleRows = useMemo(() => {
    if (effectiveShowTestRecords) return rows;
    return rows.filter((row) => !isTestRecord(row));
  }, [rows, effectiveShowTestRecords]);

  return (
    <div
      id="booking-panel-queue"
      role="tabpanel"
      aria-labelledby="booking-tab-queue"
    >
      <div className="booking-queue-filter">
        <div className="booking-field booking-queue-filter-field">
          <label htmlFor="queue-filter-date">กรองตามวันที่</label>
          <input
            id="queue-filter-date"
            type="date"
            value={queueDateFilter}
            onChange={(event) => onChangeQueueDateFilter(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="booking-queue-filter-clear"
          onClick={onClearQueueDateFilter}
          disabled={!queueDateFilter}
        >
          แสดงทั้งหมด
        </button>
        {canManageTestRecords ? (
          <label className="booking-test-filter" htmlFor="queue-show-e2e">
            <input
              id="queue-show-e2e"
              type="checkbox"
              checked={showTestRecords}
              onChange={(event) => setShowTestRecords(event.target.checked)}
            />
            <span>แสดงข้อมูลทดสอบ (E2E)</span>
          </label>
        ) : null}
      </div>
      <QueueTable
        loading={loading}
        error={error}
        rows={visibleRows}
        onOpenServiceModal={onOpenServiceModal}
        formatAppointmentStatus={formatAppointmentStatus}
      />
    </div>
  );
}
