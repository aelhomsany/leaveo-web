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
    publicId: "public-1",
    name: "Annual Leave",
    icon: "🏖️",
    color: "#093C5D",
    backgroundColor: "#D6E8ED",
    borderColor: "#0E4F75",
    presenceType: "OFF",
    defaultBalanceDays: 20,
    displayOrder: 1,
    active: true,
    halfDayAllowed: true,
  },
  {
    id: 2,
    publicId: "public-2",
    name: "Sick Leave",
    icon: "🤒",
    color: "#EF4444",
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    presenceType: "OFF",
    defaultBalanceDays: 10,
    displayOrder: 2,
    active: true,
    halfDayAllowed: true,
  },
  {
    id: 3,
    publicId: "public-3",
    name: "Work From Home",
    icon: "🏠",
    color: "#2D6A4F",
    backgroundColor: "#E4F5DC",
    borderColor: "#CBF3BB",
    presenceType: "WFH",
    defaultBalanceDays: 30,
    displayOrder: 3,
    active: true,
    halfDayAllowed: false,
  },
  {
    id: 4,
    publicId: "public-4",
    name: "Maternity/Paternity",
    icon: "👶",
    color: "#854D0E",
    backgroundColor: "#FEF9C3",
    borderColor: "#FDE68A",
    presenceType: "OFF",
    defaultBalanceDays: 90,
    displayOrder: 4,
    active: true,
    halfDayAllowed: false,
  },
  {
    id: 5,
    publicId: "public-5",
    name: "Unpaid Leave",
    icon: "📋",
    color: "#5A7A80",
    backgroundColor: "#ECF4E8",
    borderColor: "#B8DCC4",
    presenceType: "OFF",
    defaultBalanceDays: null,
    displayOrder: 5,
    active: true,
    halfDayAllowed: true,
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

  it("[P0] opens each Leave Type's allowance rules at the type's own URL", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, "getManagedLeaveTypes").mockResolvedValue(
      mockLeaveTypes.slice(0, 2),
    );
    renderLeaveTypesCard();

    // Plan LLANO P2-2: there is no draft to create or resume first, so the button is a plain link
    // to the rules page and needs nothing but the type itself.
    await user.click(
      await screen.findByRole("button", {
        name: `Allowance rules: ${isolate("Sick Leave")}`,
      }),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/settings/leave-policies/public-2",
    );
  });

  // The rail answers what the list makes you count. Every figure here is one a reader would
  // otherwise get by scanning rows: status and entitlement live on each row.
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
  });
});

/**
 * Plan MEDIA. Half days are on by default for every leave type; the toggle is how an organization
 * keeps one to whole days, and the row names only that restriction. A type whose response carries
 * no flag at all reads as allowed, as the column defaults to true.
 */
describe("LeaveTypesCard half-day toggle — Plan MEDIA", () => {
  const halfDayToggle = () =>
    screen.getByRole("checkbox", { name: "Can be taken in half days" });

  // wfhNoHalfDayFlag deliberately omits halfDayAllowed (built field-by-field, not spread from
  // mockLeaveTypes[2], since that now always carries the key) to exercise a real API response
  // that predates Plan MEDIA and never sends the flag at all -- LeaveTypesCard must still read
  // that as allowed. The cast is the narrowest way to feed that shape into LeaveTypeResponse[],
  // which -- correctly, for every other row -- requires the key.
  const wfhNoHalfDayFlag = {
    id: mockLeaveTypes[2].id,
    publicId: "public-3",
    name: mockLeaveTypes[2].name,
    icon: mockLeaveTypes[2].icon,
    color: mockLeaveTypes[2].color,
    backgroundColor: mockLeaveTypes[2].backgroundColor,
    borderColor: mockLeaveTypes[2].borderColor,
    presenceType: "WFH" as const,
    defaultBalanceDays: mockLeaveTypes[2].defaultBalanceDays,
    displayOrder: mockLeaveTypes[2].displayOrder,
    active: true,
  } as LeaveTypeResponse;

  const types: LeaveTypeResponse[] = [
    { ...mockLeaveTypes[0], publicId: "public-1", presenceType: "OFF", active: true, halfDayAllowed: true },
    { ...mockLeaveTypes[1], publicId: "public-2", presenceType: "OFF", active: true, halfDayAllowed: false },
    // No halfDayAllowed at all.
    wfhNoHalfDayFlag,
  ];

  beforeEach(() => {
    vi.spyOn(apiClient, "getManagedLeaveTypes").mockResolvedValue(types);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function openEdit(user: ReturnType<typeof userEvent.setup>, typeName: string) {
    await openRowMenu(user, typeName);
    await user.click(
      screen.getByRole("menuitem", { name: `Edit ${isolate(typeName)}` }),
    );
    return halfDayToggle();
  }

  async function saveEdit(
    user: ReturnType<typeof userEvent.setup>,
    update: { mock: { calls: unknown[] } },
  ) {
    const calls = update.mock.calls.length;
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(update.mock.calls).toHaveLength(calls + 1));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  }

  // MEDIA-UI-VAL-006. Create: the toggle starts on, an unticked toggle is sent as false, and the
  // next "Add Leave Type" starts on again rather than inheriting the last choice.
  it("[P1] defaults the toggle on for a new type and sends halfDayAllowed as set", async () => {
    const user = userEvent.setup();
    const create = vi
      .spyOn(apiClient, "createLeaveType")
      .mockResolvedValue(types[0]);
    renderLeaveTypesCard();

    await user.click(
      await screen.findByRole("button", { name: /add leave type/i }),
    );
    expect(halfDayToggle()).toBeChecked();
    expect(
      screen.getByText(
        "People can request a morning or an afternoon of this type. Turn it off for types that only make sense as whole days.",
      ),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^name$/i), "Bereavement Leave");
    await user.type(screen.getByLabelText(/^icon$/i), "B");
    await user.click(halfDayToggle());
    expect(halfDayToggle()).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: /create leave type/i }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenLastCalledWith({
      name: "Bereavement Leave",
      icon: "B",
      color: LEAVE_TYPE_DEFAULT_PRESENTATION.color,
      backgroundColor: LEAVE_TYPE_DEFAULT_PRESENTATION.backgroundColor,
      borderColor: LEAVE_TYPE_DEFAULT_PRESENTATION.borderColor,
      presenceType: LEAVE_TYPE_DEFAULT_PRESENTATION.presenceType,
      halfDayAllowed: false,
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /add leave type/i }));
    expect(halfDayToggle()).toBeChecked();
    await user.type(screen.getByLabelText(/^name$/i), "Study Leave");
    await user.type(screen.getByLabelText(/^icon$/i), "S");
    await user.click(screen.getByRole("button", { name: /create leave type/i }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "Study Leave", halfDayAllowed: true }),
    );
  });

  // MEDIA-UI-VAL-006. Edit: the toggle opens on the type's own setting and saves it back -- kept
  // when untouched, flipped when changed, and "on" for a type whose response has no flag.
  it("[P1] opens edit on the type's own setting and round-trips halfDayAllowed", async () => {
    const user = userEvent.setup();
    const update = vi
      .spyOn(apiClient, "updateLeaveType")
      .mockImplementation(
        async (publicId) => types.find((type) => type.publicId === publicId) ?? types[0],
      );
    renderLeaveTypesCard();

    // Off, saved untouched: stays off.
    expect(await openEdit(user, "Sick Leave")).not.toBeChecked();
    await saveEdit(user, update);
    expect(update).toHaveBeenLastCalledWith(
      "public-2",
      expect.objectContaining({ name: "Sick Leave", halfDayAllowed: false }),
    );

    // Off, switched on.
    await user.click(await openEdit(user, "Sick Leave"));
    expect(halfDayToggle()).toBeChecked();
    await saveEdit(user, update);
    expect(update).toHaveBeenLastCalledWith(
      "public-2",
      expect.objectContaining({ halfDayAllowed: true }),
    );

    // On, switched off.
    await user.click(await openEdit(user, "Annual Leave"));
    expect(halfDayToggle()).not.toBeChecked();
    await saveEdit(user, update);
    expect(update).toHaveBeenLastCalledWith(
      "public-1",
      expect.objectContaining({ halfDayAllowed: false }),
    );

    // No flag in the response, saved untouched: on.
    expect(await openEdit(user, "Work From Home")).toBeChecked();
    await saveEdit(user, update);
    expect(update).toHaveBeenLastCalledWith(
      "public-3",
      expect.objectContaining({ halfDayAllowed: true }),
    );
  });

  // MEDIA-UI-VAL-006. The row says "Whole days only" only when half days are off -- not for a type
  // that allows them, and not for one whose response carries no flag.
  it("[P1] names the whole-days restriction on that row only", async () => {
    renderLeaveTypesCard();

    const restricted = await screen.findByTestId("leave-type-row-2");
    expect(within(restricted).getByText("Whole days only")).toBeInTheDocument();
    expect(screen.getByTestId("leave-type-row-1")).not.toHaveTextContent(
      "Whole days only",
    );
    expect(screen.getByTestId("leave-type-row-3")).not.toHaveTextContent(
      "Whole days only",
    );
    expect(
      within(screen.getByTestId("leave-types-list")).getAllByText(
        "Whole days only",
      ),
    ).toHaveLength(1);
  });
});
