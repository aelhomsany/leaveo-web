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
import type {
  PolicyRule,
  PolicyRuleImpactResponse,
  PolicyRulesResponse,
} from "../../api/generated/types";
import { ToastProvider } from "../../components/ui/ToastProvider";
import { isolate } from "../../i18n/bidi";
import {
  AuthTestProvider,
  createMockAuthForRole,
} from "../../test/authTestUtils";
import { PolicyRulesPage } from "./PolicyRulesPage";

const PAGE_URL = "/settings/leave-policies/type-1";

function rule(overrides: Partial<PolicyRule> & Pick<PolicyRule, "assignmentPublicId">): PolicyRule {
  return {
    scope: "ORGANIZATION",
    subjectPublicId: null,
    subjectName: null,
    effectiveFrom: "2026-01-01",
    endsOn: null,
    state: "IN_FORCE",
    mode: "ANNUAL_ALLOWANCE",
    allowanceDays: 22,
    carryoverEnabled: false,
    carryoverMaxDays: null,
    carryoverDeadlineMonth: null,
    carryoverDeadlineDay: null,
    carryoverRepeat: false,
    setByName: null,
    setAt: null,
    changeable: false,
    ...overrides,
  };
}

// Today is 19 September 2026 in the Organization. The company has an ended born-with rule, the rule
// in force, and an upcoming one nothing has used; one group and one person have their own.
const bornWith = rule({
  assignmentPublicId: "c-0",
  effectiveFrom: "2000-01-01",
  endsOn: "2025-12-31",
  state: "ENDED",
  allowanceDays: 20,
});
const companyInForce = rule({
  assignmentPublicId: "c-1",
  endsOn: "2026-12-31",
  setByName: "Jordan Lee",
  setAt: "2025-12-10T09:00:00Z",
});
const companyUpcoming = rule({
  assignmentPublicId: "c-2",
  effectiveFrom: "2027-01-01",
  state: "UPCOMING",
  allowanceDays: 25,
  carryoverEnabled: true,
  carryoverMaxDays: 5,
  carryoverDeadlineMonth: 3,
  carryoverDeadlineDay: 31,
  setByName: "Jordan Lee",
  setAt: "2026-09-01T09:00:00Z",
  changeable: true,
});
const groupRule = rule({
  assignmentPublicId: "g-1",
  scope: "WORKFORCE_GROUP",
  subjectPublicId: "group-1",
  subjectName: "Cairo Support",
  effectiveFrom: "2026-03-01",
  allowanceDays: 30,
  setAt: "2026-02-01T09:00:00Z",
});
// Upcoming, but a request already booked against it, so it can no longer change.
const personRule = rule({
  assignmentPublicId: "u-1",
  scope: "USER",
  subjectPublicId: "member-1",
  subjectName: "Samira Hassan",
  effectiveFrom: "2026-12-01",
  state: "UPCOMING",
  allowanceDays: 18,
  setByName: "Jordan Lee",
  setAt: "2026-09-10T09:00:00Z",
});

function rulesResponse(overrides: Partial<PolicyRulesResponse> = {}): PolicyRulesResponse {
  return {
    leaveTypePublicId: "type-1",
    leaveTypeName: "Annual Leave",
    today: "2026-09-19",
    revision: "r1",
    changesAvailable: true,
    rules: [bornWith, companyInForce, companyUpcoming, groupRule, personRule],
    ...overrides,
  };
}
const overview = {
  leaveTypes: [],
  users: [
    { publicId: "member-1", name: "Samira Hassan" },
    { publicId: "member-2", name: "Omar Nabil" },
  ],
  workforceGroups: [{ publicId: "group-1", name: "Cairo Support" }],
};
const noImpact: PolicyRuleImpactResponse = {
  replaces: "c-1",
  correction: false,
  balanceYear: 2026,
  affectedMemberCount: 0,
  impacts: [],
  conflicts: [],
};

function mockBase(rules = rulesResponse()) {
  vi.spyOn(api, "getPolicySettingsOverview").mockResolvedValue(overview);
  vi.spyOn(api, "getPolicyRules").mockResolvedValue(rules);
  return vi.spyOn(api, "previewPolicyRuleImpact").mockResolvedValue(noImpact);
}

function providers(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthTestProvider value={createMockAuthForRole("ORGANIZATION_ADMIN")}>
          {children}
        </AuthTestProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function renderPage() {
  return render(
    providers(
      <MemoryRouter initialEntries={[PAGE_URL]}>
        <Routes>
          <Route path="/settings/leave-policies/:leaveTypePublicId" element={<PolicyRulesPage />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

function renderPageInDataRouter() {
  const router = createMemoryRouter(
    [
      {
        path: "/settings/leave-policies/:leaveTypePublicId",
        element: providers(<PolicyRulesPage />),
      },
      {
        path: "/settings",
        element: <div data-testid="route-after-policy">Settings</div>,
      },
    ],
    { initialEntries: [PAGE_URL] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const changeButton = async (name: string) =>
  screen.findByRole("button", { name: `Change the rule for ${isolate(name)}` });
const editor = () => screen.getByTestId("policy-rule-editor");
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

describe("PolicyRulesPage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("[P0] groups the rules by who they are for, with each rule's state, dates and who set it", async () => {
    mockBase();
    renderPage();

    expect(
      await screen.findByRole("heading", { name: /Annual Leave.*: allowance rules/ }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("policy-read-only")).not.toBeInTheDocument();
    const company = screen.getByTestId("policy-stream-ORGANIZATION:");
    expect(within(company).getByRole("heading", { name: "Everyone" })).toBeInTheDocument();

    const inForce = screen.getByTestId("policy-rule-c-1");
    expect(inForce).toHaveTextContent("22 days a year");
    expect(inForce).toHaveTextContent("In force");
    expect(inForce).toHaveTextContent("January 1, 2026 to December 31, 2026");
    expect(inForce).toHaveTextContent(/Set by .Jordan Lee. on December 10, 2025/);
    // A rule people already follow is history: it is changed by adding the next one, never removed.
    expect(within(inForce).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();

    const upcoming = screen.getByTestId("policy-rule-c-2");
    expect(upcoming).toHaveTextContent(
      /25 days a year · Carries up to 5 days · until .March 31./,
    );
    expect(upcoming).toHaveTextContent("Upcoming");
    expect(upcoming).toHaveTextContent("From January 1, 2027");
    expect(within(upcoming).getByRole("button", { name: "Remove" })).toBeEnabled();

    // Ended rules fold away under the stream, and a rule nobody set says so.
    const earlier = within(company).getByText("Earlier rules (1)");
    expect(earlier.closest("details")).not.toHaveAttribute("open");
    const ended = screen.getByTestId("policy-rule-c-0");
    expect(ended).toHaveTextContent("Ended");
    expect(ended).toHaveTextContent("Set up automatically");

    const group = screen.getByTestId("policy-stream-WORKFORCE_GROUP:group-1");
    expect(within(group).getByRole("heading", { name: "Cairo Support" })).toBeInTheDocument();
    expect(group).toHaveTextContent("Set by a former member on February 1, 2026");

    // Upcoming but already used: it stays, and so does its start.
    const person = screen.getByTestId("policy-rule-u-1");
    expect(person).toHaveTextContent("Upcoming");
    expect(within(person).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("[P0] where the plan allows no changes, the rules are shown with nothing to change them", async () => {
    const impact = mockBase(rulesResponse({ changesAvailable: false }));
    renderPage();

    expect(await screen.findByTestId("policy-read-only")).toHaveTextContent(
      "Changing allowance rules is not available for this organization.",
    );
    expect(screen.getByTestId("policy-rule-c-2")).toHaveTextContent("25 days a year");
    expect(screen.queryByRole("button", { name: "Add a rule" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Change the rule for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(impact).not.toHaveBeenCalled();
  });

  it("[P1] says so when a group or a person has no rule of their own", async () => {
    mockBase(rulesResponse({ rules: [bornWith, companyInForce] }));
    renderPage();

    expect(
      await screen.findByText(/No group has its own rule/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Nobody has a rule of their own/)).toBeInTheDocument();
  });

  it("[P0] Change on an upcoming unused rule edits it on its own start, shows the live impact and saves with the list's revision", async () => {
    const impact = mockBase();
    impact.mockResolvedValue({
      replaces: "c-2",
      correction: true,
      balanceYear: 2027,
      affectedMemberCount: 2,
      impacts: [
        {
          memberPublicId: "member-1",
          usedDays: 3,
          proposedAllowance: 26,
          projectedRemaining: 23,
          projectedCarryoverDays: 5,
        },
      ],
      conflicts: ["ALLOWANCE_BELOW_USED:member-2"],
    });
    const saved = rulesResponse({
      revision: "r2",
      rules: [
        bornWith,
        companyInForce,
        { ...companyUpcoming, allowanceDays: 26 },
        groupRule,
        personRule,
      ],
    });
    const save = vi.spyOn(api, "savePolicyRule").mockResolvedValue(saved);
    const user = userEvent.setup();
    renderPage();

    await user.click(await changeButton("Everyone"));
    const panel = editor();
    expect(within(panel).getByRole("heading", { name: "Change this rule" })).toBeInTheDocument();
    // Change edits whom the stream is for; only Add a rule asks who.
    expect(byId("policy-scope")).toBeNull();
    const allowance = within(panel).getByLabelText(/days a year/i);
    expect(allowance).toHaveValue(25);
    expect(within(panel).getByLabelText(/starts on/i)).toHaveValue("2027-01-01");
    expect(within(panel).getByLabelText(/carry unused days/i)).toBeChecked();
    expect(within(panel).getByLabelText(/maximum days/i)).toHaveValue(5);

    await user.clear(allowance);
    await user.type(allowance, "26");

    await waitFor(() =>
      expect(impact).toHaveBeenLastCalledWith(
        "type-1",
        expect.objectContaining({ allowanceDays: 26, effectiveFrom: "2027-01-01" }),
      ),
    );
    // The check waits for the admin to stop typing: the half-typed "2" is never sent.
    expect(impact.mock.calls.map(([, body]) => body.allowanceDays)).not.toContain(2);
    const impactPanel = within(panel).getByTestId("policy-impact");
    expect(
      await within(impactPanel).findByTestId("policy-impact-replaces"),
    ).toHaveTextContent("Saving replaces the rule that starts on January 1, 2027");
    expect(impactPanel).toHaveTextContent("2 people's allowances change.");
    expect(impactPanel).toHaveTextContent(/Omar Nabil. has already used more days/);
    expect(impactPanel).toHaveTextContent(
      "Samira Hassan: 3 used, 26 allowance, 23 left · carries 5 days into next year",
    );

    await user.click(within(panel).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("type-1", {
        expectedRevision: "r1",
        mode: "ANNUAL_ALLOWANCE",
        allowanceDays: 26,
        scope: "ORGANIZATION",
        subjectPublicId: undefined,
        effectiveFrom: "2027-01-01",
        carryoverEnabled: true,
        carryoverMaxDays: 5,
        carryoverDeadlineMonth: 3,
        carryoverDeadlineDay: 31,
        carryoverRepeat: false,
      }),
    );
    expect(await screen.findByText("Rule saved")).toBeInTheDocument();
    expect(screen.queryByTestId("policy-rule-editor")).not.toBeInTheDocument();
    expect(screen.getByTestId("policy-rule-c-2")).toHaveTextContent("26 days a year");
  });

  it("[P0] Change on a rule in use starts the next rule from today, or the day after the last one starts", async () => {
    mockBase();
    const user = userEvent.setup();
    renderPage();

    // The group's rule started in March: its successor can start no earlier than today.
    await user.click(await changeButton("Cairo Support"));
    expect(within(editor()).getByLabelText(/starts on/i)).toHaveValue("2026-09-19");
    expect(within(editor()).getByLabelText(/days a year/i)).toHaveValue(30);
    await waitFor(() =>
      expect(within(editor()).getByTestId("policy-impact")).toHaveTextContent(
        "Nobody's allowance changes.",
      ),
    );
    // Not a correction, so nothing claims to be replaced.
    expect(screen.queryByTestId("policy-impact-replaces")).not.toBeInTheDocument();
    await user.click(within(editor()).getByRole("button", { name: "Cancel" }));

    // Samira's rule starts in December and is already used: the next one starts the day after.
    await user.click(await changeButton("Samira Hassan"));
    expect(within(editor()).getByLabelText(/starts on/i)).toHaveValue("2026-12-02");
  });

  it("[P0] a stale save reloads the list, keeps what the admin typed and saves again on the new revision", async () => {
    mockBase();
    vi.mocked(api.getPolicyRules)
      .mockResolvedValueOnce(rulesResponse())
      .mockResolvedValue(rulesResponse({ revision: "r2" }));
    const save = vi
      .spyOn(api, "savePolicyRule")
      .mockRejectedValueOnce(
        new ApiError(409, {
          type: "https://leaveo.net/errors/conflict",
          title: "Conflict",
          status: 409,
          code: "stale-policy-rules",
        }),
      )
      .mockResolvedValueOnce(rulesResponse({ revision: "r3" }));
    const user = userEvent.setup();
    renderPage();

    await user.click(await changeButton("Cairo Support"));
    const allowance = within(editor()).getByLabelText(/days a year/i);
    await user.clear(allowance);
    await user.type(allowance, "27");
    await user.click(within(editor()).getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText(/Someone changed these rules while you were editing/),
    ).toBeInTheDocument();
    expect(api.getPolicyRules).toHaveBeenCalledTimes(2);
    expect(allowance).toHaveValue(27);

    await user.click(within(editor()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][1]).toMatchObject({ expectedRevision: "r2", allowanceDays: 27 });
  });

  it("[P0] a violation on save names the field, keeps the input and moves focus to it", async () => {
    mockBase();
    vi.spyOn(api, "savePolicyRule").mockRejectedValue(
      new ApiError(400, {
        type: "https://leaveo.net/errors/validation-failed",
        title: "Validation failed",
        status: 400,
        violations: [
          { field: "effectiveFrom", message: "must be today or later" },
        ],
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await changeButton("Cairo Support"));
    const date = within(editor()).getByLabelText(/starts on/i);
    fireEvent.change(date, { target: { value: "2026-10-01" } });
    await user.click(within(editor()).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("must be today or later")).toBeInTheDocument();
    expect(screen.getByText(/Some fields need attention/)).toBeInTheDocument();
    expect(date).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(date).toHaveFocus());
    expect(date).toHaveValue("2026-10-01");
  });

  it("[P0] a rule the impact check rejects is marked before any save", async () => {
    const impact = mockBase();
    impact.mockRejectedValue(
      new ApiError(400, {
        type: "https://leaveo.net/errors/validation-failed",
        title: "Validation failed",
        status: 400,
        violations: [
          { field: "effectiveFrom", message: "a rule for Cairo Support already starts then" },
        ],
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await changeButton("Cairo Support"));

    expect(
      await screen.findByText("a rule for Cairo Support already starts then"),
    ).toBeInTheDocument();
    expect(within(editor()).getByTestId("policy-impact")).toHaveTextContent(
      "Fix the highlighted field to see who this changes.",
    );
    expect(within(editor()).getByLabelText(/starts on/i)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("[P0] Remove asks first, then removes the upcoming rule with the list's revision", async () => {
    mockBase();
    const remove = vi
      .spyOn(api, "removePolicyRule")
      .mockResolvedValue(
        rulesResponse({
          revision: "r2",
          rules: [bornWith, { ...companyInForce, endsOn: null }, groupRule, personRule],
        }),
      );
    const user = userEvent.setup();
    renderPage();

    const upcoming = await screen.findByTestId("policy-rule-c-2");
    await user.click(within(upcoming).getByRole("button", { name: "Remove" }));
    let dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Remove this upcoming rule?");
    expect(dialog).toHaveTextContent(/25 days a year.*starting on January 1, 2027, will not take effect/);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(remove).not.toHaveBeenCalled();

    await user.click(within(upcoming).getByRole("button", { name: "Remove" }));
    dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove Rule" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("type-1", "c-2", "r1"));
    expect(await screen.findByText("Rule removed")).toBeInTheDocument();
    expect(screen.queryByTestId("policy-rule-c-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("policy-rule-c-1")).toHaveTextContent("From January 1, 2026");
  });

  it("[P0] a removal the API refuses says why", async () => {
    mockBase();
    vi.spyOn(api, "removePolicyRule").mockRejectedValue(
      new ApiError(400, {
        type: "https://leaveo.net/errors/validation-failed",
        title: "Validation failed",
        status: 400,
        violations: [
          { field: "assignmentPublicId", message: "This rule is already in use and can no longer be removed." },
        ],
      }),
    );
    const user = userEvent.setup();
    renderPage();

    const upcoming = await screen.findByTestId("policy-rule-c-2");
    await user.click(within(upcoming).getByRole("button", { name: "Remove" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove Rule" }),
    );

    expect(
      await screen.findByText("This rule is already in use and can no longer be removed."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("[P0] Add a rule starts from the company rule in force, today, and saves for the group the admin picks", async () => {
    mockBase();
    const save = vi.spyOn(api, "savePolicyRule").mockResolvedValue(rulesResponse({ revision: "r2" }));
    const user = userEvent.setup();
    renderPage();

    const add = await screen.findByRole("button", { name: "Add a rule" });
    await waitFor(() => expect(add).toBeEnabled());
    await user.click(add);

    const panel = editor();
    expect(
      within(panel).getByRole("heading", { name: "Add a rule for a group or a person" }),
    ).toBeInTheDocument();
    expect(byId<HTMLSelectElement>("policy-scope")).toHaveValue("WORKFORCE_GROUP");
    expect(within(panel).getByLabelText(/days a year/i)).toHaveValue(22);
    expect(within(panel).getByLabelText(/starts on/i)).toHaveValue("2026-09-19");
    // Nobody is picked yet, so there is nothing to check and nothing to save.
    expect(within(panel).getByTestId("policy-impact")).toHaveTextContent(
      "Fill in the rule to see who it changes.",
    );
    expect(within(panel).getByRole("button", { name: "Save" })).toBeDisabled();

    await user.selectOptions(byId("policy-subject"), "group-1");
    await user.click(within(panel).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        "type-1",
        expect.objectContaining({
          expectedRevision: "r1",
          scope: "WORKFORCE_GROUP",
          subjectPublicId: "group-1",
          allowanceDays: 22,
          effectiveFrom: "2026-09-19",
          carryoverEnabled: false,
        }),
      ),
    );
  });

  it("[P1] without Workforce Groups, Add a rule offers only a person", async () => {
    mockBase();
    vi.mocked(api.getPolicySettingsOverview).mockResolvedValue({ ...overview, workforceGroups: [] });
    const user = userEvent.setup();
    renderPage();

    const add = await screen.findByRole("button", { name: "Add a rule" });
    await waitFor(() => expect(add).toBeEnabled());
    await user.click(add);

    const scope = byId<HTMLSelectElement>("policy-scope");
    expect(scope).toHaveValue("USER");
    expect(scope.querySelectorAll("option")).toHaveLength(1);
    expect(
      [...byId<HTMLSelectElement>("policy-subject").querySelectorAll("option")].map(
        (option) => option.textContent,
      ),
    ).toEqual(["Select…", "Samira Hassan", "Omar Nabil"]);
  });

  it("[P1] No limit clears and disables the maximum, and the save sends no maximum", async () => {
    mockBase();
    const save = vi.spyOn(api, "savePolicyRule").mockResolvedValue(rulesResponse());
    const user = userEvent.setup();
    renderPage();

    await user.click(await changeButton("Everyone"));
    const max = within(editor()).getByLabelText(/maximum days/i);
    expect(max).toHaveValue(5);
    await user.click(within(editor()).getByLabelText(/no limit/i));
    expect(max).toHaveValue(null);
    expect(max).toBeDisabled();

    await user.click(within(editor()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][1]).toMatchObject({
      carryoverEnabled: true,
      carryoverDeadlineMonth: 3,
      carryoverDeadlineDay: 31,
    });
    expect(save.mock.calls[0][1].carryoverMaxDays).toBeUndefined();
  });

  it("[P1] the deadline day list follows the month and drops a day the month lacks", async () => {
    mockBase();
    const user = userEvent.setup();
    renderPage();

    await user.click(await changeButton("Cairo Support"));
    await user.click(within(editor()).getByLabelText(/carry unused days/i));
    const month = within(editor()).getByLabelText(/^month$/i);
    const day = within(editor()).getByLabelText(/^day$/i);
    // Turning carry-over on proposes 31 March.
    expect(month).toHaveValue("3");
    expect(day).toHaveValue("31");

    await user.selectOptions(month, "4");
    expect(day).toHaveValue("");
    // One placeholder option plus the month's days; February never offers the 29th.
    expect(day.querySelectorAll("option")).toHaveLength(31);
    await user.selectOptions(month, "2");
    expect(day.querySelectorAll("option")).toHaveLength(29);
  });

  it("[P1] a save refused by the plan gate says the capability is unavailable", async () => {
    mockBase();
    vi.spyOn(api, "savePolicyRule").mockRejectedValue(
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

    await user.click(await changeButton("Cairo Support"));
    await user.click(within(editor()).getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText(
        "Configurable policies are not yet available for this organization.",
      ),
    ).toBeInTheDocument();
    expect(editor()).toBeInTheDocument();
  });

  it("[P1] a list that cannot load says so and offers the way back", async () => {
    vi.spyOn(api, "getPolicySettingsOverview").mockResolvedValue(overview);
    vi.spyOn(api, "getPolicyRules").mockRejectedValue(new Error("rules"));
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load the allowance rules.",
    );
    expect(screen.getByRole("link", { name: "Back to Leave Policies" })).toHaveAttribute(
      "href",
      "/settings?category=leave-policies",
    );
  });

  it("[P0] protects an unsaved rule from browser exit", async () => {
    mockBase();
    const user = userEvent.setup();
    renderPage();

    await user.click(await changeButton("Cairo Support"));
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    // Opening the editor is not a change.
    expect(clean.defaultPrevented).toBe(false);

    fireEvent.change(within(editor()).getByLabelText(/days a year/i), {
      target: { value: "24" },
    });
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it("[P0] blocks in-app route exit with an unsaved rule and keeps it on continue", async () => {
    mockBase();
    const user = userEvent.setup();
    const router = renderPageInDataRouter();

    await user.click(await changeButton("Cairo Support"));
    const allowance = within(editor()).getByLabelText(/days a year/i);
    await user.clear(allowance);
    await user.type(allowance, "27");
    await user.click(screen.getByRole("link", { name: "Back to Leave Policies" }));

    expect(await screen.findByRole("dialog")).toHaveTextContent("Discard unsaved changes?");
    expect(screen.queryByTestId("route-after-policy")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue Editing" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(editor()).getByLabelText(/days a year/i)).toHaveValue(27);
    expect(router.state.location.pathname).toBe(PAGE_URL);
  });

  it("[P0] discarding an unsaved rule leaves the page", async () => {
    mockBase();
    const user = userEvent.setup();
    renderPageInDataRouter();

    await user.click(await changeButton("Cairo Support"));
    const allowance = within(editor()).getByLabelText(/days a year/i);
    await user.clear(allowance);
    await user.type(allowance, "27");
    await user.click(screen.getByRole("link", { name: "Back to Leave Policies" }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Discard Changes" }));

    expect(await screen.findByTestId("route-after-policy")).toBeInTheDocument();
  });
});
