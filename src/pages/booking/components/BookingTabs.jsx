export default function BookingTabs({ activeTab, onSelectTab }) {
  return (
    <div className="booking-panel-header booking-tab-header">
      <div className="booking-tabs" role="tablist" aria-label="Booking tabs">
        <button
          type="button"
          id="booking-tab-queue"
          role="tab"
          aria-selected={activeTab === "queue"}
          aria-controls="booking-panel-queue"
          className={`booking-tab ${activeTab === "queue" ? "active" : ""}`}
          onClick={() => onSelectTab("queue")}
        >
          คิวให้บริการ
        </button>
        <button
          type="button"
          id="booking-tab-customer"
          role="tab"
          aria-selected={activeTab === "customer"}
          aria-controls="booking-panel-customer"
          className={`booking-tab ${activeTab === "customer" ? "active" : ""}`}
          onClick={() => onSelectTab("customer")}
        >
          ข้อมูลลูกค้า
        </button>
      </div>
    </div>
  );
}

