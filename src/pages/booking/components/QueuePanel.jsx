import QueueTable from "./QueueTable";

export default function QueuePanel({
  queueDateFilter,
  onChangeQueueDateFilter,
  onClearQueueDateFilter,
  loading,
  error,
  rows,
  onOpenServiceModal,
  formatAppointmentStatus,
}) {
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
      </div>
      <QueueTable
        loading={loading}
        error={error}
        rows={rows}
        onOpenServiceModal={onOpenServiceModal}
        formatAppointmentStatus={formatAppointmentStatus}
      />
    </div>
  );
}

