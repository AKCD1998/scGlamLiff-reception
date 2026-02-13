import { test, expect } from "../fixtures/admin";

test.describe("AdminUsersPage E2E", () => {
  test("admin users list loads and renders rows or empty state", async ({ adminPage }) => {
    const adminTab = adminPage.locator(".top-tab", { hasText: "จัดการผู้ใช้ (Admin)" }).first();
    await adminTab.waitFor({ state: "visible" });

    const [listResponse] = await Promise.all([
      adminPage.waitForResponse((res) => {
        return (
          res.url().includes("/api/admin/staff-users") && res.request().method() === "GET"
        );
      }),
      adminTab.click(),
    ]);

    expect(listResponse.status()).toBe(200);
    const payload = await listResponse.json();
    expect(payload?.ok).toBe(true);
    expect(Array.isArray(payload?.rows)).toBe(true);

    const rows = payload.rows as Array<{ username: string }>;
    if (rows.length === 0) {
      await expect(adminPage.locator(".admin-users-table tbody")).toContainText("ไม่มีข้อมูล");
      return;
    }

    const uiRowCount = await adminPage.locator(".admin-users-table tbody tr").count();
    expect(uiRowCount).toBe(rows.length);
    await expect(adminPage.locator(".admin-users-table tbody")).toContainText(rows[0].username);
  });
});

