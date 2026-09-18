import { LEAVE_TYPE_DEFAULT_PRESENTATION } from "./leaveTypeDefaults";
import { isolate } from "../../i18n/bidi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import * as apiClient from "../../api/client";
import type { LeaveTypeResponse } from "../../api/generated/types";
import {
  AuthTestProvider,
  createMockAuthForRole,
} from "../../test/authTestUtils";
import { MemoryRouter, useLocation } from "react-router-dom";
import { LeaveTypesCard } from "./LeaveTypesCard";

const mockLeaveTypes: LeaveTypeResponse[] = [
  {
    id: 1,
    name: "Annual Leave",
    icon: "🏖️",
    color: "#093C5D",
    backgroundColor: "#D6E8ED",
    borderColor: "#0E4F75",
    defaultBalanceDays: 20,
    displayOrder: 1,
  },
  {
    id: 2,
    name: "Sick Leave",
    icon: "🤒",
    color: "#EF4444",
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    defaultBalanceDays: 10,
    displayOrder: 2,
  },
  {
    id: 3,
    name: "Work From Home",
    icon: "🏠",
    color: "#2D6A4F",
    backgroundColor: "#E4F5DC",
    borderColor: "#CBF3BB",
    defaultBalanceDays: 30,
    displayOrder: 3,
  },
  {
    id: 4,
    name: "Maternity/Paternity",
    icon: "👶",
    color: "#854D0E",
    backgroundColor: "#FEF9C3",
    borderColor: "#FDE68A",
    defaultBalanceDays: 90,
    displayOrder: 4,
  },
  {
    id: 5,
    name: "Unpaid Leave",
    icon: "📋",
    color: "#5A7A80",
    backgroundColor: "#ECF4E8",
    borderColor: "#B8DCC4",
    defaultBalanceDays: null,
    displayOrder: 5,
  },
];

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

/**
 * Edit and deactivate/reactivate sit behind the row's overflow menu, so a test
 * that wants one has to open the menu the way a user would.
 */
async function openRowMenu(
  user: ReturnType<typeof userEvent.setup>,
  typeName: string,
) {
  await user.click(
    await screen.findByRole("button", {
      name: `More actions: ${isolate(typeName)}`,
    }),
  );
}

function renderLeaveTypesCard(onWarning = vi.fn(), onSuccess = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthTestProvider value={createMockAuthForRole("ORGANIZATION_ADMIN")}>
          <LeaveTypesCard onWarning={onWarning} onSuccess={onSuccess} />
          <LocationProbe />
        </AuthTestProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LeaveTypesCard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading state while leave types fetch", () => {
    vi.spyOn(apiClient, "getManagedLeaveTypes").mockImplementation(
      () => new Promise(() => {}),
    );

    renderLeaveTypesCard();

    expect(screen.getByTestId("leave-types-card")).toBeInTheDocument();
    expect(screen.getByText("Loading leave types…")).toBeInTheDocument();
  });

  it("renders five leave types with capped and uncapped copy", async () => {
    vi.spyOn(apiClient, "getManagedLeaveTypes").mockResolvedValue(
      mockLeaveTypes,
    );
    vi.spyOn(apiClient, "getPolicySettingsOverview").mockResolvedValue({
      leaveTypes: [],
      users: [],
      workforceGroups: [],
    });

    renderLeaveTypesCard();

    await waitFor(() => {
      expect(screen.getByTestId("leave-types-list")).toBeInTheDocument();
    });

    // Scoped to the list: the supporting rail restates every active type's name and default
    // entitlement, so an unscoped getByText now matches twice by design.
    const list = within(screen.getByTestId("leave-types-list"));
    expect(list.getByText("Annual Leave")).toBeInTheDocument();
    expect(list.getByText("20 days default")).toBeInTheDocument();
    expect(list.getByText("Sick Leave")).toBeInTheDocument();
    expect(list.getByText("10 days default")).toBeInTheDocument();
    expect(list.getByText("Unpaid Leave")).toBeInTheDocument();
    expect(list.getByText("Unlimited / custom")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^leave-type-row-/)).toHaveLength(5);
  });

  it("calls onWarning when leave types fail to load", async () => {
    const onWarning = vi.fn();
    vi.spyOn(apiClient, "getManagedLeaveTypes").mockRejectedValue(
      new Error("fail"),
    );
    vi.spyOn(apiClient, "getPolicySettingsOverview").mockResolvedValue({
      leaveTypes: [],
      users: [],
      workforceGroups: [],
    });

    renderLeaveTypesCard(onWarning);

    await waitFor(() => {
      expect(onWarning).toHaveBeenCalledWith("Unable to load leave types");
    });
  });

  it("[P0] exposes named lifecycle actions and has no destructive delete path", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, "getManagedLeaveTypes").mockResolvedValue(
      mockLeaveTypes.map((item) => ({
        ...item,
        publicId: `public-${item.id}`,
        presenceType: "OFF",
        active: true,
      })),
    );
    vi.spyOn(apiClient, "getPolicySettingsOverview").mockResolvedValue({
      leaveTypes: [],
      users: [],
      workforceGroups: [],
    });
    vi.spyOn(apiClient, "deactivateLeaveType").mockResolvedValue({
      ...mockLeaveTypes[0],
      publicId: "public-1",
      presenceType: "OFF",
      active: false,
    });

    renderLeaveTypesCard();

    await openRowMenu(user, "Annual Leave");
    await user.click(
      screen.getByRole("menuitem", { name: `Deactivate ${isolate("Annual Leave")}` }),
    );
    expect(await screen.findByRole("dialog")).toHaveTextContent("Annual Leave");
    await user.click(
      screen.getByRole("button", { name: /confirm deactivation/i }),
    );
    await waitFor(() =>
      expect(apiClient.deactivateLeaveType).toHaveBeenCalledWith("public-1"),
    );
    expect(
      screen.queryByRole("button", { name: `Delete ${isolate("Annual Leave")}` }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add leave type/i }),
    ).toBeInTheDocument();
  });

  it("[P0] creates and edits catalogue entries while retaining modal input after failures", async () => {
    const user = userEvent.setup();
    const onWarning = vi.fn();
    const types = mockLeaveTypes
      .slice(0, 1)
      .map((item) => ({
        ...item,
        publicId: "public-1",
        presenceType: "OFF" as const,
        active: true,
      }));
    vi.spyOn(apiClient, "getManagedLeaveTypes").mockResolvedValue(types);
    vi.spyOn(apiClient, "getPolicySettingsOverview").mockResolvedValue({
      leaveTypes: [],
      users: [],
      workforceGroups: [],
    });
    const create = vi
      .spyOn(apiClient, "createLeaveType")
      .mockRejectedValueOnce(
        new apiClient.ApiError(400, {
          type: "https://leaveo.net/errors/validation-failed",
          title: "Validation failed",
          status: 400,
          violations: [{ field: "name", message: "name already exists" }],
        }),
      )
      .mockResolvedValueOnce(types[0]);
    const update = vi
      .spyOn(apiClient, "updateLeaveType")
      .mockRejectedValueOnce(
        new apiClient.ApiError(400, {
          type: "https://leaveo.net/errors/validation-failed",
          title: "Validation failed",
          status: 400,
          violations: [{ field: "icon", message: "icon is invalid" }],
        }),
      )
      .mockResolvedValueOnce({ ...types[0], name: "Annual Rest" });
    renderLeaveTypesCard(onWarning);

    await user.click(
      await screen.findByRole("button", { name: /add leave type/i }),
    );
    await user.type(screen.getByLabelText(/^name$/i), "Compassionate Leave");
    await user.type(screen.getByLabelText(/^icon$/i), "C");
    await user.click(
      screen.getByRole("button", { name: /create leave type/i }),
    );
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith({
      name: "Compassionate Leave",
      icon: "C",
      color: LEAVE_TYPE_DEFAULT_PRESENTATION.color,
      backgroundColor: LEAVE_TYPE_DEFAULT_PRESENTATION.backgroundColor,
      borderColor: LEAVE_TYPE_DEFAULT_PRESENTATION.borderColor,
      presenceType: LEAVE_TYPE_DEFAULT_PRESENTATION.presenceType,
      halfDayAllowed: true,
    });
    expect(screen.getByLabelText(/^name$/i)).toHaveValue("Compassionate Leave");
    expect(screen.getByText("name already exists")).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toHaveFocus();
    expect(onWarning).toHaveBeenCalledWith("Unable to create leave type");
    await user.click(
      screen.getByRole("button", { name: /create leave type/i }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    await openRowMenu(user, "Annual Leave");
    await user.click(
      screen.getByRole("menuitem", { name: `Edit ${isolate("Annual Leave")}` }),
    );
    const name = screen.getByLabelText(/^name$/i);
    await user.clear(name);
    await user.type(name, "Annual Rest");
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    // The edit must target the row that was opened and carry every presentation field, not just
    // the one the user touched.
    expect(update).toHaveBeenCalledWith(
      "public-1",
      expect.objectContaining({
        name: "Annual Rest",
        icon: types[0].icon,
        color: types[0].color,
        backgroundColor: types[0].backgroundColor,
        borderColor: types[0].borderColor,
        presenceType: types[0].presenceType,
      }),
    );
    expect(name).toHaveValue("Annual Rest");
    expect(screen.getByText("icon is invalid")).toBeInTheDocument();
    expect(screen.getByLabelText(/^icon$/i)).toHaveFocus();
    expect(onWarning).toHaveBeenCalledWith("Unable to update leave type");
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  });

  it("[P0] reorders without losing displayed order on failure and deactivates/reactivates without delete", async () => {
    const user = userEvent.setup();
    const onWarning = vi.fn();
    const types = mockLeaveTypes
      .slice(0, 2)
      .map((item, index) => ({
        ...item,
        publicId: `public-${index + 1}`,
        presenceType: "OFF" as const,
        active: index === 0,
      }));
    vi.spyOn(apiClient, "getManagedLeaveTypes").mockResolvedValue(types);
    vi.spyOn(apiClient, "getPolicySettingsOverview").mockResolvedValue({
      leaveTypes: [],
      users: [],
      workforceGroups: [],
    });
    vi.spyOn(apiClient, "reorderLeaveTypes").mockRejectedValue(
      new Error("reorder"),
    );
    vi.spyOn(apiClient, "deactivateLeaveType").mockResolvedValue({
      ...types[0],
      active: false,
    });
    vi.spyOn(apiClient, "reactivateLeaveType").mockResolvedValue({
      ...types[1],
      active: true,
    });
    const onSuccess = vi.fn();
    renderLeaveTypesCard(onWarning, onSuccess);

    await user.click(
      await screen.findByRole("button", { name: `Move Down: ${isolate("Annual Leave")}` }),
    );
    // The swap itself must be asserted: without a payload assertion the reorder could send the
    // unmodified order, or swap the wrong neighbours, and this test would still pass.
    await waitFor(() =>
      expect(apiClient.reorderLeaveTypes).toHaveBeenCalledTimes(1),
    );
    expect(vi.mocked(apiClient.reorderLeaveTypes).mock.calls[0][0]).toEqual([
      "public-2",
      "public-1",
    ]);
    await waitFor(() =>
      expect(onWarning).toHaveBeenCalledWith("Unable to reorder leave types"),
    );
    expect(
      screen.getAllByTestId(/^leave-type-row-/).map((row) => row.textContent),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Annual Leave"),
        expect.stringContaining("Sick Leave"),
      ]),
    );
    expect(screen.getAllByTestId(/^leave-type-row-/)[0]).toHaveTextContent(
      "Annual Leave",
    );
    await openRowMenu(user, "Annual Leave");
    await user.click(
      screen.getByRole("menuitem", { name: `Deactivate ${isolate("Annual Leave")}` }),
    );
    await user.click(
      screen.getByRole("button", { name: /confirm deactivation/i }),
    );
    await waitFor(() =>
      expect(apiClient.deactivateLeaveType).toHaveBeenCalledWith("public-1"),
    );
    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith("Annual Leave deactivated"),
    );
    await openRowMenu(user, "Sick Leave");
    await user.click(
      screen.getByRole("menuitem", { name: `Reactivate ${isolate("Sick Leave")}` }),
    );
    await user.click(
      screen.getByRole("button", { name: /confirm reactivation/i }),
    );
    await waitFor(() =>
      expect(apiClient.reactivateLeaveType).toHaveBeenCalledWith("public-2"),
    );
    // Repeated lifecycle actions must name the type they acted on, not just fire a toast.
    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith("Sick Leave reactivated"),
    );
    expect(
      screen.queryByRole("button", { name: /delete/i }),
    ).not.toBeInTheDocument();
  });

  it("[P0] resumes the existing draft and creates then navigates when no draft exists", async () => {
    const user = userEvent.setup();
    const types = mockLeaveTypes
      .slice(0, 2)
      .map((item, index) => ({
        ...item,
        publicId: `public-${index + 1}`,
        presenceType: "OFF" as const,
        active: true,
      }));
    vi.spyOn(apiClient, "getManagedLeaveTypes").mockResolvedValue(types);
    vi.spyOn(apiClient, "getPolicySettingsOverview").mockResolvedValue({
      leaveTypes: [
        {
          ...types[0],
          leaveTypePublicId: "public-1",
          policyPublicId: "policy-1",
          latestDraft: { draftPublicId: "existing-draft", revision: 2 },
        },
        {
          ...types[1],
          leaveTypePublicId: "public-2",
          policyPublicId: "policy-2",
          latestDraft: null,
        },
      ],
      users: [],
      workforceGroups: [],
    });
    vi.spyOn(apiClient, "createPolicyDraft").mockResolvedValue({
      policyPublicId: "policy-2",
      draftPublicId: "new-draft",
      leaveTypePublicId: "public-2",
      mode: "ANNUAL_ALLOWANCE",
      allowanceDays: 10,
      balancePeriod: "CALENDAR_YEAR",
      scope: "ORGANIZATION",
      subjectPublicId: null,
      effectiveFrom: "2027-01-01",
      revision: 0,
      consumed: false,
    });
    const first = renderLeaveTypesCard();
    await user.click(
      await screen.findByRole("button", { name: /resume draft/i }),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/settings/leave-policies/existing-draft",
    );
    first.unmount();
    renderLeaveTypesCard();
    await user.click(
      await screen.findByRole("button", { name: /configure policy/i }),
    );
    await waitFor(() =>
      expect(apiClient.createPolicyDraft).toHaveBeenCalledWith(
        expect.objectContaining({ leaveTypePublicId: "public-2" }),
      ),
    );
    // Navigation happens in the mutation's onSuccess, so the waitFor above -- which only
    // proves the request was issued -- can pass while the promise is still pending.
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/settings/leave-policies/new-draft",
      ),
    );
  });

  it("[P0] blocks policy actions until failed overview retry restores authoritative resume/create choices", async () => {
    const user = userEvent.setup();
    const types = mockLeaveTypes.slice(0, 2).map((item, index) => ({
      ...item,
      publicId: `public-${index + 1}`,
      presenceType: "OFF" as const,
      active: true,
    }));
    vi.spyOn(apiClient, "getManagedLeaveTypes").mockResolvedValue(types);
    vi.spyOn(apiClient, "getPolicySettingsOverview")
      .mockRejectedValueOnce(new Error("overview"))
      .mockResolvedValueOnce({
        leaveTypes: [
          { ...types[0], leaveTypePublicId: "public-1", policyPublicId: "policy-1", latestDraft: { draftPublicId: "existing-draft", revision: 2 } },
          { ...types[1], leaveTypePublicId: "public-2", policyPublicId: "policy-2", latestDraft: null },
        ],
        users: [],
        workforceGroups: [],
      });
    const create = vi.spyOn(apiClient, "createPolicyDraft");
    renderLeaveTypesCard();

    expect(await screen.findByRole("alert")).toHaveTextContent(/policy actions are unavailable/i);
    const unavailable = screen.getAllByRole("button", { name: /configure policy/i });
    expect(unavailable).toHaveLength(2);
    unavailable.forEach((button) => expect(button).toBeDisabled());
    await user.click(unavailable[0]);
    expect(create).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^retry$/i }));
    expect(await screen.findByRole("button", { name: /resume draft/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /configure policy/i })).toBeEnabled();
  });

  it("[P1] shows a distinct capability-unavailable message when the policy gate is off, not the generic draft error", async () => {
    const user = userEvent.setup();
    const onWarning = vi.fn();
    const types = mockLeaveTypes.slice(0, 1).map((item) => ({
      ...item,
      publicId: "public-1",
      presenceType: "OFF" as const,
      active: true,
    }));
    vi.spyOn(apiClient, "getManagedLeaveTypes").mockResolvedValue(types);
    vi.spyOn(apiClient, "getPolicySettingsOverview").mockResolvedValue({
      leaveTypes: [
        {
          ...types[0],
          leaveTypePublicId: "public-1",
          policyPublicId: "policy-1",
          latestDraft: null,
        },
      ],
      users: [],
      workforceGroups: [],
    });
    vi.spyOn(apiClient, "createPolicyDraft").mockRejectedValueOnce(
      new apiClient.ApiError(403, {
        type: "https://leaveo.net/errors/forbidden",
        title: "Forbidden",
        status: 403,
        detail: "This capability is not available. Compare plans or contact Sales.",
        code: "capability-unavailable",
      }),
    );
    renderLeaveTypesCard(onWarning);

    await user.click(
      await screen.findByRole("button", { name: /configure policy/i }),
    );

    await waitFor(() =>
      expect(onWarning).toHaveBeenCalledWith(
        "Configurable policies are not yet available for this organization.",
      ),
    );
  });

  // The rail answers what the list makes you count. Every figure here is one a reader would
  // otherwise get by scanning rows: status and entitlement live on each row, and whether a type
  // still has an unfinished policy draft is only visible as Configure vs Resume on its button.
  describe("supporting rail", () => {
    const withPresence: LeaveTypeResponse[] = [
      { ...mockLeaveTypes[0], presenceType: "OFF" },
      { ...mockLeaveTypes[1], presenceType: "OFF" },
      { ...mockLeaveTypes[2], presenceType: "WFH" },
      { ...mockLeaveTypes[3], presenceType: "OFF", active: false },
      { ...mockLeaveTypes[4], presenceType: "OFF" },
    ];

    it("counts a type with no active flag as active, and splits presence off from WFH", async () => {
      vi.spyOn(apiClient, "getManagedLeaveTypes").mockResolvedValue(withPresence);
      vi.spyOn(apiClient, "getPolicySettingsOverview").mockResolvedValue({
        leaveTypes: [],
        users: [],
        workforceGroups: [],
      });

      renderLeaveTypesCard();

      // `active` is optional in the schema, and an absent flag has always meant active here —
      // four of the five carry no flag at all, and only the explicit `false` is inactive.
      expect(
        await screen.findByTestId("leave-types-glance-active"),
      ).toHaveTextContent("4");
      expect(screen.getByTestId("leave-types-glance-inactive")).toHaveTextContent(
        "1",
      );

      // Work From Home is presence, not absence: it must never be counted with the types that
      // take somebody off the calendar. The deactivated type is out of both figures.
      expect(screen.getByTestId("leave-types-presence-wfh")).toHaveTextContent("1");
      expect(screen.getByTestId("leave-types-presence-off")).toHaveTextContent("3");
    });

    it("shows an em dash for drafts when the overview call fails, not zero", async () => {
      vi.spyOn(apiClient, "getManagedLeaveTypes").mockResolvedValue(withPresence);
      vi.spyOn(apiClient, "getPolicySettingsOverview").mockRejectedValue(
        new Error("overview unavailable"),
      );

      renderLeaveTypesCard();

      // "No drafts" is a different claim from "we could not find out" — the card already renders
      // its own retry for this call, so the rail must not quietly answer zero on its behalf.
      expect(
        await screen.findByTestId("leave-types-glance-drafts"),
      ).toHaveTextContent("—");
    });

    it("counts the leave types that still carry an unfinished policy draft", async () => {
      vi.spyOn(apiClient, "getManagedLeaveTypes").mockResolvedValue(withPresence);
      vi.spyOn(apiClient, "getPolicySettingsOverview").mockResolvedValue({
        leaveTypes: [
          { leaveTypePublicId: "lt-1", name: "Annual Leave" },
          {
            leaveTypePublicId: "lt-2",
            name: "Sick Leave",
            latestDraft: { draftPublicId: "draft-1", revision: 3 },
          },
        ],
        users: [],
        workforceGroups: [],
      });

      renderLeaveTypesCard();

      expect(
        await screen.findByTestId("leave-types-glance-drafts"),
      ).toHaveTextContent("1");
    });
  });
});
