import CustomerTable from "./CustomerTable";

export default function CustomerPanel({
  customersLoading,
  customersError,
  customers,
  shortenId,
  onOpenEditModal,
  canManageTestRecords = false,
}) {
  return (
    <div
      id="booking-panel-customer"
      role="tabpanel"
      aria-labelledby="booking-tab-customer"
    >
      <CustomerTable
        customersLoading={customersLoading}
        customersError={customersError}
        customers={customers}
        shortenId={shortenId}
        onOpenEditModal={onOpenEditModal}
        canManageTestRecords={canManageTestRecords}
      />
    </div>
  );
}
