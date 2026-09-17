import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ApiError,
  createLeaveType,
  createPolicyDraft,
  deactivateLeaveType,
  getManagedLeaveTypes,
  getPolicySettingsOverview,
  reactivateLeaveType,
  reorderLeaveTypes,
  updateLeaveType,
} from "../../api/client";
import { fieldErrorsFromApiError } from "../../api/fieldViolations";
import { isolate } from "../../i18n/bidi";
import {
  LEAVE_TYPE_DEFAULT_PRESENTATION,
  nextEffectiveDate,
} from "./leaveTypeDefaults";
import type { LeaveTypeResponse } from "../../api/generated/types";
import { useAuth } from "../../auth/useAuth";
import { Modal } from "../../components/ui/Modal";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  PlusIcon,
} from "../../components/ui/icons";
import { RowActionsMenu } from "../../components/ui/RowActionsMenu";
import "./team-members.css";

/** WCAG 2.1 AA minimum contrast for normal-size text, per the project's UI standards. */
const WCAG_AA_CONTRAST = 4.5;

/** Relative luminance of a `#rrggbb` colour, per WCAG 2.1 (returns 0 for anything unparsable). */
function relativeLuminance(hex: string): number {
  const match = /^#?([\da-f]{6})$/i.exec(hex.trim());
  if (!match) {
    return 0;
  }
  const value = Number.parseInt(match[1], 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(
    (channel) => {
      const ratio = channel / 255;
      return ratio <= 0.03928
        ? ratio / 12.92
        : Math.pow((ratio + 0.055) / 1.055, 2.4);
    },
  );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Contrast ratio between two `#rrggbb` colours, 1 (identical) to 21 (black on white). */
function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

type Props = {
  onWarning?: (message: string) => void;
  onSuccess?: (message: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
};
export function LeaveTypesCard({
  onWarning,
  onSuccess,
  onDirtyChange,
}: Props) {
  const { t } = useTranslation("settings");
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [statusTarget, setStatusTarget] = useState<{
    publicId: string;
    name: string;
    active: boolean;
  } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [color, setColor] = useState(LEAVE_TYPE_DEFAULT_PRESENTATION.color);
  const [backgroundColor, setBackgroundColor] = useState(
    LEAVE_TYPE_DEFAULT_PRESENTATION.backgroundColor,
  );
  const [borderColor, setBorderColor] = useState(
    LEAVE_TYPE_DEFAULT_PRESENTATION.borderColor,
  );
  const [presenceType, setPresenceType] = useState<"WFH" | "OFF">(
    LEAVE_TYPE_DEFAULT_PRESENTATION.presenceType,
  );
  // Plan MEDIA. On by default, for new types and for every type that existed before half days did:
  // an organization that wants whole-day-only Bereavement turns it off there, and nothing that used
  // to be requestable stops being requestable on its own.
  const [halfDayAllowed, setHalfDayAllowed] = useState(true);
  // Surfaced live in the create dialog so an unreadable colour pair is caught
  // while it is being picked, rather than once it is on everyone's calendar.
  const previewContrast = useMemo(
    () => contrastRatio(color, backgroundColor),
    [color, backgroundColor],
  );
  const [editTarget, setEditTarget] = useState<LeaveTypeResponse | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const orgId = user?.organizationId;
  // The create and edit modals share these fields, so opening either one must start from a known
  // state — otherwise "Add Leave Type" after an edit opens pre-filled with the edited type.
  const resetForm = () => {
    setName("");
    setIcon("");
    setColor(LEAVE_TYPE_DEFAULT_PRESENTATION.color);
    setBackgroundColor(LEAVE_TYPE_DEFAULT_PRESENTATION.backgroundColor);
    setBorderColor(LEAVE_TYPE_DEFAULT_PRESENTATION.borderColor);
    setPresenceType(LEAVE_TYPE_DEFAULT_PRESENTATION.presenceType);
    setHalfDayAllowed(true);
    setFieldErrors({});
  };
  const typesQuery = useQuery({
    queryKey: ["managed-leave-types", orgId],
    queryFn: getManagedLeaveTypes,
    enabled: orgId != null,
  });
  const overviewQuery = useQuery({
    queryKey: ["policy-settings-overview", orgId],
    queryFn: getPolicySettingsOverview,
    enabled: orgId != null,
  });
  useEffect(() => {
    if (typesQuery.isError) onWarning?.(t("leaveTypes.errors.loadToast"));
  }, [typesQuery.isError, onWarning, t]);
  // An open create/edit modal holds unsaved input, so the Settings exit guard has to know about it
  // — the same contract TeamMembersCard honours for its own modal.
  const formOpen = createOpen || editTarget != null;
  const formDirty =
    formOpen &&
    (name.trim().length > 0 ||
      icon.trim().length > 0 ||
      (editTarget != null &&
        (name !== (editTarget.name ?? "") ||
          icon !== (editTarget.icon ?? "") ||
          color !== (editTarget.color ?? LEAVE_TYPE_DEFAULT_PRESENTATION.color) ||
          backgroundColor !==
            (editTarget.backgroundColor ??
              LEAVE_TYPE_DEFAULT_PRESENTATION.backgroundColor) ||
          borderColor !==
            (editTarget.borderColor ??
              LEAVE_TYPE_DEFAULT_PRESENTATION.borderColor) ||
          presenceType !==
            (editTarget.presenceType ??
              LEAVE_TYPE_DEFAULT_PRESENTATION.presenceType) ||
          halfDayAllowed !== (editTarget.halfDayAllowed !== false))));
  useEffect(() => {
    onDirtyChange?.(formDirty);
  }, [formDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const handleFormError = (cause: unknown, message: string) => {
    const violations =
      cause instanceof ApiError
        ? fieldErrorsFromApiError(cause.fieldViolations)
        : null;
    setFieldErrors(violations ?? {});
    if (violations) {
      const ids: Record<string, string> = {
        name: "leave-type-name",
        icon: "leave-type-icon",
        presenceType: "leave-type-presence",
        color: "leave-type-color",
        backgroundColor: "leave-type-background-color",
        borderColor: "leave-type-border-color",
      };
      const target = Object.keys(violations)
        .map((field) => ids[field])
        .find(Boolean);
      const focusTarget = target ? document.getElementById(target) : null;
      // Every id in `ids` is rendered by both modals, so a violation on any validated field lands
      // on its own control; the name input is the fallback for a field the form does not expose.
      (focusTarget ?? document.getElementById("leave-type-name"))?.focus();
    }
    onWarning?.(message);
  };
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["managed-leave-types", orgId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["policy-settings-overview", orgId],
      }),
      queryClient.invalidateQueries({ queryKey: ["leave-types", orgId] }),
    ]);
  };
  const statusMutation = useMutation({
    mutationFn: (target: NonNullable<typeof statusTarget>) =>
      target.active
        ? deactivateLeaveType(target.publicId)
        : reactivateLeaveType(target.publicId),
    onSuccess: async (_, target) => {
      await refresh();
      setStatusTarget(null);
      onSuccess?.(
        t(
          target.active
            ? "leaveTypes.success.deactivated"
            : "leaveTypes.success.reactivated",
          { name: target.name },
        ),
      );
    },
    onError: () => onWarning?.(t("leaveTypes.errors.status")),
  });
  const createMutation = useMutation({
    mutationFn: () =>
      createLeaveType({
        name,
        icon,
        color,
        backgroundColor,
        borderColor,
        presenceType,
        halfDayAllowed,
      }),
    onSuccess: async () => {
      await refresh();
      setCreateOpen(false);
      resetForm();
      onSuccess?.(t("leaveTypes.success.created"));
    },
    onError: (cause) => handleFormError(cause, t("leaveTypes.errors.create")),
  });
  const editMutation = useMutation({
    mutationFn: () =>
      updateLeaveType(editTarget!.publicId!, {
        name,
        icon,
        color,
        backgroundColor,
        borderColor,
        presenceType,
        halfDayAllowed,
      }),
    onSuccess: async () => {
      await refresh();
      setEditTarget(null);
      resetForm();
      onSuccess?.(t("leaveTypes.success.updated"));
    },
    onError: (cause) => handleFormError(cause, t("leaveTypes.errors.update")),
  });
  const reorderMutation = useMutation({
    mutationFn: reorderLeaveTypes,
    onSuccess: refresh,
    onError: () => onWarning?.(t("leaveTypes.errors.reorder")),
  });
  const draftMutation = useMutation({
    mutationFn: (type: NonNullable<typeof typesQuery.data>[number]) =>
      createPolicyDraft({
        leaveTypePublicId: type.publicId!,
        mode:
          type.defaultBalanceDays == null ? "UNLIMITED" : "ANNUAL_ALLOWANCE",
        allowanceDays: type.defaultBalanceDays ?? undefined,
        balancePeriod: "CALENDAR_YEAR",
        scope: "ORGANIZATION",
        effectiveFrom: nextEffectiveDate(user?.organizationTimezone),
      }),
    onSuccess: (draft) =>
      navigate(`/settings/leave-policies/${draft.draftPublicId}`),
    onError: (cause) =>
      onWarning?.(
        cause instanceof ApiError && cause.problem.code === "capability-unavailable"
          ? t("policy.errors.capabilityUnavailable")
          : t("leaveTypes.errors.draft"),
      ),
  });
  const move = (index: number, offset: number) => {
    // Filter before mapping: dropping an id after the map would shorten the array and desynchronise
    // it from `index`, which comes from the unfiltered render list, and swap unrelated rows.
    const rows = (typesQuery.data ?? []).filter((type) => Boolean(type.publicId));
    const target = index + offset;
    if (
      rows.length !== (typesQuery.data ?? []).length ||
      index < 0 ||
      target < 0 ||
      index >= rows.length ||
      target >= rows.length
    ) {
      onWarning?.(t("leaveTypes.errors.reorder"));
      return;
    }
    const ids = rows.map((type) => type.publicId!);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorderMutation.mutate(ids);
  };

  const startEdit = (type: LeaveTypeResponse) => {
    setFieldErrors({});
    setEditTarget(type);
    setName(type.name ?? "");
    setIcon(type.icon ?? "");
    setColor(type.color ?? "#093C5D");
    setBackgroundColor(type.backgroundColor ?? "#D6E8ED");
    setBorderColor(type.borderColor ?? "#0E4F75");
    setPresenceType(type.presenceType ?? "OFF");
    // Absent means allowed: the column defaults to true, so an older response must not read as a
    // type that has half days switched off.
    setHalfDayAllowed(type.halfDayAllowed !== false);
  };
  if (typesQuery.isPending)
    return (
      <section
        className="settings-card settings-card-spaced"
        data-testid="leave-types-card"
      >
        <div className="card-section-header">
          <span className="card-section-title">{t("leaveTypes.title")}</span>
        </div>
        <p className="settings-card-loading-inline">{t("leaveTypes.loading")}</p>
      </section>
    );
  if (typesQuery.isError)
    return (
      <section
        className="settings-card settings-card-spaced"
        data-testid="leave-types-card"
      >
        <div className="card-section-header">
          <span className="card-section-title">{t("leaveTypes.title")}</span>
        </div>
        <p className="settings-card-error-inline">
          {t("leaveTypes.errors.load")}
        </p>
      </section>
    );
  const types = typesQuery.data ?? [];
  const balanceCopy = (type: NonNullable<typeof typesQuery.data>[number]) =>
    type.defaultBalanceDays == null
      ? t("leaveTypes.unlimited")
      : t("leaveTypes.defaultDays", { count: type.defaultBalanceDays });
  // The rail answers what the list makes you count: the rows carry status and entitlement each,
  // and whether a type still has an unfinished policy draft is only visible as Configure vs
  // Resume on its own button. Active is `!== false` rather than `=== true` because the field is
  // optional in the schema and an absent flag has always meant active here.
  const activeTypes = types.filter((type) => type.active !== false);
  const draftCount = overviewQuery.data?.leaveTypes.filter(
    (item) => item.latestDraft,
  ).length;
  const wfhCount = activeTypes.filter(
    (type) => type.presenceType === "WFH",
  ).length;
  // One form for both dialogs. Create and Edit drive the same six pieces of state
  // through the same validation, but Edit had been written as a flat stack: no
  // two-column row, no Appearance grouping, and no live badge or contrast readout —
  // so the colours could only be checked against WCAG while creating a type, never
  // while changing one. Rendered into whichever dialog is open; they are never open
  // at once.
  const leaveTypeFormBody = (
      <div className="modal-body">
        <div className="modal-form-grid">
          <div className="form-cell form-field-full">
            <label className="form-field">
              <span>{t("leaveTypes.fields.name")}</span>
              <input
                id="leave-type-name"
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={
                  fieldErrors.name ? "leave-type-name-error" : undefined
                }
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {fieldErrors.name && (
              <span
                id="leave-type-name-error"
                className="form-error"
                role="alert"
              >
                {fieldErrors.name}
              </span>
            )}
          </div>
          <div className="form-cell">
            <label className="form-field">
              <span>{t("leaveTypes.fields.icon")}</span>
              <input
                id="leave-type-icon"
                aria-invalid={Boolean(fieldErrors.icon)}
                aria-describedby={
                  fieldErrors.icon ? "leave-type-icon-error" : undefined
                }
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
              />
            </label>
            {fieldErrors.icon && (
              <span
                id="leave-type-icon-error"
                className="form-error"
                role="alert"
              >
                {fieldErrors.icon}
              </span>
            )}
          </div>
          <div className="form-cell">
            <label className="form-field">
              <span>{t("leaveTypes.fields.presence")}</span>
              <select
                id="leave-type-presence"
                aria-invalid={Boolean(fieldErrors.presenceType)}
                aria-describedby={
                  fieldErrors.presenceType
                    ? "leave-type-presence-error"
                    : undefined
                }
                value={presenceType}
                onChange={(e) =>
                  setPresenceType(e.target.value as "WFH" | "OFF")
                }
              >
                <option value="OFF">{t("leaveTypes.presence.off")}</option>
                <option value="WFH">{t("leaveTypes.presence.wfh")}</option>
              </select>
            </label>
            {fieldErrors.presenceType && (
              <span
                id="leave-type-presence-error"
                className="form-error"
                role="alert"
              >
                {fieldErrors.presenceType}
              </span>
            )}
          </div>

          <div className="form-cell form-field-full">
            <label className="form-field form-field-check">
              <input
                id="leave-type-half-day"
                type="checkbox"
                checked={halfDayAllowed}
                onChange={(e) => setHalfDayAllowed(e.target.checked)}
              />
              <span>{t("leaveTypes.fields.halfDayAllowed")}</span>
            </label>
            <p className="form-hint">{t("leaveTypes.halfDayHint")}</p>
          </div>
        </div>

        <fieldset className="leave-type-appearance">
          <legend>{t("leaveTypes.groups.appearance")}</legend>
          <div className="leave-type-swatches">
            <div className="form-cell">
              <label className="form-field">
                <span>{t("leaveTypes.fields.color")}</span>
                <input
                  id="leave-type-color"
                  type="color"
                  aria-invalid={Boolean(fieldErrors.color)}
                  aria-describedby={
                    fieldErrors.color ? "leave-type-color-error" : undefined
                  }
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
              </label>
              {fieldErrors.color && (
                <span id="leave-type-color-error" className="form-error" role="alert">
                  {fieldErrors.color}
                </span>
              )}
            </div>
            <div className="form-cell">
              <label className="form-field">
                <span>{t("leaveTypes.fields.backgroundColor")}</span>
                <input
                  id="leave-type-background-color"
                  type="color"
                  aria-invalid={Boolean(fieldErrors.backgroundColor)}
                  aria-describedby={
                    fieldErrors.backgroundColor ? "leave-type-background-color-error" : undefined
                  }
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                />
              </label>
              {fieldErrors.backgroundColor && (
                <span id="leave-type-background-color-error" className="form-error" role="alert">
                  {fieldErrors.backgroundColor}
                </span>
              )}
            </div>
            <div className="form-cell">
              <label className="form-field">
                <span>{t("leaveTypes.fields.borderColor")}</span>
                <input
                  id="leave-type-border-color"
                  type="color"
                  aria-invalid={Boolean(fieldErrors.borderColor)}
                  aria-describedby={
                    fieldErrors.borderColor ? "leave-type-border-color-error" : undefined
                  }
                  value={borderColor}
                  onChange={(e) => setBorderColor(e.target.value)}
                />
              </label>
              {fieldErrors.borderColor && (
                <span id="leave-type-border-color-error" className="form-error" role="alert">
                  {fieldErrors.borderColor}
                </span>
              )}
            </div>
          </div>

          <div className="leave-type-preview">
            <span
              className="leave-type-preview-badge"
              data-testid="leave-type-preview"
              style={{
                color,
                backgroundColor,
                borderColor,
              }}
            >
              <span aria-hidden="true">{icon.trim() || "\u00b7"}</span>
              <bdi>{name.trim() || t("leaveTypes.groups.previewPlaceholder")}</bdi>
            </span>
            <span
              className={
                previewContrast >= WCAG_AA_CONTRAST
                  ? "leave-type-contrast is-pass"
                  : "leave-type-contrast is-fail"
              }
              data-testid="leave-type-contrast"
            >
              {t(
                previewContrast >= WCAG_AA_CONTRAST
                  ? "leaveTypes.groups.contrastPass"
                  : "leaveTypes.groups.contrastFail",
                { ratio: previewContrast.toFixed(1) },
              )}
            </span>
          </div>
        </fieldset>
      </div>
  );

  return (
    <div className="panel-with-aside">
      <section
        className="settings-card settings-card-spaced"
        data-testid="leave-types-card"
      >
        <div className="card-section-header">
          <div>
            <span className="card-section-title">{t("leaveTypes.title")}</span>
            <p className="settings-card-helper settings-card-helper-inline">
              {t("leaveTypes.summary", { count: types.length })}
            </p>
          </div>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={() => {
              resetForm();
              setCreateOpen(true);
            }}
          >
            <PlusIcon size={16} />
            {t("leaveTypes.actions.add")}
          </button>
        </div>
        {overviewQuery.isError && (
          <div role="alert" className="settings-card-error-inline">
            <p>{t("leaveTypes.errors.overview")}</p>
            <button
              className="btn btn-outline btn-sm"
              type="button"
              onClick={() => overviewQuery.refetch()}
            >
              {t("leaveTypes.actions.retry")}
            </button>
          </div>
        )}
        {types.length === 0 ? (
          <p className="settings-card-loading-inline">{t("leaveTypes.none")}</p>
        ) : (
          <div className="settings-list-body" data-testid="leave-types-list">
            {types.map((type, index) => {
              const policy = overviewQuery.data?.leaveTypes.find(
                (item) => item.leaveTypePublicId === type.publicId,
              );
              return (
                <div
                  key={type.publicId ?? type.id}
                  className="settings-list-item leave-type-row"
                  data-testid={`leave-type-row-${type.id}`}
                >
                  <span className="leave-type-icon" aria-hidden="true">
                    {type.icon}
                  </span>
                  <div className="leave-type-details">
                    <div className="leave-type-name">
                    <bdi>{type.name}</bdi>
                  </div>
                    <div className="leave-type-subtitle">
                      <span>{balanceCopy(type)}</span> ·{" "}
                      <span>
                        {t(
                          type.active === false
                            ? "leaveTypes.inactive"
                            : "leaveTypes.active",
                        )}
                      </span>
                      {/* Only the restriction is worth a word here. Half days are the default, so
                          saying so on every other row would be noise on a list read at a glance. */}
                      {type.halfDayAllowed === false ? (
                        <>
                          {" "}
                          · <span>{t("leaveTypes.wholeDaysOnly")}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="leave-type-actions">
                    {/* Reordering is a two-button affordance on a five-action row, so
                        it reads as icons and leaves the words to the real actions. */}
                    <div className="leave-type-reorder">
                      <button
                        type="button"
                        className="leave-type-reorder-btn"
                        disabled={index === 0 || reorderMutation.isPending}
                        onClick={() => move(index, -1)}
                        aria-label={t("leaveTypes.aria.moveUp", {
                          name: isolate(type.name),
                        })}
                      >
                        <ChevronUpIcon size={16} />
                      </button>
                      <button
                        type="button"
                        className="leave-type-reorder-btn"
                        disabled={
                          index === types.length - 1 || reorderMutation.isPending
                        }
                        onClick={() => move(index, 1)}
                        aria-label={t("leaveTypes.aria.moveDown", {
                          name: isolate(type.name),
                        })}
                      >
                        <ChevronDownIcon size={16} />
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      aria-label={t(
                        policy?.latestDraft
                          ? "leaveTypes.aria.resume"
                          : "leaveTypes.aria.configure",
                        { name: isolate(type.name) },
                      )}
                      disabled={
                        !overviewQuery.isSuccess || draftMutation.isPending
                      }
                      onClick={() =>
                        !overviewQuery.isSuccess
                          ? undefined
                          : policy?.latestDraft?.draftPublicId
                            ? navigate(
                                `/settings/leave-policies/${policy.latestDraft.draftPublicId}`,
                              )
                            : draftMutation.mutate(type)
                      }
                    >
                      {t(
                        policy?.latestDraft
                          ? "leaveTypes.actions.resume"
                          : "leaveTypes.actions.configure",
                      )}
                    </button>
                    <RowActionsMenu
                      testId={`leave-type-menu-${type.id}`}
                      label={t("leaveTypes.aria.moreActions", {
                        name: isolate(type.name),
                      })}
                      actions={[
                        {
                          id: "edit",
                          label: t("leaveTypes.actions.edit"),
                          ariaLabel: t("leaveTypes.aria.edit", {
                            name: isolate(type.name),
                          }),
                          testId: `leave-type-edit-${type.id}`,
                          onSelect: () => startEdit(type),
                        },
                        {
                          id: "status",
                          label: t(
                            type.active === false
                              ? "leaveTypes.actions.reactivate"
                              : "leaveTypes.actions.deactivate",
                          ),
                          ariaLabel: t(
                            type.active === false
                              ? "leaveTypes.aria.reactivate"
                              : "leaveTypes.aria.deactivate",
                            { name: isolate(type.name) },
                          ),
                          testId: `leave-type-status-${type.id}`,
                          destructive: type.active !== false,
                          onSelect: () =>
                            setStatusTarget({
                              publicId: type.publicId!,
                              name: type.name!,
                              active: type.active !== false,
                            }),
                        },
                      ]}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {statusTarget && (
          <Modal
            labelledBy="leave-type-status-title"
            onClose={() => setStatusTarget(null)}
          >
            <div className="modal-header">
              <h2 id="leave-type-status-title" className="modal-title">
                {t(
                  statusTarget.active
                    ? "leaveTypes.deactivateTitle"
                    : "leaveTypes.reactivateTitle",
                  { name: statusTarget.name },
                )}
              </h2>
              <button
                type="button"
                className="modal-close"
                aria-label={t("leaveTypes.actions.close")}
                onClick={() => setStatusTarget(null)}
              >
                <CloseIcon size={18} />
              </button>
            </div>
            <div className="modal-body">
              <p>
                {t("leaveTypes.statusCopy", {
                  name: isolate(statusTarget.name),
                })}
              </p>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-outline"
                type="button"
                onClick={() => setStatusTarget(null)}
              >
                {t("leaveTypes.actions.cancel")}
              </button>
              <button
                className={
                  statusTarget.active ? "btn btn-danger" : "btn btn-primary"
                }
                type="button"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate(statusTarget)}
              >
                {t(
                  statusTarget.active
                    ? "leaveTypes.actions.confirmDeactivate"
                    : "leaveTypes.actions.confirmReactivate",
                )}
              </button>
            </div>
          </Modal>
        )}
        {createOpen && (
          <Modal
            labelledBy="leave-type-create-title"
            onClose={() => setCreateOpen(false)}
          >
            <div className="modal-header">
              <h2 id="leave-type-create-title" className="modal-title">
                {t("leaveTypes.createTitle")}
              </h2>
              <button
                type="button"
                className="modal-close"
                aria-label={t("leaveTypes.actions.close")}
                onClick={() => setCreateOpen(false)}
              >
                <CloseIcon size={18} />
              </button>
            </div>
            {leaveTypeFormBody}
            <div className="modal-actions">
              <button
                className="btn btn-outline"
                type="button"
                onClick={() => setCreateOpen(false)}
              >
                {t("leaveTypes.actions.cancel")}
              </button>
              <button
                className="btn btn-primary"
                type="button"
                disabled={
                  !name.trim() || !icon.trim() || createMutation.isPending
                }
                onClick={() => createMutation.mutate()}
              >
                {t("leaveTypes.actions.create")}
              </button>
            </div>
          </Modal>
        )}
        {editTarget && (
          <Modal
            labelledBy="leave-type-edit-title"
            onClose={() => setEditTarget(null)}
          >
            <div className="modal-header">
              <h2 id="leave-type-edit-title" className="modal-title">
                {t("leaveTypes.editTitle", { name: isolate(editTarget.name) })}
              </h2>
              <button
                type="button"
                className="modal-close"
                aria-label={t("leaveTypes.actions.close")}
                onClick={() => setEditTarget(null)}
              >
                <CloseIcon size={18} />
              </button>
            </div>
            {leaveTypeFormBody}
            <div className="modal-actions">
              <button
                className="btn btn-outline"
                type="button"
                onClick={() => setEditTarget(null)}
              >
                {t("leaveTypes.actions.cancel")}
              </button>
              <button
                className="btn btn-primary"
                type="button"
                disabled={!name.trim() || !icon.trim() || editMutation.isPending}
                onClick={() => editMutation.mutate()}
              >
                {t("leaveTypes.actions.save")}
              </button>
            </div>
          </Modal>
        )}
      </section>

      <aside className="support-rail">
        <section className="support-note" aria-labelledby="leave-types-glance-title">
          <h3 className="support-note-title" id="leave-types-glance-title">
            {t("leaveTypes.rail.glanceTitle")}
          </h3>
          <dl className="support-note-list">
            <div className="support-note-kv">
              <dt>{t("leaveTypes.rail.active")}</dt>
              <dd data-testid="leave-types-glance-active">{activeTypes.length}</dd>
            </div>
            <div className="support-note-kv">
              <dt>{t("leaveTypes.rail.inactive")}</dt>
              <dd data-testid="leave-types-glance-inactive">
                {types.length - activeTypes.length}
              </dd>
            </div>
            <div className="support-note-kv">
              <dt>{t("leaveTypes.rail.drafts")}</dt>
              {/* An em dash, not 0: the overview call can fail on its own (the card already
                  renders a retry for it), and "no drafts" is a different claim from "unknown". */}
              <dd data-testid="leave-types-glance-drafts">
                {draftCount == null ? "—" : draftCount}
              </dd>
            </div>
          </dl>
        </section>

        {activeTypes.length > 0 && (
          <section
            className="support-note"
            aria-labelledby="leave-types-entitlements-title"
          >
            <h3 className="support-note-title" id="leave-types-entitlements-title">
              {t("leaveTypes.rail.entitlementsTitle")}
            </h3>
            <dl className="support-note-list">
              {activeTypes.map((type) => (
                <div className="support-note-kv" key={type.publicId ?? type.id}>
                  <dt dir="auto">
                    <bdi>{type.name}</bdi>
                  </dt>
                  <dd className="support-note-kv-quiet">{balanceCopy(type)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {activeTypes.length > 0 && (
          <section className="support-note" aria-labelledby="leave-types-presence-title">
            <h3 className="support-note-title" id="leave-types-presence-title">
              {t("leaveTypes.rail.presenceTitle")}
            </h3>
            <dl className="support-note-list">
              <div className="support-note-kv">
                <dt>{t("leaveTypes.rail.presenceOff")}</dt>
                <dd data-testid="leave-types-presence-off">
                  {activeTypes.length - wfhCount}
                </dd>
              </div>
              <div className="support-note-kv">
                <dt>{t("leaveTypes.rail.presenceWfh")}</dt>
                <dd data-testid="leave-types-presence-wfh">{wfhCount}</dd>
              </div>
            </dl>
            <p className="support-note-body support-note-footnote">
              {t("leaveTypes.rail.presenceBody")}
            </p>
          </section>
        )}
      </aside>
    </div>
  );
}
