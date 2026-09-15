import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  UNSAFE_DataRouterContext,
  useBlocker,
  useParams,
} from "react-router-dom";
import {
  ApiError,
  getPolicyDraft,
  getPolicyHistory,
  getPolicySettingsOverview,
  previewPolicy,
  publishPolicy,
  updatePolicyDraft,
} from "../../api/client";
import { fieldErrorsFromApiError } from "../../api/fieldViolations";
import type {
  PolicyDraftResponse,
  PolicyPreviewResponse,
} from "../../api/generated/types";
import { DateField } from "../../components/DateField";
import { Modal } from "../../components/ui/Modal";
import { CloseIcon } from "../../components/ui/icons";
import { useToast } from "../../components/ui/useToast";
import { useAuth } from "../../auth/useAuth";
import { isolate } from "../../i18n/bidi";
import "./policy-settings.css";

type FormState = {
  mode: "ANNUAL_ALLOWANCE" | "UNLIMITED";
  allowanceDays: string;
  scope: "ORGANIZATION" | "WORKFORCE_GROUP" | "USER";
  subjectPublicId: string;
  effectiveFrom: string;
  carryoverEnabled: boolean;
  carryoverNoLimit: boolean;
  carryoverMaxDays: string;
  carryoverDeadlineMonth: string;
  carryoverDeadlineDay: string;
  carryoverRepeat: boolean;
};
const optionalNumber = (value: number | null | undefined) =>
  value == null ? "" : String(value);
const fromDraft = (draft: PolicyDraftResponse): FormState => ({
  mode: draft.mode,
  allowanceDays: optionalNumber(draft.allowanceDays),
  scope: draft.scope,
  subjectPublicId: draft.subjectPublicId ?? "",
  effectiveFrom: draft.effectiveFrom,
  carryoverEnabled: Boolean(draft.carryoverEnabled),
  carryoverNoLimit: Boolean(draft.carryoverEnabled) && draft.carryoverMaxDays == null,
  carryoverMaxDays: optionalNumber(draft.carryoverMaxDays),
  carryoverDeadlineMonth: optionalNumber(draft.carryoverDeadlineMonth),
  carryoverDeadlineDay: optionalNumber(draft.carryoverDeadlineDay),
  carryoverRepeat: Boolean(draft.carryoverRepeat),
});

// Plan RESTO: the deadline is a month and day of the year after the balance year, never 29 February
// (the API rejects it), so February offers 28 days whatever the year.
const daysInDeadlineMonth = (month: string) =>
  month === "2" ? 28 : ["4", "6", "9", "11"].includes(month) ? 30 : 31;
const fieldNumber = (value: string) => (value === "" ? undefined : Number(value));
const carryoverBody = (state: FormState) =>
  state.mode === "ANNUAL_ALLOWANCE" && state.carryoverEnabled
    ? {
        carryoverEnabled: true,
        // No limit is an absent maximum, not a zero.
        carryoverMaxDays: state.carryoverNoLimit
          ? undefined
          : fieldNumber(state.carryoverMaxDays),
        carryoverDeadlineMonth: fieldNumber(state.carryoverDeadlineMonth),
        carryoverDeadlineDay: fieldNumber(state.carryoverDeadlineDay),
        carryoverRepeat: state.carryoverRepeat,
      }
    : { carryoverEnabled: false };

type CarryoverRule = {
  carryoverEnabled?: boolean | null;
  carryoverMaxDays?: number | null;
  carryoverDeadlineMonth?: number | null;
  carryoverDeadlineDay?: number | null;
  carryoverRepeat?: boolean | null;
};

function PolicyRouteBlocker({ dirty }: { dirty: boolean }) {
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

export function PolicySettingsPage() {
  const { t, i18n } = useTranslation("settings");
  const dataRouterContext = useContext(UNSAFE_DataRouterContext);
  const { draftPublicId = "" } = useParams();
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const organizationTimezone = user?.organizationTimezone || "UTC";
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const errorRef = useRef<HTMLDivElement>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saved, setSaved] = useState<FormState | null>(null);
  const [preview, setPreview] = useState<PolicyPreviewResponse | null>(null);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [historyConfirmed, setHistoryConfirmed] = useState(false);
  const [staleDraft, setStaleDraft] = useState(false);
  const draftQuery = useQuery({
    queryKey: ["policy-draft", draftPublicId],
    queryFn: () => getPolicyDraft(draftPublicId),
    enabled: Boolean(draftPublicId),
  });
  const overviewQuery = useQuery({
    // Same key shape as LeaveTypesCard: a bare key would be a second cache entry that the card's
    // invalidation could never reach, leaving this page showing pre-lifecycle targets.
    queryKey: ["policy-settings-overview", orgId],
    queryFn: getPolicySettingsOverview,
  });
  // Gate the WORKFORCE_GROUP scope on the organization actually having groups. Left ungated
  // while the overview is still loading, so an in-flight query never hides a scope the admin
  // is entitled to.
  const hasWorkforceGroups =
    !overviewQuery.isSuccess ||
    (overviewQuery.data?.workforceGroups.length ?? 0) > 0;
  const historyQuery = useQuery({
    queryKey: ["policy-history", draftQuery.data?.policyPublicId],
    queryFn: () => getPolicyHistory(draftQuery.data!.policyPublicId),
    enabled: Boolean(draftQuery.data?.policyPublicId),
  });
  useEffect(() => {
    if (draftQuery.data && !form) {
      const initial = fromDraft(draftQuery.data);
      setForm(initial);
      setSaved(initial);
    }
  }, [draftQuery.data, form]);
  const dirty = useMemo(
    () =>
      form != null &&
      saved != null &&
      JSON.stringify(form) !== JSON.stringify(saved),
    [form, saved],
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

  // Effective dates are date-only Organization-local values; publication timestamps are UTC
  // instants. Rendering either as a raw ISO string leaves Arabic readers with Latin digits and an
  // unlabelled UTC time, so both go through the viewer's locale.
  const formatDate = (value: string | null | undefined) => {
    if (!value) return "";
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return value;
    return new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(parsed);
  };
  const formatInstant = (value: string | null | undefined) => {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: organizationTimezone,
    }).format(parsed);
  };

  const monthName = (month: number) =>
    new Intl.DateTimeFormat(i18n.language, {
      month: "long",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2001, month - 1, 1)));
  const carryoverSummary = (rule: CarryoverRule) => {
    if (
      !rule.carryoverEnabled ||
      rule.carryoverDeadlineMonth == null ||
      rule.carryoverDeadlineDay == null
    ) {
      return t("policy.carryover.summaryOff");
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

  const namedTarget = (publicId: string | null | undefined) => {
    const target =
      overviewQuery.data?.users.find((item) => item.publicId === publicId) ??
      overviewQuery.data?.workforceGroups.find(
        (item) => item.publicId === publicId,
      );
    return target?.name?.trim() || undefined;
  };
  const scopeLabel = (
    scope: FormState["scope"],
    subjectPublicId?: string | null,
  ) => {
    if (scope === "ORGANIZATION") return t("policy.scopes.organization");
    return (
      namedTarget(subjectPublicId) ??
      t(
        scope === "USER"
          ? "policy.scopes.unknownUser"
          : "policy.scopes.unknownGroup",
      )
    );
  };
  const conflictLabel = (conflict: string) => {
    if (conflict === "NO_ACTIVE_MEMBERS_IN_SCOPE") {
      return t("policy.conflicts.noActiveMembers");
    }
    const prefix = "ALLOWANCE_BELOW_USED:";
    if (conflict.startsWith(prefix)) {
      return t("policy.conflicts.allowanceBelowUsed", {
        name:
          namedTarget(conflict.slice(prefix.length)) ??
          t("policy.review.unknownMember"),
      });
    }
    return t("policy.conflicts.unknown");
  };
  const focusValidation = (errors: Record<string, string>) => {
    const ids: Record<string, string> = {
      mode: "policy-mode",
      allowanceDays: "policy-allowance",
      scope: "policy-scope",
      subjectPublicId: "policy-subject",
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

  const reviewMutation = useMutation({
    mutationFn: async () => {
      if (!form || !draftQuery.data) throw new Error("missing-draft");
      let current = draftQuery.data;
      if (dirty)
        current = await updatePolicyDraft(draftPublicId, {
          expectedRevision: draftQuery.data.revision,
          mode: form.mode,
          allowanceDays:
            form.mode === "ANNUAL_ALLOWANCE"
              ? Number(form.allowanceDays)
              : undefined,
          balancePeriod: "CALENDAR_YEAR",
          scope: form.scope,
          subjectPublicId:
            form.scope === "ORGANIZATION" ? undefined : form.subjectPublicId,
          effectiveFrom: form.effectiveFrom,
          ...carryoverBody(form),
        });
      if (current !== draftQuery.data) {
        const currentForm = fromDraft(current);
        queryClient.setQueryData(["policy-draft", draftPublicId], current);
        setSaved(currentForm);
        setForm(currentForm);
      }
      const evidence = await previewPolicy(draftPublicId);
      return { current, evidence };
    },
    onSuccess: ({ current, evidence }) => {
      const currentForm = fromDraft(current);
      setSaved(currentForm);
      setForm(currentForm);
      setPreview(evidence);
      idempotencyKeyRef.current = crypto.randomUUID();
      setError("");
      setFieldErrors({});
      setStaleDraft(false);
      queryClient.setQueryData(["policy-draft", draftPublicId], current);
    },
    onError: (cause) => {
      setPreview(null);
      idempotencyKeyRef.current = null;
      const violations =
        cause instanceof ApiError
          ? fieldErrorsFromApiError(cause.fieldViolations)
          : null;
      if (violations) {
        setFieldErrors(violations);
        setError(t("policy.errors.validation"));
        focusValidation(violations);
      } else {
        const code = cause instanceof ApiError ? cause.problem.code : undefined;
        setStaleDraft(code === "stale-policy-draft");
        setError(
          t(
            code === "capability-unavailable"
              ? "policy.errors.capabilityUnavailable"
              : code === "stale-policy-preview" || code === "stale-policy-draft"
                ? "policy.errors.stale"
                : "policy.errors.preview",
          ),
        );
        requestAnimationFrame(() => errorRef.current?.focus());
      }
    },
  });
  const reloadLatestDraft = async () => {
    const result = await draftQuery.refetch();
    if (result.data) {
      setSaved(fromDraft(result.data));
      setStaleDraft(false);
      setError("");
      setFieldErrors({});
    }
  };
  const publishMutation = useMutation({
    mutationFn: () =>
      publishPolicy(draftPublicId, idempotencyKeyRef.current!, {
        expectedDraftRevision: preview!.draftRevision,
        previewHash: preview!.decisionHash,
        policyRevision: preview!.policyRevision,
        workforceRevision: preview!.workforceRevision,
        entitlementRevision: preview!.entitlementRevision,
      }),
    onSuccess: async () => {
      setConfirmOpen(false);
      setPreview(null);
      idempotencyKeyRef.current = null;
      setHistoryConfirmed(false);
      showToast(t("policy.success.published"), "success");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["policy-draft", draftPublicId],
        }),
        queryClient.invalidateQueries({ queryKey: ["policy-history"] }),
        queryClient.invalidateQueries({
          queryKey: ["policy-settings-overview", orgId],
        }),
      ]);
    },
    onError: (cause) => {
      const code = cause instanceof ApiError ? cause.problem.code : undefined;
      const violations =
        cause instanceof ApiError
          ? fieldErrorsFromApiError(cause.fieldViolations)
          : null;
      // A field violation at publish time is terminal — most often an effectiveFrom that slipped
      // past the Organization's today while the draft sat open. Retrying the same evidence can
      // never succeed, so surface the field rather than the generic "could not be confirmed".
      if (violations) {
        setConfirmOpen(false);
        setPreview(null);
        idempotencyKeyRef.current = null;
        setFieldErrors(violations);
        setError(t("policy.errors.validation"));
        focusValidation(violations);
        return;
      }
      // An idempotency conflict means this key already resolved against different evidence:
      // reusing it reproduces the conflict forever, so drop it and send the user back to review.
      const conflict = code === "policy-idempotency-conflict";
      const stale =
        code === "stale-policy-preview" || code === "stale-policy-draft";
      const capabilityUnavailable = code === "capability-unavailable";
      if (stale || conflict || capabilityUnavailable) {
        setConfirmOpen(false);
        setPreview(null);
        idempotencyKeyRef.current = null;
      }
      setError(
        t(
          capabilityUnavailable
            ? "policy.errors.capabilityUnavailable"
            : conflict
              ? "policy.errors.idempotencyConflict"
              : stale
                ? "policy.errors.stale"
                : "policy.errors.publishRetry",
        ),
      );
      requestAnimationFrame(() => errorRef.current?.focus());
    },
  });

  if (draftQuery.isPending || !form)
    return (
      <div className="page page-wide">
        <p>{t("policy.loading")}</p>
      </div>
    );
  if (draftQuery.isError)
    return (
      <div className="page page-wide">
        <div role="alert">{t("policy.errors.load")}</div>
        <Link
          className="btn btn-outline"
          to="/settings?category=leave-policies"
        >
          {t("policy.actions.back")}
        </Link>
      </div>
    );
  return (
    <div
      className="page page-wide policy-page"
      data-testid="policy-settings-page"
    >
      <header className="page-header policy-page-header">
        <div>
          <Link to="/settings?category=leave-policies" className="policy-back">
            {t("policy.actions.back")}
          </Link>
          <h1 className="page-title">{t("policy.title")}</h1>
          <p className="page-sub">{t("policy.subtitle")}</p>
        </div>
        <span
          className={`badge ${
            draftQuery.data.consumed ? "badge-approved" : "badge-pending"
          }`}
        >
          {draftQuery.data.consumed
            ? t("policy.states.published")
            : t("policy.states.draft")}
        </span>
      </header>
      {error && (
        <div ref={errorRef} tabIndex={-1} role="alert" className="policy-alert">
          {error}
          {staleDraft && (
            <button className="btn btn-outline btn-sm" type="button" onClick={reloadLatestDraft}>
              {t("policy.actions.reloadLatest")}
            </button>
          )}
        </div>
      )}
      {overviewQuery.isPending && <p role="status">{t("policy.overview.loading")}</p>}
      {overviewQuery.isError && (
        <div role="alert" className="policy-alert">
          <p>{t("policy.overview.error")}</p>
          <button className="btn btn-outline btn-sm" type="button" onClick={() => overviewQuery.refetch()}>
            {t("policy.actions.retry")}
          </button>
        </div>
      )}
      <div className="policy-workspace">
        <section className="settings-card policy-editor">
          <h2>{t("policy.editor.title")}</h2>
          <label className="form-field">
            <span>{t("policy.fields.mode")}</span>
            <select
              id="policy-mode"
              aria-invalid={Boolean(fieldErrors.mode)}
              aria-describedby={
                fieldErrors.mode ? "policy-mode-error" : undefined
              }
              value={form.mode}
              onChange={(e) => {
                setForm({ ...form, mode: e.target.value as FormState["mode"] });
                setPreview(null);
              }}
            >
              <option value="ANNUAL_ALLOWANCE">
                {t("policy.modes.annual")}
              </option>
              <option value="UNLIMITED">{t("policy.modes.unlimited")}</option>
            </select>
            {fieldErrors.mode && (
              <span id="policy-mode-error" className="form-error" role="alert">
                {fieldErrors.mode}
              </span>
            )}
          </label>
          {form.mode === "ANNUAL_ALLOWANCE" && (
            <label className="form-field">
              <span>{t("policy.fields.allowance")}</span>
              <input
                id="policy-allowance"
                aria-invalid={Boolean(fieldErrors.allowanceDays)}
                aria-describedby={
                  fieldErrors.allowanceDays
                    ? "policy-allowance-error"
                    : undefined
                }
                type="number"
                min="1"
                value={form.allowanceDays}
                onChange={(e) => {
                  setForm({ ...form, allowanceDays: e.target.value });
                  setPreview(null);
                }}
              />
              {fieldErrors.allowanceDays && (
                <span
                  id="policy-allowance-error"
                  className="form-error"
                  role="alert"
                >
                  {fieldErrors.allowanceDays}
                </span>
              )}
            </label>
          )}
          {form.mode === "ANNUAL_ALLOWANCE" && (
            <fieldset className="policy-carryover" data-testid="policy-carryover">
              <legend>{t("policy.carryover.legend")}</legend>
              <label className="policy-carryover-check">
                <input
                  id="policy-carryover-enabled"
                  type="checkbox"
                  checked={form.carryoverEnabled}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    // Turning carry-over on proposes the common 31 March deadline rather than an
                    // empty pair the API would only reject.
                    const pickDefault = enabled && form.carryoverDeadlineMonth === "";
                    setForm({
                      ...form,
                      carryoverEnabled: enabled,
                      carryoverDeadlineMonth: pickDefault ? "3" : form.carryoverDeadlineMonth,
                      carryoverDeadlineDay: pickDefault ? "31" : form.carryoverDeadlineDay,
                    });
                    setPreview(null);
                  }}
                />
                {t("policy.carryover.enabled")}
              </label>
              {fieldErrors.carryoverEnabled && (
                <span className="form-error" role="alert">
                  {fieldErrors.carryoverEnabled}
                </span>
              )}
              {form.carryoverEnabled && (
                <>
                  <div className="policy-carryover-row">
                    <label className="form-field">
                      <span>{t("policy.carryover.maxDays")}</span>
                      <input
                        id="policy-carryover-max"
                        type="number"
                        min="1"
                        disabled={form.carryoverNoLimit}
                        aria-invalid={Boolean(fieldErrors.carryoverMaxDays)}
                        aria-describedby={
                          fieldErrors.carryoverMaxDays
                            ? "policy-carryover-max-error"
                            : undefined
                        }
                        value={form.carryoverMaxDays}
                        onChange={(e) => {
                          setForm({ ...form, carryoverMaxDays: e.target.value });
                          setPreview(null);
                        }}
                      />
                      {fieldErrors.carryoverMaxDays && (
                        <span
                          id="policy-carryover-max-error"
                          className="form-error"
                          role="alert"
                        >
                          {fieldErrors.carryoverMaxDays}
                        </span>
                      )}
                    </label>
                    <label className="policy-carryover-check">
                      <input
                        id="policy-carryover-no-limit"
                        type="checkbox"
                        checked={form.carryoverNoLimit}
                        onChange={(e) => {
                          setForm({
                            ...form,
                            carryoverNoLimit: e.target.checked,
                            carryoverMaxDays: e.target.checked ? "" : form.carryoverMaxDays,
                          });
                          setPreview(null);
                        }}
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
                        aria-invalid={Boolean(fieldErrors.carryoverDeadlineMonth)}
                        aria-describedby={
                          fieldErrors.carryoverDeadlineMonth
                            ? "policy-carryover-month-error"
                            : undefined
                        }
                        value={form.carryoverDeadlineMonth}
                        onChange={(e) => {
                          const month = e.target.value;
                          const day = form.carryoverDeadlineDay;
                          setForm({
                            ...form,
                            carryoverDeadlineMonth: month,
                            carryoverDeadlineDay:
                              day !== "" && Number(day) > daysInDeadlineMonth(month) ? "" : day,
                          });
                          setPreview(null);
                        }}
                      >
                        <option value="">{t("policy.carryover.selectMonth")}</option>
                        {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                          <option key={month} value={String(month)}>
                            {monthName(month)}
                          </option>
                        ))}
                      </select>
                      {fieldErrors.carryoverDeadlineMonth && (
                        <span
                          id="policy-carryover-month-error"
                          className="form-error"
                          role="alert"
                        >
                          {fieldErrors.carryoverDeadlineMonth}
                        </span>
                      )}
                    </label>
                    <label className="form-field">
                      <span>{t("policy.carryover.day")}</span>
                      <select
                        id="policy-carryover-day"
                        aria-invalid={Boolean(fieldErrors.carryoverDeadlineDay)}
                        aria-describedby={
                          fieldErrors.carryoverDeadlineDay
                            ? "policy-carryover-day-error"
                            : undefined
                        }
                        value={form.carryoverDeadlineDay}
                        onChange={(e) => {
                          setForm({ ...form, carryoverDeadlineDay: e.target.value });
                          setPreview(null);
                        }}
                      >
                        <option value="">{t("policy.carryover.selectDay")}</option>
                        {Array.from(
                          { length: daysInDeadlineMonth(form.carryoverDeadlineMonth) },
                          (_, index) => index + 1,
                        ).map((day) => (
                          <option key={day} value={String(day)}>
                            {day}
                          </option>
                        ))}
                      </select>
                      {fieldErrors.carryoverDeadlineDay && (
                        <span
                          id="policy-carryover-day-error"
                          className="form-error"
                          role="alert"
                        >
                          {fieldErrors.carryoverDeadlineDay}
                        </span>
                      )}
                    </label>
                  </div>
                  <p id="policy-carryover-deadline-hint" className="policy-carryover-hint">
                    {t("policy.carryover.deadlineHint")}
                  </p>
                  <label className="policy-carryover-check">
                    <input
                      id="policy-carryover-repeat"
                      type="checkbox"
                      checked={form.carryoverRepeat}
                      onChange={(e) => {
                        setForm({ ...form, carryoverRepeat: e.target.checked });
                        setPreview(null);
                      }}
                    />
                    {t("policy.carryover.repeat")}
                  </label>
                </>
              )}
            </fieldset>
          )}
          <label className="form-field">
            <span>{t("policy.fields.scope")}</span>
            <select
              id="policy-scope"
              aria-invalid={Boolean(fieldErrors.scope)}
              aria-describedby={
                fieldErrors.scope ? "policy-scope-error" : undefined
              }
              value={form.scope}
              onChange={(e) => {
                setForm({
                  ...form,
                  scope: e.target.value as FormState["scope"],
                  subjectPublicId: "",
                });
                setPreview(null);
              }}
            >
              <option value="ORGANIZATION">
                {t("policy.scopes.organization")}
              </option>
              {/* A tenant is provisioned with no Workforce Groups -- the Organization Admin creates
                  them -- so offering this scope before then leads only to an empty subject
                  list and a rejected save. */}
              {hasWorkforceGroups && (
                <option value="WORKFORCE_GROUP">
                  {t("policy.scopes.group")}
                </option>
              )}
              <option value="USER">{t("policy.scopes.user")}</option>
            </select>
            {fieldErrors.scope && (
              <span id="policy-scope-error" className="form-error" role="alert">
                {fieldErrors.scope}
              </span>
            )}
          </label>
          {form.scope !== "ORGANIZATION" && (
            <label className="form-field">
              <span>{t("policy.fields.subject")}</span>
              <select
                id="policy-subject"
                aria-invalid={Boolean(fieldErrors.subjectPublicId)}
                aria-describedby={
                  fieldErrors.subjectPublicId
                    ? "policy-subject-error"
                    : undefined
                }
                value={form.subjectPublicId}
                onChange={(e) => {
                  setForm({ ...form, subjectPublicId: e.target.value });
                  setPreview(null);
                }}
              >
                <option value="">{t("policy.fields.selectSubject")}</option>
                {(form.scope === "USER"
                  ? overviewQuery.data?.users
                  : overviewQuery.data?.workforceGroups
                )?.map((target) => (
                  <option key={target.publicId} value={target.publicId}>
                    {target.name}
                  </option>
                ))}
              </select>
              {fieldErrors.subjectPublicId && (
                <span
                  id="policy-subject-error"
                  className="form-error"
                  role="alert"
                >
                  {fieldErrors.subjectPublicId}
                </span>
              )}
            </label>
          )}
          <label className="form-field">
            <span>{t("policy.fields.effectiveFrom")}</span>
            <DateField
              id="policy-effective-from"
              aria-invalid={Boolean(fieldErrors.effectiveFrom)}
              aria-describedby={
                fieldErrors.effectiveFrom
                  ? "policy-effective-from-error"
                  : undefined
              }
              value={form.effectiveFrom}
              onChange={(value) => {
                setForm({ ...form, effectiveFrom: value });
                setPreview(null);
              }}
            />
            {fieldErrors.effectiveFrom && (
              <span
                id="policy-effective-from-error"
                className="form-error"
                role="alert"
              >
                {fieldErrors.effectiveFrom}
              </span>
            )}
          </label>
          <div className="policy-actions">
            <button
              className="btn btn-primary"
              type="button"
              disabled={
                reviewMutation.isPending ||
                !overviewQuery.isSuccess ||
                staleDraft ||
                draftQuery.data.consumed ||
                (form.scope !== "ORGANIZATION" && !form.subjectPublicId)
              }
              onClick={() => reviewMutation.mutate()}
            >
              {t("policy.actions.review")}
            </button>
            <button
              className="btn btn-success"
              type="button"
              disabled={!preview || draftQuery.data.consumed}
              onClick={() => setConfirmOpen(true)}
            >
              {t("policy.actions.publish")}
            </button>
          </div>
        </section>
        <section className="settings-card policy-review" aria-live="polite">
          <h2>{t("policy.review.title")}</h2>
          {!preview ? (
            <p>{t("policy.review.empty")}</p>
          ) : (
            <>
              <dl>
                <div>
                  <dt>{t("policy.fields.scope")}</dt>
                  <dd>{scopeLabel(preview.scope, preview.subjectPublicId)}</dd>
                </div>
                <div>
                  <dt>{t("policy.fields.effectiveFrom")}</dt>
                  <dd>{formatDate(preview.effectiveFrom)}</dd>
                </div>
                <div>
                  <dt>{t("policy.carryover.legend")}</dt>
                  <dd data-testid="policy-review-carryover">{carryoverSummary(preview)}</dd>
                </div>
                <div>
                  <dt>{t("policy.review.affected")}</dt>
                  <dd>
                    {t("policy.review.people", {
                      count: preview.affectedMemberCount,
                    })}
                  </dd>
                </div>
                <div>
                  <dt>{t("policy.review.conflicts")}</dt>
                  <dd>
                    {preview.conflicts.length ? (
                      <ul className="policy-conflict-list">
                        {preview.conflicts.map((conflict) => (
                          <li key={conflict}>{conflictLabel(conflict)}</li>
                        ))}
                      </ul>
                    ) : (
                      t("policy.review.noConflicts")
                    )}
                  </dd>
                </div>
              </dl>
              <div className="policy-impact-list">
                {preview.impacts.length === 0 ? (
                  <p>{t("policy.review.noImpacts")}</p>
                ) : (
                  preview.impacts.map((impact) => (
                    <p key={impact.memberPublicId}>
                      <bdi>
                        {namedTarget(impact.memberPublicId) ??
                          t("policy.review.unknownMember")}
                      </bdi>
                      :{" "}
                      {impact.proposedAllowance == null
                        ? t("policy.review.balanceUnlimited", {
                            used: impact.usedDays,
                          })
                        : t("policy.review.balance", {
                            used: impact.usedDays,
                            allowance: impact.proposedAllowance,
                            remaining: impact.projectedRemaining,
                          })}
                      {impact.projectedCarryoverDays != null
                        ? ` · ${t("policy.review.carryover", {
                            count: impact.projectedCarryoverDays,
                          })}`
                        : null}
                    </p>
                  ))
                )}
              </div>
            </>
          )}
        </section>
      </div>
      <section className="settings-card policy-history">
        <h2>{t("policy.history.title")}</h2>
        {historyQuery.isPending ? (
          <p>{t("policy.history.loading")}</p>
        ) : historyQuery.isError ? (
          <div role="alert">
            <p>{t("policy.history.error")}</p>
            <button
              className="btn btn-outline btn-sm"
              type="button"
              onClick={() => historyQuery.refetch()}
            >
              {t("policy.actions.retry")}
            </button>
          </div>
        ) : historyQuery.data?.length ? (
          <ol>
            {historyQuery.data.map((item) => (
              <li key={item.publicationPublicId}>
                <strong>
                  {t("policy.history.version", { number: item.versionNumber })}
                </strong>{" "}
                — {formatDate(item.effectiveFrom)} —{" "}
                <bdi>
                  {namedTarget(item.publishedByUserPublicId) ??
                    t("policy.history.unknownPublisher")}
                </bdi>{" "}
                — {formatInstant(item.publishedAt)} —{" "}
                {scopeLabel(item.scope, item.subjectPublicId)} —{" "}
                {item.allowanceDays == null
                  ? t("policy.modes.unlimited")
                  : t("policy.history.allowance", {
                      count: item.allowanceDays,
                    })}{" "}
                — {carryoverSummary(item)} —{" "}
                {t("policy.review.people", {
                  count: item.impactSummary.affectedMemberCount,
                })}{" "}
                —{" "}
                {t("policy.history.conflicts", {
                  count: item.impactSummary.conflictCount,
                })}
              </li>
            ))}
          </ol>
        ) : (
          <p>{t("policy.history.empty")}</p>
        )}
      </section>
      {confirmOpen && preview && (
        <Modal
          labelledBy="policy-confirm-title"
          onClose={() => setConfirmOpen(false)}
          closeOnBackdrop={false}
        >
          <div className="modal-header">
            <h2 className="modal-title" id="policy-confirm-title">
              {t("policy.confirm.title")}
            </h2>
            <button
              type="button"
              className="modal-close"
              aria-label={t("policy.actions.close")}
              onClick={() => setConfirmOpen(false)}
            >
              <CloseIcon size={18} />
            </button>
          </div>
          <div className="modal-body">
            <p>
              {t("policy.confirm.summary", {
                scope: scopeLabel(preview.scope, preview.subjectPublicId),
                date: preview.effectiveFrom,
                count: preview.affectedMemberCount,
              })}
            </p>
            <label className="policy-confirm-check">
              <input
                type="checkbox"
                checked={historyConfirmed}
                onChange={(e) => setHistoryConfirmed(e.target.checked)}
              />
              {t("policy.confirm.history")}
            </label>
          </div>
          <div className="modal-actions">
            <button
              className="btn btn-outline"
              type="button"
              onClick={() => setConfirmOpen(false)}
            >
              {t("policy.actions.cancel")}
            </button>
            <button
              className="btn btn-success"
              type="button"
              disabled={!historyConfirmed || publishMutation.isPending}
              onClick={() => publishMutation.mutate()}
            >
              {t("policy.actions.confirm")}
            </button>
          </div>
        </Modal>
      )}
      {dataRouterContext && <PolicyRouteBlocker dirty={dirty} />}
    </div>
  );
}
