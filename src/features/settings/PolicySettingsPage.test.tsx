import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
  createMemoryRouter,
} from "react-router-dom";
import { vi } from "vitest";
import { ApiError } from "../../api/client";
import * as api from "../../api/client";
import type { PolicyPreviewResponse } from "../../api/generated/types";
import { ToastProvider } from "../../components/ui/ToastProvider";
import {
  AuthTestProvider,
  createMockAuthForRole,
} from "../../test/authTestUtils";
import { PolicySettingsPage } from "./PolicySettingsPage";

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthTestProvider value={createMockAuthForRole("ORGANIZATION_ADMIN")}>
          <MemoryRouter initialEntries={["/settings/leave-policies/draft-1"]}>
            <Routes>
              <Route
                path="/settings/leave-policies/:draftPublicId"
                element={<PolicySettingsPage />}
              />
            </Routes>
          </MemoryRouter>
        </AuthTestProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const draft = {
  policyPublicId: "policy-1",
  draftPublicId: "draft-1",
  leaveTypePublicId: "type-1",
  mode: "ANNUAL_ALLOWANCE",
  allowanceDays: 20,
  balancePeriod: "CALENDAR_YEAR",
  scope: "WORKFORCE_GROUP",
  subjectPublicId: "group-1",
  effectiveFrom: "2027-01-01",
  revision: 0,
  consumed: false,
  carryoverEnabled: false,
  carryoverMaxDays: null,
  carryoverDeadlineMonth: null,
  carryoverDeadlineDay: null,
  carryoverRepeat: false,
} as const;
const overview = {
  leaveTypes: [],
  users: [
    { publicId: "member-1", name: "Samira Hassan" },
    { publicId: "publisher-1", name: "Jordan Lee" },
  ],
  workforceGroups: [{ publicId: "group-1", name: "Cairo Support" }],
};
const preview: PolicyPreviewResponse = {
  draftPublicId: "draft-1",
  policyPublicId: "policy-1",
  draftRevision: 0,
  policyRevision: 2,
  workforceRevision: 3,
  entitlementRevision: 4,
  decisionHash: "a".repeat(64),
  asOf: "2026-08-26T10:00:00Z",
  balanceYear: 2027,
  scope: "WORKFORCE_GROUP",
  subjectPublicId: "group-1",
  effectiveFrom: "2027-01-01",
  previousEffectiveFrom: "",
  affectedMemberCount: 1,
  impacts: [
    {
      memberPublicId: "member-1",
      usedDays: 3,
      proposedAllowance: 20,
      projectedRemaining: 17,
    },
  ],
  conflicts: [
    "ALLOWANCE_BELOW_USED:member-1",
    "NO_ACTIVE_MEMBERS_IN_SCOPE",
  ],
};

function mockBase(
  history: Awaited<ReturnType<typeof api.getPolicyHistory>> = [],
) {
  vi.spyOn(api, "getPolicySettingsOverview").mockResolvedValue(overview);
  vi.spyOn(api, "getPolicyDraft").mockResolvedValue(draft);
  vi.spyOn(api, "getPolicyHistory").mockResolvedValue(history);
}

function renderPageInDataRouter() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/settings/leave-policies/:draftPublicId",
        element: (
          <QueryClientProvider client={client}>
            <ToastProvider>
              <AuthTestProvider value={createMockAuthForRole("ORGANIZATION_ADMIN")}>
                <PolicySettingsPage />
              </AuthTestProvider>
            </ToastProvider>
          </QueryClientProvider>
        ),
      },
      {
        path: "/settings",
        element: <div data-testid="route-after-policy">Settings</div>,
      },
    ],
    { initialEntries: ["/settings/leave-policies/draft-1"] },
  );
  const view = render(<RouterProvider router={router} />);
  return { router, view };
}

describe("PolicySettingsPage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("[P0] renders named authoritative scope, member balances, conflicts and effective date before confirmation", async () => {
    mockBase();
    vi.spyOn(api, "previewPolicy").mockResolvedValue(preview);
    renderPage();
    expect(
      await screen.findByRole("button", { name: /publish policy/i }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /review impact/i }));
    expect(await screen.findByText("Cairo Support")).toBeInTheDocument();
    expect(screen.getByText("Samira Hassan")).toBeInTheDocument();
    expect(
      screen.getByText(/3 used, 20 proposed, 17 remaining/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Samira Hassan has already used more days/i)).toBeInTheDocument();
    expect(screen.getByText(/no active members in this scope/i)).toBeInTheDocument();
    expect(screen.queryByText(/member-1/)).not.toBeInTheDocument();
    expect(screen.getByText("January 1, 2027")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /publish policy/i }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Cairo Support",
    );
    expect(
      screen.getByRole("button", { name: /confirm publication/i }),
    ).toBeDisabled();
  });

  it("[P0] persists the saved revision after preview failure and recovers without stale expectedRevision", async () => {
    mockBase();
    const update = vi
      .spyOn(api, "updatePolicyDraft")
      .mockResolvedValueOnce({ ...draft, allowanceDays: 25, revision: 1 })
      .mockResolvedValueOnce({ ...draft, allowanceDays: 26, revision: 2 });
    vi.spyOn(api, "previewPolicy")
      .mockRejectedValueOnce(
        new ApiError(409, {
          type: "https://leaveo.net/errors/conflict",
          title: "Conflict",
          status: 409,
          code: "stale-policy-preview",
        }),
      )
      .mockResolvedValueOnce({ ...preview, draftRevision: 2 });
    renderPage();
    const allowance = await screen.findByLabelText(/allowance days/i);
    fireEvent.change(allowance, { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: /review impact/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /preview is stale/i,
    );
    expect(allowance).toHaveValue(25);
    fireEvent.change(allowance, { target: { value: "26" } });
    fireEvent.click(screen.getByRole("button", { name: /review impact/i }));
    await screen.findByText(/Samira Hassan has already used more days/i);
    expect(update).toHaveBeenNthCalledWith(
      2,
      "draft-1",
      expect.objectContaining({ expectedRevision: 1, allowanceDays: 26 }),
    );
  });

  it("[P0] displays server field violations, preserves input and focuses the relevant field", async () => {
    mockBase();
    vi.spyOn(api, "updatePolicyDraft").mockRejectedValue(
      new ApiError(400, {
        type: "https://leaveo.net/errors/validation-failed",
        title: "Validation failed",
        status: 400,
        violations: [
          { field: "allowanceDays", message: "must be greater than 0" },
        ],
      }),
    );
    renderPage();
    const allowance = await screen.findByLabelText(/allowance days/i);
    fireEvent.change(allowance, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /review impact/i }));
    expect(
      await screen.findByText("must be greater than 0"),
    ).toBeInTheDocument();
    await waitFor(() => expect(allowance).toHaveFocus());
    expect(allowance).toHaveValue(0);
  });

  it("[P0] reloads a stale draft revision while preserving input for the next review", async () => {
    mockBase();
    vi.mocked(api.getPolicyDraft)
      .mockResolvedValueOnce(draft)
      .mockResolvedValue({ ...draft, revision: 4 });
    const update = vi
      .spyOn(api, "updatePolicyDraft")
      .mockRejectedValueOnce(
        new ApiError(409, {
          type: "https://leaveo.net/errors/conflict",
          title: "Conflict",
          status: 409,
          code: "stale-policy-draft",
        }),
      )
      .mockResolvedValueOnce({ ...draft, allowanceDays: 25, revision: 5 });
    vi.spyOn(api, "previewPolicy").mockResolvedValue({ ...preview, draftRevision: 5 });
    renderPage();
    const allowance = await screen.findByLabelText(/allowance days/i);
    fireEvent.change(allowance, { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: /review impact/i }));
    await userEvent.click(await screen.findByRole("button", { name: /reload latest draft/i }));
    expect(allowance).toHaveValue(25);
    fireEvent.click(screen.getByRole("button", { name: /review impact/i }));
    await screen.findByText(/Samira Hassan has already used more days/i);
    expect(update).toHaveBeenNthCalledWith(
      2,
      "draft-1",
      expect.objectContaining({ expectedRevision: 4, allowanceDays: 25 }),
    );
  });

  it("[P0] preserves form input while overview failure blocks review and retry restores it", async () => {
    vi.spyOn(api, "getPolicySettingsOverview")
      .mockRejectedValueOnce(new Error("overview"))
      .mockResolvedValueOnce(overview);
    vi.spyOn(api, "getPolicyDraft").mockResolvedValue(draft);
    vi.spyOn(api, "getPolicyHistory").mockResolvedValue([]);
    renderPage();
    const allowance = await screen.findByLabelText(/allowance days/i);
    fireEvent.change(allowance, { target: { value: "24" } });
    expect(await screen.findByText(/unable to load current policy targets/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /review impact/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /review impact/i })).toBeEnabled());
    expect(allowance).toHaveValue(24);
  });

  it("[P0] protects dirty focused-page input from browser exit", async () => {
    mockBase();
    renderPage();
    fireEvent.change(await screen.findByLabelText(/allowance days/i), { target: { value: "24" } });
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("[P0] retries publication with one preview-bound idempotency key then refreshes draft and history", async () => {
    const user = userEvent.setup();
    mockBase();
    vi.mocked(api.getPolicyDraft)
      .mockResolvedValueOnce(draft)
      .mockResolvedValue({ ...draft, consumed: true });
    vi.mocked(api.getPolicyHistory)
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        {
          publicationPublicId: "publication-1",
          versionPublicId: "version-1",
          assignmentPublicId: "assignment-1",
          versionNumber: 1,
          mode: "ANNUAL_ALLOWANCE",
          allowanceDays: 20,
          scope: "WORKFORCE_GROUP",
          subjectPublicId: "group-1",
          effectiveFrom: "2027-01-01",
          publishedByUserPublicId: "publisher-1",
          publishedAt: "2026-08-26T10:01:00Z",
          impactSummary: { affectedMemberCount: 1, conflictCount: 0 },
        },
      ]);
    vi.spyOn(api, "previewPolicy").mockResolvedValue(preview);
    const publish = vi
      .spyOn(api, "publishPolicy")
      .mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValueOnce({
        publicationPublicId: "publication-1",
        policyPublicId: "policy-1",
        policyVersionPublicId: "version-1",
        assignmentPublicId: "assignment-1",
        versionNumber: 1,
        publishedAt: "2026-08-26T10:01:00Z",
        replayed: true,
      });
    renderPage();
    await user.click(
      await screen.findByRole("button", { name: /review impact/i }),
    );
    await user.click(
      await screen.findByRole("button", { name: /publish policy/i }),
    );
    await user.click(within(screen.getByRole("dialog")).getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: /confirm publication/i }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /retry using the same reviewed impact/i,
    );
    await user.click(
      screen.getByRole("button", { name: /confirm publication/i }),
    );
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    expect(publish.mock.calls[1][1]).toBe(publish.mock.calls[0][1]);
    await waitFor(() => expect(api.getPolicyDraft).toHaveBeenCalledTimes(2));
    expect(api.getPolicyHistory).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("Published")).toBeInTheDocument();
    expect(screen.getByText("Version 1")).toBeInTheDocument();
  });

  it("[P0] renders complete ordered named history and retries an error into the empty state", async () => {
    mockBase([
      {
        publicationPublicId: "pub-0",
        versionPublicId: "v0",
        assignmentPublicId: "a0",
        versionNumber: 0,
        mode: "ANNUAL_ALLOWANCE",
        allowanceDays: 16,
        scope: "ORGANIZATION",
        subjectPublicId: "",
        effectiveFrom: "2025-01-01",
        publishedByUserPublicId: "unmapped-publisher-id",
        publishedAt: "2024-08-26T11:00:00Z",
        impactSummary: { affectedMemberCount: 1, conflictCount: 0 },
      },
      {
        publicationPublicId: "pub-1",
        versionPublicId: "v1",
        assignmentPublicId: "a1",
        versionNumber: 1,
        mode: "ANNUAL_ALLOWANCE",
        allowanceDays: 18,
        scope: "ORGANIZATION",
        subjectPublicId: "",
        effectiveFrom: "2026-01-01",
        publishedByUserPublicId: "publisher-1",
        publishedAt: "2025-08-26T11:00:00Z",
        impactSummary: { affectedMemberCount: 1, conflictCount: 0 },
      },
      {
        publicationPublicId: "pub-2",
        versionPublicId: "v2",
        assignmentPublicId: "a2",
        versionNumber: 2,
        mode: "UNLIMITED",
        allowanceDays: null,
        scope: "ORGANIZATION",
        subjectPublicId: "",
        effectiveFrom: "2027-01-01",
        publishedByUserPublicId: "publisher-1",
        publishedAt: "2026-08-26T11:00:00Z",
        impactSummary: { affectedMemberCount: 2, conflictCount: 3 },
      },
    ]);
    const view = renderPage();
    expect(await screen.findByText("Version 2")).toBeInTheDocument();
    expect(screen.getByText("Version 1")).toBeInTheDocument();
    expect(screen.getAllByText("Jordan Lee")).toHaveLength(2);

    // Every returned version is rendered, in the ascending order the API contract publishes.
    const rows = Array.from(
      view.container.querySelectorAll(".policy-history li"),
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.textContent?.match(/Version \d+/)?.[0])).toEqual(
      ["Version 0", "Version 1", "Version 2"],
    );

    // A publisher who is no longer an active user is named, never shown as a raw internal id.
    expect(screen.queryByText("unmapped-publisher-id")).not.toBeInTheDocument();
    expect(screen.getByText("Former or unavailable user")).toBeInTheDocument();

    // Impact evidence carries both halves, and the version's own policy identity.
    expect(rows[2]).toHaveTextContent("Unlimited");
    expect(rows[2]).toHaveTextContent("3 conflicts");
    expect(rows[1]).toHaveTextContent("18 allowance days");
    expect(rows[1]).toHaveTextContent("No conflicts");
    view.unmount();
    vi.restoreAllMocks();
    vi.spyOn(api, "getPolicySettingsOverview").mockResolvedValue(overview);
    vi.spyOn(api, "getPolicyDraft").mockResolvedValue(draft);
    vi.spyOn(api, "getPolicyHistory")
      .mockRejectedValueOnce(new Error("history"))
      .mockResolvedValueOnce([]);
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /unable to load version history/i,
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(
      await screen.findByText(/no published versions yet/i),
    ).toBeInTheDocument();
  });

  it("[P0] blocks in-app route exit with unsaved policy input and preserves it on continue", async () => {
    mockBase();
    const user = userEvent.setup();
    const { router } = renderPageInDataRouter();

    const allowance = await screen.findByLabelText(/allowance days/i);
    await user.clear(allowance);
    await user.type(allowance, "27");

    await user.click(screen.getByRole("link", { name: /back to leave policies/i }));

    // The blocker must intercept: navigation has not happened and the discard modal is up.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.queryByTestId("route-after-policy")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /continue editing/i }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(await screen.findByLabelText(/allowance days/i)).toHaveValue(27);
    expect(router.state.location.pathname).toBe(
      "/settings/leave-policies/draft-1",
    );
  });

  it("[P0] discarding unsaved policy input leaves the page", async () => {
    mockBase();
    const user = userEvent.setup();
    renderPageInDataRouter();

    const allowance = await screen.findByLabelText(/allowance days/i);
    await user.clear(allowance);
    await user.type(allowance, "27");
    await user.click(screen.getByRole("link", { name: /back to leave policies/i }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: /discard changes/i }));

    expect(await screen.findByTestId("route-after-policy")).toBeInTheDocument();
  });

  it("[P0] a post-review edit withdraws the reviewed evidence and re-gates publish", async () => {
    mockBase();
    vi.spyOn(api, "updatePolicyDraft").mockResolvedValue(draft);
    vi.spyOn(api, "previewPolicy").mockResolvedValue(preview);
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: /review impact/i }),
    );
    const publish = await screen.findByRole("button", { name: /publish policy/i });
    expect(publish).toBeEnabled();

    // Changing any field after review means the on-screen draft no longer matches the evidence.
    const allowance = screen.getByLabelText(/allowance days/i);
    await user.clear(allowance);
    await user.type(allowance, "5");

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /publish policy/i }),
      ).toBeDisabled(),
    );
    expect(
      screen.getByText(/save and review the draft to load current impact/i),
    ).toBeInTheDocument();
  });

  it("[P0] a publish-time field violation names the field instead of offering a dead retry", async () => {
    mockBase();
    vi.spyOn(api, "updatePolicyDraft").mockResolvedValue(draft);
    vi.spyOn(api, "previewPolicy").mockResolvedValue(preview);
    vi.spyOn(api, "publishPolicy").mockRejectedValue(
      new ApiError(400, {
        type: "https://leaveo.net/errors/validation-failed",
        title: "Validation failed",
        status: 400,
        detail: "Publication cannot be backdated",
        violations: [
          { field: "effectiveFrom", message: "Publication cannot be backdated" },
        ],
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: /review impact/i }),
    );
    await user.click(
      await screen.findByRole("button", { name: /publish policy/i }),
    );
    await user.click(within(screen.getByRole("dialog")).getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: /confirm publication/i }),
    );

    // The confirm modal must close (no publication is implied) and the offending field must carry
    // the violation, rather than the generic "retry with the same reviewed impact" copy.
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText(/publication cannot be backdated/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/retry using the same reviewed impact/i),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText(/effective date/i)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("[P1] Plan RESTO: No limit clears and disables the maximum, and review sends no maximum", async () => {
    mockBase();
    vi.mocked(api.getPolicyDraft).mockResolvedValue({
      ...draft,
      carryoverEnabled: true,
      carryoverMaxDays: 5,
      carryoverDeadlineMonth: 3,
      carryoverDeadlineDay: 31,
    });
    const update = vi.spyOn(api, "updatePolicyDraft").mockResolvedValue(draft);
    vi.spyOn(api, "previewPolicy").mockResolvedValue(preview);
    const user = userEvent.setup();
    renderPage();

    const max = await screen.findByLabelText(/maximum days/i);
    expect(max).toHaveValue(5);
    await user.click(screen.getByLabelText(/no limit/i));
    expect(max).toHaveValue(null);
    expect(max).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /review impact/i }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1]).toMatchObject({
      carryoverEnabled: true,
      carryoverDeadlineMonth: 3,
      carryoverDeadlineDay: 31,
    });
    expect(update.mock.calls[0][1].carryoverMaxDays).toBeUndefined();
  });

  it("[P1] Plan RESTO: the deadline day list follows the month and drops a day the month lacks", async () => {
    mockBase();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByLabelText(/carry unused days/i));
    const month = screen.getByLabelText(/^month$/i);
    const day = screen.getByLabelText(/^day$/i);
    // Enabling proposes 31 March.
    expect(month).toHaveValue("3");
    expect(day).toHaveValue("31");

    await user.selectOptions(month, "4");
    expect(day).toHaveValue("");
    // One placeholder option plus the month's days; February never offers the 29th.
    expect(day.querySelectorAll("option")).toHaveLength(31);
    await user.selectOptions(month, "2");
    expect(day.querySelectorAll("option")).toHaveLength(29);
  });

  it("[P1] shows a distinct capability-unavailable message with no reload/retry CTA when the policy gate is off", async () => {
    mockBase();
    vi.spyOn(api, "previewPolicy").mockRejectedValueOnce(
      new ApiError(403, {
        type: "https://leaveo.net/errors/forbidden",
        title: "Forbidden",
        status: 403,
        detail: "This capability is not available. Compare plans or contact Sales.",
        code: "capability-unavailable",
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: /review impact/i }),
    );

    expect(
      await screen.findByText(
        /configurable policies are not yet available for this organization/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reload latest draft/i }),
    ).not.toBeInTheDocument();
  });
});
