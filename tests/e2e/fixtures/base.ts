import { test as base, expect } from "@playwright/test";
import { appendFailureLogs } from "../utils/logger";
import {
  saveFailureArtifacts,
  type ApiResponseSnapshot,
  type FailureArtifacts,
} from "../utils/artifacts";

type NetworkTracker = {
  allApiResponses: ApiResponseSnapshot[];
  lastApiResponse: ApiResponseSnapshot | null;
};

type BaseFixtures = {
  networkTracker: NetworkTracker;
};

type AutoFixtures = {
  failureLogger: void;
};

export const test = base.extend<BaseFixtures, AutoFixtures>({
  networkTracker: async ({ page }, use) => {
    const tracker: NetworkTracker = {
      allApiResponses: [],
      lastApiResponse: null,
    };

    const onResponse = async (response: {
      url(): string;
      request(): { method(): string };
      status(): number;
      ok(): boolean;
      headerValue(name: string): Promise<string | null>;
      json(): Promise<unknown>;
      text(): Promise<string>;
    }) => {
      try {
        if (!response.url().includes("/api/")) return;

        const contentType = await response.headerValue("content-type");
        let body: unknown = null;

        if (contentType?.includes("application/json")) {
          try {
            body = await response.json();
          } catch {
            body = null;
          }
        } else {
          try {
            const text = await response.text();
            body = text ? { raw: text.slice(0, 10_000) } : null;
          } catch {
            body = null;
          }
        }

        const snapshot: ApiResponseSnapshot = {
          url: response.url(),
          method: response.request().method(),
          status: response.status(),
          ok: response.ok(),
          timestamp: new Date().toISOString(),
          contentType,
          body,
        };

        tracker.lastApiResponse = snapshot;
        tracker.allApiResponses.push(snapshot);
      } catch {
        // Ignore tracking failures, never break the test flow.
      }
    };

    page.on("response", onResponse);
    await use(tracker);
    page.off("response", onResponse);
  },

  failureLogger: [
    async ({ page, networkTracker }, use, testInfo) => {
      await use();
      const failed = testInfo.status !== testInfo.expectedStatus;
      if (!failed) return;

      let artifacts: FailureArtifacts = {
        screenshotPath: null,
        responseSnapshotPath: null,
        metadataPath: "",
      };

      try {
        artifacts = await saveFailureArtifacts({
          page,
          testInfo,
          lastApiResponse: networkTracker.lastApiResponse,
        });
      } catch {
        // Continue to logger with whatever we have.
      }

      await appendFailureLogs({
        testInfo,
        artifacts,
        failingStep: testInfo.titlePath.join(" > "),
        expected: "E2E flow should complete with expected UI and API assertions.",
        actual: testInfo.error?.message || "Unknown test failure",
      });
    },
    { auto: true },
  ],
});

export { expect };

