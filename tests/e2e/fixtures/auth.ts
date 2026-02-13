import { test as base, expect } from "./base";
import { loadRuntimeEnv, type RuntimeEnv, type UserCredentials } from "./env";
export {
  detectTokenStorage,
  loginAsAdmin,
  loginAsStaff,
  getLastLoginSnapshot,
} from "../utils/auth";

type AuthFixtures = {
  runtimeEnv: RuntimeEnv;
  adminCredentials: UserCredentials;
  staffCredentials: UserCredentials;
};

export const test = base.extend<AuthFixtures>({
  runtimeEnv: async ({}, use) => {
    await use(loadRuntimeEnv());
  },

  adminCredentials: async ({ runtimeEnv }, use) => {
    await use(runtimeEnv.admin);
  },

  staffCredentials: async ({ runtimeEnv }, use) => {
    await use(runtimeEnv.staff);
  },
});

export { expect };
