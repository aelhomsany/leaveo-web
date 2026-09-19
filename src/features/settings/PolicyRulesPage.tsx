import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  UNSAFE_DataRouterContext,
  useBlocker,
  useParams,
} from "react-router-dom";
import {
  ApiError,
  getPolicyRules,
  getPolicySettingsOverview,
  previewPolicyRuleImpact,
  removePolicyRule,
  savePolicyRule,
} from "../../api/client";
import { fieldErrorsFromApiError } from "../../api/fieldViolations";
import type {
  PolicyRule,
  PolicyRuleImpactRequest,
  PolicyRulesResponse,
} from "../../api/generated/types";
import { DateField } from "../../components/DateField";
import { Modal } from "../../components/ui/Modal";
import { useToast } from "../../components/ui/useToast";
import { useAuth } from "../../auth/useAuth";
import { isolate } from "../../i18n/bidi";
import "./policy-settings.css";

type Scope = PolicyRule["scope"];
type Mode = PolicyRule["mode"];

/** One company, group or person and their rules, oldest first. */
type Stream = {
  key: string;
  scope: Scope;
  subjectPublicId: string | null;
  subjectName: string | null;
  rules: PolicyRule[];
};

type Editor = {
  /** The stream a Change started from; null for Add a rule, where the admin picks who. */
  streamKey: string | null;
  scope: Scope;
  subjectPublicId: string;
  mode: Mode;
  allowanceDays: string;
  effectiveFrom: string;
  carryoverEnabled: boolean;
  carryoverNoLimit: boolean;
  carryoverMaxDays: string;
  carryoverDeadlineMonth: string;
  carryoverDeadlineDay: string;
  carryoverRepeat: boolean;
};

const IMPACT_DEBOUNCE_MS = 400;
const streamKey = (scope: Scope, subjectPublicId: string | null | undefined) =>
  `${scope}:${subjectPublicId ?? ""}`;
const optionalNumber = (value: number | null | undefined) =>
  value == null ? "" : String(value);
const fieldNumber = (value: string) => (value === "" ? undefined : Number(value));
// Plan RESTO: the deadline is a month and day of the year after the balance year, never 29 February
// (the API rejects it), so February offers 28 days whatever the year.
const daysInDeadlineMonth = (month: string) =>
  month === "2" ? 28 : ["4", "6", "9", "11"].includes(month) ? 30 : 31;
const nextDay = (isoDate: string) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/** The rule's terms in the editor's shape, starting on {@code effectiveFrom}. */
function editorFrom(
  rule: PolicyRule,
  scope: Scope,
  subjectPublicId: string,
  effectiveFrom: string,
  streamKeyValue: string | null,
): Editor {
  return {
    streamKey: streamKeyValue,
    scope,
    subjectPublicId,
    mode: rule.mode,
    allowanceDays: optionalNumber(rule.allowanceDays),
    effectiveFrom,
    carryoverEnabled: rule.carryoverEnabled,
    carryoverNoLimit: rule.carryoverEnabled && rule.carryoverMaxDays == null,
    carryoverMaxDays: optionalNumber(rule.carryoverMaxDays),
    carryoverDeadlineMonth: optionalNumber(rule.carryoverDeadlineMonth),
    carryoverDeadlineDay: optionalNumber(rule.carryoverDeadlineDay),
    carryoverRepeat: rule.carryoverRepeat,
  };
}

/**
 * The rule as the API takes it, or null while it is still incomplete. An incomplete rule asks for
 * no impact and cannot be saved, so the admin never sees a violation for a field they have not
 * reached yet.
 */
function ruleBody(editor: Editor): PolicyRuleImpactRequest | null {
  if (editor.scope !== "ORGANIZATION" && !editor.subjectPublicId) return null;
  if (!editor.effectiveFrom) return null;
  const annual = editor.mode === "ANNUAL_ALLOWANCE";
  if (annual && editor.allowanceDays === "") return null;
  const carryover = annual && editor.carryoverEnabled;
  if (
    carryover &&
    (editor.carryoverDeadlineMonth === "" ||
      editor.carryoverDeadlineDay === "" ||
      (!editor.carryoverNoLimit && editor.carryoverMaxDays === ""))
  ) {
    return null;
  }
  return {
    mode: editor.mode,
    allowanceDays: annual ? Number(editor.allowanceDays) : undefined,
    scope: editor.scope,
    subjectPublicId:
      editor.scope === "ORGANIZATION" ? undefined : editor.subjectPublicId,
    effectiveFrom: editor.effectiveFrom,
    ...(carryover
      ? {
          carryoverEnabled: true,
          // No limit is an absent maximum, not a zero.
          carryoverMaxDays: editor.carryoverNoLimit
            ? undefined
            : fieldNumber(editor.carryoverMaxDays),
          carryoverDeadlineMonth: fieldNumber(editor.carryoverDeadlineMonth),
          carryoverDeadlineDay: fieldNumber(editor.carryoverDeadlineDay),
          carryoverRepeat: editor.carryoverRepeat,
        }
      : { carryoverEnabled: false }),
  };
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function RulesRouteBlocker({ dirty }: { dirty: boolean }) {
  const { t } = useTranslation("settings");
  const blocker = useBlocker(dirty);
  if (blocker.state !== "blocked") return null;
  return (
    <Modal
      labelledBy="policy-unsaved-title"
      onClose={() => blocker.reset()}
      closeOnBackdrop={false}
    >
      <div className="modal-header">
        <h2 id="policy-unsaved-title" className="modal-title">
          {t("unsaved.title")}
        </h2>
      </div>
      <div className="modal-body">
        <p>{t("unsaved.copy")}</p>
      </div>
      <div className="modal-actions">
        <button
          className="btn btn-outline"
          type="button"
          onClick={() => blocker.reset()}
        >
          {t("unsaved.continue")}
        </button>
        <button
          className="btn btn-danger"
          type="button"
          onClick={() => blocker.proceed()}
        >
          {t("unsaved.discard")}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Plan LLANO P2-2: one Leave Type's allowance rules, grouped by who they are for. Change or Add
 * opens an editor in place with the live impact list under it, and Save is the only commit step:
 * no draft, no review, no confirmation.
 */
export function PolicyRulesPage() {
  const { t, i18n } = useTranslation("settings");
  const dataRouterContext = useContext(UNSAFE_DataRouterContext);
  const { leaveTypePublicId = "" } = useParams();
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const organizationTimezone = user?.organizationTimezone || "UTC";
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const errorRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [initial, setInitial] = useState<Editor | null>(null);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Owned here rather than read from useMutation: under StrictMode a mutation's isPending can stay
  // true after it settles and leave Save disabled for good.
  const [saving, setSaving] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<PolicyRule | null>(null);
  const [removing, setRemoving] = useState(false);

  const rulesKey = ["policy-rules", leaveTypePublicId];
  const rulesQuery = useQuery({
    queryKey: rulesKey,
    queryFn: () => getPolicyRules(leaveTypePublicId),
    enabled: Boolean(leaveTypePublicId),
  });
  const overviewQuery = useQuery({
    // Same key as LeaveTypesCard, so one cache entry serves both and one invalidation reaches both.
    queryKey: ["policy-settings-overview", orgId],
    queryFn: getPolicySettingsOverview,
  });
  const rules = rulesQuery.data;

  const dirty = useMemo(
    () =>
      editor != null &&
      initial != null &&
      JSON.stringify(editor) !== JSON.stringify(initial),
    [editor, initial],
  );
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const body = useMemo(() => (editor ? ruleBody(editor) : null), [editor]);
  const debouncedBody = useDebouncedValue(body, IMPACT_DEBOUNCE_MS);
  const impactQuery = useQuery({
    // The revision is part of the key: a rule saved elsewhere can turn a replacement into an
    // addition, or make the date invalid, without the admin touching a field.
    queryKey: [
      "policy-rule-impact",
      leaveTypePublicId,
      rules?.revision,
      JSON.stringify(debouncedBody),
    ],
    queryFn: () => previewPolicyRuleImpact(leaveTypePublicId, debouncedBody!),
    enabled: debouncedBody != null && body != null && rules != null,
    placeholderData: keepPreviousData,
    // A rejected rule is an answer, not an outage.
    retry: false,
  });
  const impactViolations =
    impactQuery.error instanceof ApiError
      ? fieldErrorsFromApiError(impactQuery.error.fieldViolations)
      : null;
  // A violation from the last save wins until the admin edits; after that the live impact check
  // speaks for the field.
  const shownErrors =
    Object.keys(fieldErrors).length > 0 ? fieldErrors : (impactViolations ?? {});

  const streams = useMemo(() => {
    const byKey = new Map<string, Stream>();
    for (const rule of rules?.rules ?? []) {
      const key = streamKey(rule.scope, rule.subjectPublicId);
      let stream = byKey.get(key);
      if (!stream) {
        stream = {
          key,
          scope: rule.scope,
          subjectPublicId: rule.subjectPublicId,
          subjectName: rule.subjectName,
          rules: [],
        };
        byKey.set(key, stream);
      }
      stream.rules.push(rule);
    }
    return [...byKey.values()];
  }, [rules]);
  const companyRuleInForce = streams
    .find((stream) => stream.scope === "ORGANIZATION")
    ?.rules.find((rule) => rule.state === "IN_FORCE");

  const formatDate = (value: string | null | undefined) => {
    if (!value) return "";
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return value;
    return new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(parsed);
  };
  // setAt is an instant; the day it names is the Organization's, like every other policy date.
  const formatInstantDate = (value: string) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "long",
      timeZone: organizationTimezone,
    }).format(parsed);
  };
  const monthName = (month: number) =>
    new Intl.DateTimeFormat(i18n.language, {
      month: "long",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2001, month - 1, 1)));

  const carryoverSummary = (rule: PolicyRule) => {
    if (
      !rule.carryoverEnabled ||
      rule.carryoverDeadlineMonth == null ||
      rule.carryoverDeadlineDay == null
    ) {
      return null;
    }
    const date = isolate(
      new Intl.DateTimeFormat(i18n.language, {
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      }).format(
        new Date(
          Date.UTC(2001, rule.carryoverDeadlineMonth - 1, rule.carryoverDeadlineDay),
        ),
      ),
    );
    const base =
      rule.carryoverMaxDays == null
        ? t("policy.carryover.summaryNoLimit", { date })
        : t("policy.carryover.summary", { count: rule.carryoverMaxDays, date });
    return rule.carryoverRepeat
      ? `${base} · ${t("policy.carryover.summaryRepeat")}`
      : base;
  };
  const termsLine = (rule: PolicyRule) =>
    [
      rule.mode === "UNLIMITED" || rule.allowanceDays == null
        ? t("policy.modes.unlimited")
        : t("policy.rules.daysAYear", { count: rule.allowanceDays }),
      carryoverSummary(rule),
    ]
      .filter(Boolean)
      .join(" · ");
  const datesLine = (rule: PolicyRule) =>
    rule.endsOn
      ? t("policy.rules.fromTo", {
          from: formatDate(rule.effectiveFrom),
          to: formatDate(rule.endsOn),
        })
      : t("policy.rules.from", { date: formatDate(rule.effectiveFrom) });
  const setByLine = (rule: PolicyRule) =>
    !rule.setAt
      ? t("policy.rules.setAutomatically")
      : rule.setByName
        ? t("policy.rules.setBy", {
            name: isolate(rule.setByName),
            date: formatInstantDate(rule.setAt),
          })
        : t("policy.rules.setByFormer", { date: formatInstantDate(rule.setAt) });
  const streamTitle = (stream: Stream) =>
    stream.scope === "ORGANIZATION"
      ? t("policy.rules.everyone")
      : stream.subjectName ??
        t(
          stream.scope === "USER"
            ? "policy.rules.unknownPerson"
            : "policy.rules.unknownGroup",
        );
  const memberName = (publicId: string | undefined) =>
    overviewQuery.data?.users.find((item) => item.publicId === publicId)?.name?.trim() ||
    undefined;
  const conflictLabel = (conflict: string) => {
    if (conflict === "NO_ACTIVE_MEMBERS_IN_SCOPE") {
      return t("policy.conflicts.noActiveMembers");
    }
    const prefix = "ALLOWANCE_BELOW_USED:";
    if (conflict.startsWith(prefix)) {
      return t("policy.conflicts.allowanceBelowUsed", {
        name: isolate(
          memberName(conflict.slice(prefix.length)) ??
            t("policy.impact.unknownMember"),
        ),
      });
    }
    return t("policy.conflicts.unknown");
  };

  const openEditor = (next: Editor) => {
    setEditor(next);
    setInitial(next);
    setError("");
    setFieldErrors({});
  };
  const closeEditor = () => {
    setEditor(null);
    setInitial(null);
    setError("");
    setFieldErrors({});
  };
  const edit = (patch: Partial<Editor>) => {
    setEditor((current) => (current ? { ...current, ...patch } : current));
    setFieldErrors({});
  };
  const startChange = (stream: Stream) => {
    if (!rules) return;
    const last = stream.rules[stream.rules.length - 1];
    // An unused rule that starts today or later is replaced by saving on its own start date.
    // Anything else is followed by a new rule, from today at the earliest and never on a start
    // that is already taken.
    const effectiveFrom = last.changeable
      ? last.effectiveFrom
      : [rules.today, nextDay(last.effectiveFrom)].sort()[1];
    openEditor(
      editorFrom(
        last,
        stream.scope,
        stream.subjectPublicId ?? "",
        effectiveFrom,
        stream.key,
      ),
    );
  };
  const hasGroups = (overviewQuery.data?.workforceGroups.length ?? 0) > 0;
  const startAdd = () => {
    if (!rules || !companyRuleInForce) return;
    openEditor(
      editorFrom(
        companyRuleInForce,
        hasGroups ? "WORKFORCE_GROUP" : "USER",
        "",
        rules.today,
        null,
      ),
    );
  };

  const focusFirstInvalid = (errors: Record<string, string>) => {
    const ids: Record<string, string> = {
      scope: "policy-scope",
      subjectPublicId: "policy-subject",
      mode: "policy-mode",
      allowanceDays: "policy-allowance",
      effectiveFrom: "policy-effective-from",
      carryoverEnabled: "policy-carryover-enabled",
      carryoverMaxDays: "policy-carryover-max",
      carryoverDeadlineMonth: "policy-carryover-month",
      carryoverDeadlineDay: "policy-carryover-day",
      carryoverRepeat: "policy-carryover-repeat",
    };
    const target = Object.keys(errors)
      .map((field) => ids[field])
      .find(Boolean);
    requestAnimationFrame(() =>
      (target ? document.getElementById(target) : errorRef.current)?.focus(),
    );
  };
  const showFailure = async (cause: unknown, inEditor: boolean) => {
    const violations =
      cause instanceof ApiError
        ? fieldErrorsFromApiError(cause.fieldViolations)
        : null;
    if (violations && inEditor) {
      setFieldErrors(violations);
      setError(t("policy.errors.validation"));
      focusFirstInvalid(violations);
      return;
    }
    if (violations) {
      // A removal has no field to point at; the API's sentence already says what to do instead.
      setError(Object.values(violations)[0]);
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    const code = cause instanceof ApiError ? cause.problem.code : undefined;
    if (code === "stale-policy-rules") {
      // Someone else changed a rule of this type. The list reloads with its new revision and the
      // editor keeps what the admin typed, so a second Save is judged against what they now see.
      await rulesQuery.refetch();
    }
    setError(
      t(
        code === "stale-policy-rules"
          ? "policy.errors.stale"
          : code === "capability-unavailable"
            ? "policy.errors.capabilityUnavailable"
            : "policy.errors.save",
      ),
    );
    requestAnimationFrame(() => errorRef.current?.focus());
  };
  const afterWrite = async (next: PolicyRulesResponse) => {
    queryClient.setQueryData(rulesKey, next);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["policy-settings-overview", orgId] }),
      queryClient.invalidateQueries({ queryKey: ["managed-leave-types", orgId] }),
      queryClient.invalidateQueries({ queryKey: ["policy-rule-impact", leaveTypePublicId] }),
    ]);
  };
  const save = async () => {
    if (!rules || !body || saving) return;
    setSaving(true);
    try {
      const next = await savePolicyRule(leaveTypePublicId, {
        expectedRevision: rules.revision,
        ...body,
      });
      await afterWrite(next);
      closeEditor();
      showToast(t("policy.success.saved"), "success");
    } catch (cause) {
      await showFailure(cause, true);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!rules || !removeTarget || removing) return;
    setRemoving(true);
    try {
      const next = await removePolicyRule(
        leaveTypePublicId,
        removeTarget.assignmentPublicId,
        rules.revision,
      );
      await afterWrite(next);
      setRemoveTarget(null);
      showToast(t("policy.success.removed"), "success");
    } catch (cause) {
      setRemoveTarget(null);
      await showFailure(cause, false);
    } finally {
      setRemoving(false);
    }
  };

  if (rulesQuery.isPending)
    return (
      <div className="page page-wide">
        <p>{t("policy.loading")}</p>
      </div>
    );
  if (rulesQuery.isError || !rules)
    return (
      <div className="page page-wide">
        <div role="alert">{t("policy.errors.load")}</div>
        <Link className="btn btn-outline" to="/settings?category=leave-policies">
          {t("policy.actions.back")}
        </Link>
      </div>
    );

  const fieldError = (field: string, id: string) =>
    shownErrors[field] ? (
      <span id={id} className="form-error" role="alert">
        {shownErrors[field]}
      </span>
    ) : null;
  const invalidProps = (field: string, id: string) => ({
    "aria-invalid": Boolean(shownErrors[field]),
    "aria-describedby": shownErrors[field] ? id : undefined,
  });

  const editorPanel = editor && (
    <section
      className="policy-rule-editor"
      aria-labelledby="policy-editor-title"
      data-testid="policy-rule-editor"
    >
      <h3 id="policy-editor-title" className="policy-rule-editor-title">
        {editor.streamKey ? t("policy.editor.changeTitle") : t("policy.editor.addTitle")}
      </h3>
      {editor.streamKey == null && (
        <div className="policy-rule-editor-row">
          <label className="form-field">
            <span>{t("policy.fields.scope")}</span>
            <select
              id="policy-scope"
              {...invalidProps("scope", "policy-scope-error")}
              value={editor.scope}
              onChange={(e) =>
                edit({ scope: e.target.value as Scope, subjectPublicId: "" })
              }
            >
              {/* A tenant starts with no Workforce Groups, so the scope is offered only once one
                  exists; before that it leads only to an empty list. */}
              {hasGroups && (
                <option value="WORKFORCE_GROUP">{t("policy.scopes.group")}</option>
              )}
              <option value="USER">{t("policy.scopes.user")}</option>
            </select>
            {fieldError("scope", "policy-scope-error")}
          </label>
          <label className="form-field">
            <span>
              {t(
                editor.scope === "USER"
                  ? "policy.fields.person"
                  : "policy.fields.group",
              )}
            </span>
            <select
              id="policy-subject"
              {...invalidProps("subjectPublicId", "policy-subject-error")}
              value={editor.subjectPublicId}
              onChange={(e) => edit({ subjectPublicId: e.target.value })}
            >
              <option value="">{t("policy.fields.selectSubject")}</option>
              {(editor.scope === "USER"
                ? overviewQuery.data?.users
                : overviewQuery.data?.workforceGroups
              )?.map((target) => (
                <option key={target.publicId} value={target.publicId}>
                  {target.name}
                </option>
              ))}
            </select>
            {fieldError("subjectPublicId", "policy-subject-error")}
          </label>
        </div>
      )}
      <div className="policy-rule-editor-row">
        <label className="form-field">
          <span>{t("policy.fields.mode")}</span>
          <select
            id="policy-mode"
            {...invalidProps("mode", "policy-mode-error")}
            value={editor.mode}
            onChange={(e) => edit({ mode: e.target.value as Mode })}
          >
            <option value="ANNUAL_ALLOWANCE">{t("policy.modes.annual")}</option>
            <option value="UNLIMITED">{t("policy.modes.unlimited")}</option>
          </select>
          {fieldError("mode", "policy-mode-error")}
        </label>
        {editor.mode === "ANNUAL_ALLOWANCE" && (
          <label className="form-field">
            <span>{t("policy.fields.allowance")}</span>
            <input
              id="policy-allowance"
              {...invalidProps("allowanceDays", "policy-allowance-error")}
              type="number"
              min="1"
              value={editor.allowanceDays}
              onChange={(e) => edit({ allowanceDays: e.target.value })}
            />
            {fieldError("allowanceDays", "policy-allowance-error")}
          </label>
        )}
        <label className="form-field">
          <span>{t("policy.fields.effectiveFrom")}</span>
          <DateField
            id="policy-effective-from"
            {...invalidProps("effectiveFrom", "policy-effective-from-error")}
            value={editor.effectiveFrom}
            onChange={(value) => edit({ effectiveFrom: value })}
          />
          {fieldError("effectiveFrom", "policy-effective-from-error")}
        </label>
      </div>
      {editor.mode === "ANNUAL_ALLOWANCE" && (
        <fieldset className="policy-carryover" data-testid="policy-carryover">
          <legend>{t("policy.carryover.legend")}</legend>
          <label className="policy-carryover-check">
            <input
              id="policy-carryover-enabled"
              type="checkbox"
              checked={editor.carryoverEnabled}
              onChange={(e) => {
                const enabled = e.target.checked;
                // Turning carry-over on proposes the common 31 March deadline rather than an
                // empty pair the API would only reject.
                const pickDefault = enabled && editor.carryoverDeadlineMonth === "";
                edit({
                  carryoverEnabled: enabled,
                  carryoverDeadlineMonth: pickDefault ? "3" : editor.carryoverDeadlineMonth,
                  carryoverDeadlineDay: pickDefault ? "31" : editor.carryoverDeadlineDay,
                });
              }}
            />
            {t("policy.carryover.enabled")}
          </label>
          {fieldError("carryoverEnabled", "policy-carryover-enabled-error")}
          {editor.carryoverEnabled && (
            <>
              <div className="policy-carryover-row">
                <label className="form-field">
                  <span>{t("policy.carryover.maxDays")}</span>
                  <input
                    id="policy-carryover-max"
                    type="number"
                    min="1"
                    disabled={editor.carryoverNoLimit}
                    {...invalidProps("carryoverMaxDays", "policy-carryover-max-error")}
                    value={editor.carryoverMaxDays}
                    onChange={(e) => edit({ carryoverMaxDays: e.target.value })}
                  />
                  {fieldError("carryoverMaxDays", "policy-carryover-max-error")}
                </label>
                <label className="policy-carryover-check">
                  <input
                    id="policy-carryover-no-limit"
                    type="checkbox"
                    checked={editor.carryoverNoLimit}
                    onChange={(e) =>
                      edit({
                        carryoverNoLimit: e.target.checked,
                        carryoverMaxDays: e.target.checked ? "" : editor.carryoverMaxDays,
                      })
                    }
                  />
                  {t("policy.carryover.noLimit")}
                </label>
              </div>
              <span id="policy-carryover-deadline-label">
                {t("policy.carryover.deadline")}
              </span>
              <div
                className="policy-carryover-row"
                role="group"
                aria-labelledby="policy-carryover-deadline-label"
                aria-describedby="policy-carryover-deadline-hint"
              >
                <label className="form-field">
                  <span>{t("policy.carryover.month")}</span>
                  <select
                    id="policy-carryover-month"
                    {...invalidProps(
                      "carryoverDeadlineMonth",
                      "policy-carryover-month-error",
                    )}
                    value={editor.carryoverDeadlineMonth}
                    onChange={(e) => {
                      const month = e.target.value;
                      const day = editor.carryoverDeadlineDay;
                      edit({
                        carryoverDeadlineMonth: month,
                        carryoverDeadlineDay:
                          day !== "" && Number(day) > daysInDeadlineMonth(month) ? "" : day,
                      });
                    }}
                  >
                    <option value="">{t("policy.carryover.selectMonth")}</option>
                    {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                      <option key={month} value={String(month)}>
                        {monthName(month)}
                      </option>
                    ))}
                  </select>
                  {fieldError("carryoverDeadlineMonth", "policy-carryover-month-error")}
                </label>
                <label className="form-field">
                  <span>{t("policy.carryover.day")}</span>
                  <select
                    id="policy-carryover-day"
                    {...invalidProps("carryoverDeadlineDay", "policy-carryover-day-error")}
                    value={editor.carryoverDeadlineDay}
                    onChange={(e) => edit({ carryoverDeadlineDay: e.target.value })}
                  >
                    <option value="">{t("policy.carryover.selectDay")}</option>
                    {Array.from(
                      { length: daysInDeadlineMonth(editor.carryoverDeadlineMonth) },
                      (_, index) => index + 1,
                    ).map((day) => (
                      <option key={day} value={String(day)}>
                        {day}
                      </option>
                    ))}
                  </select>
                  {fieldError("carryoverDeadlineDay", "policy-carryover-day-error")}
                </label>
              </div>
              <p id="policy-carryover-deadline-hint" className="policy-carryover-hint">
                {t("policy.carryover.deadlineHint")}
              </p>
              <label className="policy-carryover-check">
                <input
                  id="policy-carryover-repeat"
                  type="checkbox"
                  checked={editor.carryoverRepeat}
                  onChange={(e) => edit({ carryoverRepeat: e.target.checked })}
                />
                {t("policy.carryover.repeat")}
              </label>
            </>
          )}
        </fieldset>
      )}
      <section
        className="policy-impact"
        aria-labelledby="policy-impact-title"
        aria-live="polite"
        data-testid="policy-impact"
      >
        <h4 id="policy-impact-title" className="policy-impact-title">
          {t("policy.impact.title")}
        </h4>
        {body == null ? (
          <p>{t("policy.impact.incomplete")}</p>
        ) : impactQuery.isError && !impactViolations ? (
          <p>{t("policy.impact.error")}</p>
        ) : impactViolations ? (
          <p>{t("policy.impact.invalid")}</p>
        ) : !impactQuery.data ? (
          <p>{t("policy.impact.loading")}</p>
        ) : (
          <>
            {impactQuery.data.correction && (
              <p data-testid="policy-impact-replaces">
                {t("policy.impact.replaces", {
                  date: formatDate(editor.effectiveFrom),
                })}
              </p>
            )}
            <p>
              {t("policy.impact.people", {
                count: impactQuery.data.affectedMemberCount,
              })}
            </p>
            {impactQuery.data.conflicts.length > 0 && (
              <ul className="policy-impact-warnings">
                {impactQuery.data.conflicts.map((conflict) => (
                  <li key={conflict}>{conflictLabel(conflict)}</li>
                ))}
              </ul>
            )}
            {impactQuery.data.impacts.length > 0 && (
              <ul className="policy-impact-list">
                {impactQuery.data.impacts.map((impact) => (
                  <li key={impact.memberPublicId}>
                    <bdi>
                      {memberName(impact.memberPublicId) ??
                        t("policy.impact.unknownMember")}
                    </bdi>
                    :{" "}
                    {impact.proposedAllowance == null
                      ? t("policy.impact.balanceUnlimited", {
                          used: impact.usedDays,
                        })
                      : t("policy.impact.balance", {
                          used: impact.usedDays,
                          allowance: impact.proposedAllowance,
                          remaining: impact.projectedRemaining,
                        })}
                    {impact.projectedCarryoverDays != null
                      ? ` · ${t("policy.impact.carryover", {
                          count: impact.projectedCarryoverDays,
                        })}`
                      : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
      <div className="policy-actions">
        <button
          className="btn btn-primary"
          type="button"
          disabled={body == null || saving}
          onClick={save}
        >
          {t("policy.actions.save")}
        </button>
        <button className="btn btn-outline" type="button" onClick={closeEditor}>
          {t("policy.actions.cancel")}
        </button>
      </div>
    </section>
  );

  const ruleItem = (rule: PolicyRule) => (
    <li
      key={rule.assignmentPublicId}
      className="policy-rule"
      data-testid={`policy-rule-${rule.assignmentPublicId}`}
    >
      <div className="policy-rule-main">
        <span className="policy-rule-terms">{termsLine(rule)}</span>
        <span
          className={`badge ${
            rule.state === "IN_FORCE"
              ? "badge-approved"
              : rule.state === "UPCOMING"
                ? "badge-pending"
                : "badge-cancelled"
          }`}
        >
          {t(
            rule.state === "IN_FORCE"
              ? "policy.states.inForce"
              : rule.state === "UPCOMING"
                ? "policy.states.upcoming"
                : "policy.states.ended",
          )}
        </span>
      </div>
      <div className="policy-rule-meta">
        <span>{datesLine(rule)}</span>
        <span>{setByLine(rule)}</span>
      </div>
      {rules.changesAvailable && rule.state === "UPCOMING" && rule.changeable && (
        <button
          className="btn btn-outline btn-sm policy-rule-remove"
          type="button"
          disabled={editor != null}
          onClick={() => setRemoveTarget(rule)}
        >
          {t("policy.actions.remove")}
        </button>
      )}
    </li>
  );

  const streamCard = (stream: Stream) => {
    const current = stream.rules.filter((rule) => rule.state !== "ENDED");
    const earlier = stream.rules.filter((rule) => rule.state === "ENDED");
    const editing = editor?.streamKey === stream.key;
    return (
      <article
        key={stream.key}
        className="policy-stream"
        data-testid={`policy-stream-${stream.key}`}
        aria-labelledby={`policy-stream-${stream.key}-title`}
      >
        <header className="policy-stream-header">
          <h3 id={`policy-stream-${stream.key}-title`} className="policy-stream-title">
            <bdi>{streamTitle(stream)}</bdi>
          </h3>
          {rules.changesAvailable && (
            <button
              className="btn btn-outline btn-sm"
              type="button"
              disabled={editor != null}
              aria-label={t("policy.aria.change", { name: isolate(streamTitle(stream)) })}
              onClick={() => startChange(stream)}
            >
              {t("policy.actions.change")}
            </button>
          )}
        </header>
        <ul className="policy-rule-list">{current.map(ruleItem)}</ul>
        {earlier.length > 0 && (
          <details className="policy-earlier">
            <summary>{t("policy.rules.earlier", { count: earlier.length })}</summary>
            <ul className="policy-rule-list">{earlier.map(ruleItem)}</ul>
          </details>
        )}
        {editing && editorPanel}
      </article>
    );
  };

  const sections: { scope: Scope; title: string; empty: string }[] = [
    {
      scope: "ORGANIZATION",
      title: t("policy.sections.company"),
      empty: t("policy.sections.companyEmpty"),
    },
    {
      scope: "WORKFORCE_GROUP",
      title: t("policy.sections.groups"),
      empty: t("policy.sections.groupsEmpty"),
    },
    {
      scope: "USER",
      title: t("policy.sections.people"),
      empty: t("policy.sections.peopleEmpty"),
    },
  ];

  return (
    <div className="page page-wide policy-page" data-testid="policy-rules-page">
      <header className="page-header policy-page-header">
        <div>
          <Link to="/settings?category=leave-policies" className="policy-back">
            {t("policy.actions.back")}
          </Link>
          <h1 className="page-title">
            {t("policy.title", { name: isolate(rules.leaveTypeName) })}
          </h1>
          <p className="page-sub">{t("policy.subtitle")}</p>
        </div>
        {rules.changesAvailable && (
          <button
            className="btn btn-primary"
            type="button"
            disabled={editor != null || !companyRuleInForce || !overviewQuery.isSuccess}
            onClick={startAdd}
          >
            {t("policy.actions.add")}
          </button>
        )}
      </header>
      {!rules.changesAvailable && (
        // The plan or billing state rules out every change, so the page offers none rather than
        // opening an editor whose impact check and Save could only answer 403.
        <p className="policy-notice" data-testid="policy-read-only">
          {t("policy.readOnly")}
        </p>
      )}
      {error && (
        <div ref={errorRef} tabIndex={-1} role="alert" className="policy-alert">
          {error}
        </div>
      )}
      {overviewQuery.isError && (
        <div role="alert" className="policy-alert">
          <p>{t("policy.overview.error")}</p>
          <button
            className="btn btn-outline btn-sm"
            type="button"
            onClick={() => overviewQuery.refetch()}
          >
            {t("policy.actions.retry")}
          </button>
        </div>
      )}
      {editor?.streamKey == null && editorPanel && (
        <div className="settings-card policy-section">{editorPanel}</div>
      )}
      {sections.map((section) => {
        const inSection = streams.filter((stream) => stream.scope === section.scope);
        return (
          <section
            key={section.scope}
            className="settings-card policy-section"
            aria-labelledby={`policy-section-${section.scope}`}
          >
            <h2 id={`policy-section-${section.scope}`}>{section.title}</h2>
            {inSection.length === 0 ? (
              <p className="policy-section-empty">{section.empty}</p>
            ) : (
              inSection.map(streamCard)
            )}
          </section>
        );
      })}
      {removeTarget && (
        <Modal
          labelledBy="policy-remove-title"
          onClose={() => setRemoveTarget(null)}
          closeOnBackdrop={false}
        >
          <div className="modal-header">
            <h2 className="modal-title" id="policy-remove-title">
              {t("policy.remove.title")}
            </h2>
          </div>
          <div className="modal-body">
            <p>
              {t("policy.remove.copy", {
                terms: termsLine(removeTarget),
                date: formatDate(removeTarget.effectiveFrom),
              })}
            </p>
          </div>
          <div className="modal-actions">
            <button
              className="btn btn-outline"
              type="button"
              onClick={() => setRemoveTarget(null)}
            >
              {t("policy.actions.cancel")}
            </button>
            <button
              className="btn btn-danger"
              type="button"
              disabled={removing}
              onClick={remove}
            >
              {t("policy.actions.confirmRemove")}
            </button>
          </div>
        </Modal>
      )}
      {dataRouterContext && <RulesRouteBlocker dirty={dirty} />}
    </div>
  );
}
