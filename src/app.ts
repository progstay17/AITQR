import { ConfigUnavailableError, bundleAgeDays, loadConfig } from "./config/load.js";
import { TRUSTED_ADMIN_KEYS } from "./config/trustedAdminKeys.js";
import { el, fieldId, replace } from "./dom.js";
import { addRecord, clearRecords, listRecords, readLocale, rememberLocale } from "./db.js";
import { t } from "./i18n.js";
import { TokenTooLargeError, issueEncryptedToken } from "./mq1.js";
import {
  buildPayload,
  derivedValues,
  estimateTokenChars,
  payloadKeyLabels,
  validateValues,
  type ValidationIssue,
} from "./payload.js";
import { fieldsOf, findProfile, groupsOf, localize, optionsFor, profilesForBundle } from "./profile.js";
import { renderQr as renderQrSvg } from "./qr.js";
import { newSessionId } from "./session.js";
import type { ConfigState, FieldDef, FormValues, IssueRecord, Locale, Profile } from "./types.js";

interface SessionUser {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
}

interface Session {
  signedIn: boolean;
  user: SessionUser | null;
}

type View =
  | { name: "boot" }
  | { name: "login" }
  | { name: "session-unavailable" }
  | { name: "config-error" }
  | { name: "home" }
  | { name: "form" }
  | { name: "review" }
  | { name: "qr"; record: IssueRecord; redisplay: boolean }
  | { name: "history" };

interface Draft {
  profileId: string;
  values: FormValues;
}

interface State {
  locale: Locale;
  session: Session | null;
  config: ConfigState | null;
  configError: string | null;
  sessionError: string | null;
  view: View;
  draft: Draft | null;
  issues: ValidationIssue[];
  notice: string | null;
  loginError: string | null;
  busy: string;
  updateReady: boolean;
  wakeLockStatus: "idle" | "pending" | "active" | "unsupported" | "failed";
}

const state: State = {
  locale: readLocale() ?? "id",
  session: null,
  config: null,
  configError: null,
  sessionError: null,
  view: { name: "boot" },
  draft: null,
  issues: [],
  notice: null,
  loginError: null,
  busy: "",
  updateReady: false,
  wakeLockStatus: "idle",
};

const root = (): HTMLElement => document.getElementById("main") as HTMLElement;
const header = (): HTMLElement => document.getElementById("app-header") as HTMLElement;
const tr = (key: string, vars?: Record<string, string | number>): string => t(key, state.locale, vars);

function profileOf(id: string): Profile | undefined {
  return state.config ? findProfile(state.config.bundle, id) : undefined;
}

function go(view: View): void {
  const leavingQr = state.view.name === "qr" && view.name !== "qr";
  state.view = view;
  if (leavingQr) void releaseQrWakeLock();
  render();
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      headers: init.body ? { "Content-Type": "application/json" } : undefined,
      ...init,
    });
  } catch {
    throw new Error("Server tidak dapat dihubungi. Periksa koneksi lalu coba lagi.");
  }
  const text = await response.text();
  // A hosting or proxy error page is plain text, not JSON; keep it for the message.
  let payload: unknown = null;
  let parsed = false;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
      parsed = true;
    } catch {
      parsed = false;
    }
  }
  if (!response.ok) {
    if (!parsed) throw new Error(plainTextError(response, text));
    const record = payload as { error?: string; problems?: ValidationIssue[] } | null;
    if (record?.problems) state.issues = record.problems;
    throw new Error(record?.error ?? `HTTP ${response.status}`);
  }
  if (!parsed) throw new Error("Balasan server tidak dikenali. Muat ulang halaman lalu coba lagi.");
  return payload as T;
}

/** Turns a non-JSON hosting response (e.g. "Site unavailable") into a readable message. */
function plainTextError(response: Response, text: string): string {
  const detail = text.trim().replace(/\s+/g, " ").slice(0, 120);
  const status = response.statusText ? `${response.status} ${response.statusText}` : String(response.status);
  return `Server membalas HTTP ${status}${detail ? `: ${detail}` : ""}. Coba lagi beberapa saat lagi.`;
}

// ---------------------------------------------------------------- boot

async function boot(): Promise<void> {
  state.view = { name: "boot" };
  state.notice = null;
  state.configError = null;
  render();

  const session = await api<Session>("/api/session").catch((error: unknown) => {
    state.sessionError = error instanceof Error ? error.message : String(error);
    return null;
  });
  if (!session) {
    state.session = null;
    state.view = { name: "session-unavailable" };
    render();
    return;
  }
  state.sessionError = null;
  state.session = session;

  if (!session.signedIn || !session.user) {
    state.config = null;
    state.view = { name: "login" };
    render();
    return;
  }

  const config = await loadConfig({ trusted: TRUSTED_ADMIN_KEYS, account: session.user.id }).catch((error: unknown) => {
    state.configError =
      error instanceof ConfigUnavailableError ? error.message : error instanceof Error ? error.message : String(error);
    return null;
  });
  state.config = config;
  state.locale = readLocale() ?? config?.bundle.global.default_locale ?? "id";
  document.documentElement.lang = state.locale;

  if (!config) {
    state.view = { name: "config-error" };
    render();
    return;
  }
  state.view = { name: "home" };
  render();
}

// ---------------------------------------------------------------- chrome

function renderHeader(): void {
  const online = state.config ? !state.config.offline : true;
  const user = state.session?.user ?? null;
  replace(
    header(),
    el("div", { class: "topbar-inner" }, [
      el("a", {
        class: "brand",
        attrs: { href: "#home" },
        on: {
          click: (event) => {
            event.preventDefault();
            go({ name: state.session?.signedIn ? "home" : "login" });
          },
        },
      }, [
        el("span", { class: "brand-mark", attrs: { "aria-hidden": "true" } }),
        el("span", { class: "brand-text" }, [
          el("strong", { text: tr("app.name") }),
          el("span", { class: "brand-sub", text: tr("app.tagline") }),
        ]),
      ]),
      el("div", { class: "topbar-actions" }, [
        el("span", { class: online ? "pill pill-ok" : "pill pill-warn" }, [online ? tr("status.ready") : tr("status.offline")]),
        user ? el("span", { class: "pill", text: user.displayName ?? user.username }) : null,
        el("button", {
          class: "icon-button",
          attrs: { type: "button", "aria-label": tr("common.language"), title: tr("common.language") },
          text: state.locale === "id" ? "ID" : "EN",
          on: {
            click: () => {
              state.locale = state.locale === "id" ? "en" : "id";
              rememberLocale(state.locale);
              document.documentElement.lang = state.locale;
              render();
            },
          },
        }),
      ]),
    ]),
  );
}

function card(title: string, children: (Node | string | null | undefined)[], extraClass = ""): HTMLElement {
  return el("section", { class: `card ${extraClass}`.trim() }, [
    el("h2", { class: "card-title", text: title }),
    ...children,
  ]);
}

function actionButton(
  label: string,
  onClick: () => void,
  variant: "primary" | "secondary" | "danger" = "primary",
  disabled = false,
): HTMLElement {
  return el("button", {
    class: `button button-${variant}`,
    attrs: { type: "button", disabled: disabled || state.busy !== "" },
    text: label,
    on: { click: onClick },
  });
}

function noticeBar(): HTMLElement | null {
  if (!state.notice) return null;
  return el("div", { class: "notice", attrs: { role: "status" } }, [
    el("span", { text: state.notice }),
    el("button", {
      class: "link-button",
      attrs: { type: "button" },
      text: "×",
      on: {
        click: () => {
          state.notice = null;
          render();
        },
      },
    }),
  ]);
}

async function logout(): Promise<void> {
  try {
    await api("/api/logout", { method: "POST", body: "{}" });
  } finally {
    await boot();
  }
}

// ---------------------------------------------------------------- views

function renderLogin(): HTMLElement {
  const username = el("input", {
    class: "input",
    attrs: { type: "text", name: "username", autocomplete: "username", required: true, autocapitalize: "none" },
    props: { value: "" },
  }) as HTMLInputElement;
  const password = el("input", {
    class: "input",
    attrs: { type: "password", name: "password", autocomplete: "current-password", required: true },
  }) as HTMLInputElement;

  const form = el("form", {
    class: "stack",
    attrs: { method: "post", id: "login-form" },
    on: {
      submit: (event) => {
        event.preventDefault();
        if (state.busy) return;
        state.busy = "login";
        state.loginError = null;
        render();
        void api("/api/login", {
          method: "POST",
          body: JSON.stringify({ username: username.value, password: password.value }),
        })
          .then(() => {
            state.busy = "";
            return boot();
          })
          .catch((error: unknown) => {
            state.busy = "";
            state.loginError = error instanceof Error ? error.message : String(error);
            render();
          });
      },
    },
  }, [
    el("label", { class: "field" }, [el("span", { class: "field-label", text: tr("login.user") }), username]),
    el("label", { class: "field" }, [el("span", { class: "field-label", text: tr("login.pass") }), password]),
    state.loginError ? el("p", { class: "field-error", attrs: { role: "alert" }, text: state.loginError }) : null,
    el("button", {
      class: "button button-primary",
      attrs: { type: "submit", disabled: state.busy !== "" },
      text: state.busy ? tr("common.busy") : tr("login.submit"),
    }),
  ]);

  return el("div", { class: "stack" }, [
    el("section", { class: "card" }, [
      el("h1", { class: "page-title", text: tr("login.title") }),
      el("p", { class: "muted", text: tr("login.body") }),
      form,
      el("p", { class: "muted small", text: tr("login.hint") }),
    ]),
  ]);
}

function renderSessionUnavailable(): HTMLElement {
  return el("div", { class: "stack" }, [
    el("section", { class: "card card-warn" }, [
      el("h1", { class: "page-title", text: tr("session.unavailable.title") }),
      el("p", { text: tr("session.unavailable.body") }),
      state.sessionError ? el("p", { class: "muted small", text: state.sessionError }) : null,
      actionButton(tr("config.retry"), () => void boot(), "primary"),
    ]),
  ]);
}

function renderConfigError(): HTMLElement {
  return el("div", { class: "stack" }, [
    el("section", { class: "card card-danger" }, [
      el("h2", { class: "card-title", text: tr("config.title") }),
      el("p", { text: tr("config.body") }),
      el("p", { class: "mono small", text: `${tr("config.reason")}: ${state.configError ?? ""}` }),
      el("div", { class: "actions" }, [actionButton(tr("config.retry"), () => void boot(), "secondary")]),
    ]),
  ]);
}

function renderHome(): HTMLElement {
  const config = state.config;
  const session = state.session;
  if (!config || !session?.user) return renderConfigError();
  const profiles = profilesForBundle(config.bundle);
  const updateNotice = state.updateReady
    ? el("div", { class: "notice notice-info", attrs: { role: "status" } }, [
        el("span", { text: tr("home.update") }),
        el("button", {
          class: "link-button",
          attrs: { type: "button" },
          text: tr("home.reload"),
          on: { click: () => window.location.reload() },
        }),
      ])
    : null;

  return el("div", { class: "stack" }, [
    noticeBar(),
    updateNotice,
    card(tr("readiness.title"), [
      el("div", { class: "status-row status-ok" }, [
        el("span", { class: "status-label", text: tr("readiness.account") }),
        el("span", { text: session.user.displayName ?? session.user.username }),
      ]),
      el("div", { class: "status-row status-ok" }, [
        el("span", { class: "status-label", text: tr("readiness.config") }),
        el("span", { text: tr("readiness.config.ok", { seq: config.bundle.seq }) }),
        el("span", {
          class: "muted small",
          text: `${config.source} 路 ${tr("readiness.config.age", {
            date: new Date(config.bundle.issued).toLocaleDateString(state.locale === "id" ? "id-ID" : "en-GB"),
          })}${bundleAgeDays(config.bundle, Date.now()) === null ? "" : ` 路 ${bundleAgeDays(config.bundle, Date.now())}d`}`,
        }),
      ]),
      config.updateError ? el("p", { class: "muted small", text: `${tr("config.reason")}: ${config.updateError}` }) : null,
    ]),
    card(
      tr("profile.pick"),
      [
        profiles.length === 0
          ? el("p", { class: "muted", text: tr("profile.empty") })
          : el(
              "ul",
              { class: "profile-list" },
              profiles.map((profile) =>
                el("li", { class: "profile-item" }, [
                  el("div", { class: "profile-meta" }, [
                    el("span", { class: "profile-title", text: localize(profile.title, state.locale) }),
                    el("span", { class: "muted small", text: tr("profile.consumer", { consumer: profile.consumer }) }),
                    el("span", { class: "muted small mono", text: `v${profile.version} 路 ${profile.schema_id}` }),
                  ]),
                  actionButton(tr("readiness.start"), () => startSession(profile.id), "primary"),
                ]),
              ),
            ),
      ],
    ),
    el("div", { class: "actions actions-split" }, [
      actionButton(tr("readiness.history"), () => go({ name: "history" }), "secondary"),
      session.user.role === "admin"
        ? el("a", { class: "button button-secondary", attrs: { href: "/admin" }, text: tr("home.admin") })
        : null,
    ]),
    el("div", { class: "actions actions-stack" }, [
      actionButton(tr("home.signout"), () => void logout(), "secondary"),
    ]),
  ]);
}

function startSession(profileId: string): void {
  state.draft = { profileId, values: {} };
  state.issues = [];
  go({ name: "form" });
}

function issueMessage(issue: ValidationIssue): string {
  return tr(`error.${issue.code}`, issue.detail === undefined ? undefined : { detail: issue.detail });
}

function clearIssue(key: string): void {
  if (!state.issues.some((issue) => issue.key === key)) return;
  state.issues = state.issues.filter((issue) => issue.key !== key);
  const control = document.getElementById(fieldId(key));
  const wrapper = control?.closest(".field");
  wrapper?.classList.remove("field-invalid");
  control?.removeAttribute("aria-invalid");
  control?.removeAttribute("aria-describedby");
  wrapper?.querySelector(".field-error")?.remove();
}

function renderField(profile: Profile, field: FieldDef): HTMLElement {
  const draft = state.draft;
  const id = fieldId(field.key);
  const issues = state.issues.filter((issue) => issue.key === field.key);
  const value = draft?.values[field.key];
  const labelText = localize(field.label, state.locale);
  const label = el("label", { class: "field-label", attrs: { for: id } }, [
    el("span", { text: labelText }),
    el("span", { class: field.required ? "tag tag-required" : "tag", text: field.required ? tr("form.required") : tr("form.optional") }),
  ]);
  const common = {
    id,
    name: field.key,
    "aria-describedby": issues.length > 0 ? `${id}-error` : undefined,
    "aria-invalid": issues.length > 0,
  } as Record<string, string | boolean | undefined>;

  let control: HTMLElement;
  let suggestions: HTMLElement | null = null;
  switch (field.type) {
    case "select":
    case "device_id": {
      const options = optionsFor(field, state.config!.bundle);
      if (field.type === "device_id" && !field.list) {
        control = el("input", {
          class: "input",
          attrs: { ...common, type: "text", maxlength: field.max, placeholder: localize(field.placeholder, state.locale) },
          props: { value: value === undefined ? "" : String(value) },
          on: { input: (event) => {
            if (!draft) return;
            draft.values[field.key] = (event.target as HTMLInputElement).value;
            clearIssue(field.key);
          } },
        });
      } else if (options.length >= 8) {
        const listId = `options-${id}`;
        control = el("input", {
          class: "input",
          attrs: {
            ...common,
            type: "text",
            list: listId,
            required: field.required === true,
            autocomplete: "off",
            placeholder: tr("form.search"),
          },
          props: { value: value === undefined ? "" : String(value) },
          on: { input: (event) => {
            if (!draft) return;
            draft.values[field.key] = (event.target as HTMLInputElement).value;
            clearIssue(field.key);
          } },
        });
        suggestions = el("datalist", { attrs: { id: listId } }, options.map((option) =>
          el("option", { attrs: { value: String(option) } })));
      } else {
        control = el(
          "select",
          {
            class: "input",
            attrs: { ...common, required: field.required === true },
            on: {
              change: (event) => {
                if (!draft) return;
                draft.values[field.key] = (event.target as HTMLSelectElement).value;
                clearIssue(field.key);
              },
            },
          },
          [
            el("option", { attrs: { value: "" }, text: tr("form.select") }),
            ...options.map((option) =>
              el("option", {
                attrs: { value: String(option), selected: value !== undefined && String(value) === String(option) },
                text: String(option),
              }),
            ),
          ],
        );
      }
      break;
    }
    case "checkbox":
      control = el("input", {
        class: "checkbox",
        attrs: { ...common, type: "checkbox", checked: value === true },
        on: {
          change: (event) => {
            if (!draft) return;
            draft.values[field.key] = (event.target as HTMLInputElement).checked;
            clearIssue(field.key);
          },
        },
      });
      break;
    case "number":
      control = el("input", {
        class: "input",
        attrs: { ...common, type: "number", inputmode: "decimal", min: field.min, max: field.max },
        props: { value: value === undefined ? "" : String(value) },
        on: {
          input: (event) => {
            if (!draft) return;
            draft.values[field.key] = (event.target as HTMLInputElement).value;
            clearIssue(field.key);
          },
        },
      });
      break;
    case "datetime":
      control = el("input", {
        class: "input",
        attrs: { ...common, type: "datetime-local" },
        props: { value: value === undefined ? "" : String(value) },
        on: {
          input: (event) => {
            if (!draft) return;
            draft.values[field.key] = (event.target as HTMLInputElement).value;
            clearIssue(field.key);
          },
        },
      });
      break;
    case "constant":
      control = el("input", {
        class: "input input-readonly",
        attrs: { ...common, type: "text", readonly: true, value: String(field.value ?? "") },
      });
      break;
    case "computed":
      control = el("input", {
        class: "input input-readonly mono",
        attrs: {
          ...common,
          type: "text",
          readonly: true,
          value: field.source === "device_kid" ? "AITQR" : tr("form.session.auto"),
          tabindex: -1,
        },
      });
      break;
    default:
      control = el("input", {
        class: "input",
        attrs: {
          ...common,
          type: "text",
          maxlength: field.max,
          placeholder: localize(field.placeholder, state.locale),
          autocomplete: "off",
          spellcheck: "false",
        },
        props: { value: value === undefined ? "" : String(value) },
        on: {
          input: (event) => {
            if (!draft) return;
            draft.values[field.key] = (event.target as HTMLInputElement).value;
            clearIssue(field.key);
          },
          blur: (event) => {
            const text = (event.target as HTMLInputElement).value;
            if (!text || !draft || !state.config) return;
            const found = validateValues(profile, state.config.bundle, { ...draft.values, [field.key]: text }).filter(
              (issue) => issue.key === field.key,
            );
            if (found.length > 0) {
              state.issues = [...state.issues.filter((issue) => issue.key !== field.key), ...found];
              render();
            }
          },
        },
      });
      break;
  }

  return el("div", { class: `field ${issues.length ? "field-invalid" : ""}` }, [
    label,
    control,
    suggestions,
    field.help ? el("p", { class: "help", text: localize(field.help, state.locale) }) : null,
    issues.length
      ? el("div", { class: "field-error", attrs: { id: `${id}-error`, role: "alert" } }, issues.map((issue) => el("p", { text: issueMessage(issue) })))
      : null,
  ]);
}

function renderForm(): HTMLElement {
  const draft = state.draft;
  const profile = draft ? profileOf(draft.profileId) : undefined;
  if (!draft || !profile) return el("p", { text: tr("common.error") });

  const groups = groupsOf(profile);
  const sections = groups.map((group) => {
    const fields = fieldsOf(profile).filter((field) => (field.group ?? "details") === group);
    const groupKey = `form.group.${group}`;
    return el("section", { class: "card" }, [
      el("h2", { class: "card-title", text: t(groupKey, state.locale) === groupKey ? group : tr(groupKey) }),
      ...fields.map((field) => renderField(profile, field)),
    ]);
  });

  return el("div", { class: "stack" }, [
    noticeBar(),
    el("div", { class: "page-head" }, [
      el("h1", { class: "page-title", text: localize(profile.title, state.locale) }),
      el("p", { class: "muted small", text: tr("form.session.hint") }),
    ]),
    ...sections,
    el("div", { class: "actions actions-stack" }, [
      actionButton(tr("form.review"), () => reviewDraft(), "primary"),
      actionButton(tr("form.back"), () => go({ name: "home" }), "secondary"),
    ]),
  ]);
}

function reviewDraft(): void {
  const draft = state.draft;
  const profile = draft ? profileOf(draft.profileId) : undefined;
  if (!draft || !profile || !state.config) return;
  const issues = validateValues(profile, state.config.bundle, draft.values);
  state.issues = issues;
  if (issues.length > 0) {
    state.notice = tr("form.check");
    render();
    return;
  }
  state.notice = null;
  go({ name: "review" });
}

function summaryRows(profile: Profile): { label: string; value: string }[] {
  const draft = state.draft;
  if (!draft) return [];
  const rows: { label: string; value: string }[] = [];
  for (const field of fieldsOf(profile)) {
    if (field.type === "computed") continue;
    const raw = field.type === "constant" ? field.value : draft.values[field.key];
    if (raw === undefined || raw === "") continue;
    rows.push({
      label: localize(field.label, state.locale),
      value: typeof raw === "boolean" ? (raw ? tr("common.yes") : tr("common.no")) : String(raw),
    });
  }
  rows.push({ label: tr("review.profile"), value: `${profile.id} v${profile.version}` });
  rows.push({ label: tr("review.sid.pending"), value: "-" });
  return rows;
}

function renderReview(): HTMLElement {
  const draft = state.draft;
  const profile = draft ? profileOf(draft.profileId) : undefined;
  if (!draft || !profile) return el("p", { text: tr("common.error") });
  const limit = profile.limits?.max_token_chars ?? 800;
  const target = profile.limits?.target_token_chars ?? 400;
  const previewSessionId = "0000000000000000";
  const previewDerived = derivedValues(profile, {
    sessionId: previewSessionId,
    deviceKid: "AITQR",
    now: Date.now(),
  });
  const previewPayload = buildPayload(profile, state.config!.bundle, draft.values, previewDerived, previewSessionId);
  const estimate = estimateTokenChars(previewPayload);
  const warn = estimate > target;

  return el("div", { class: "stack" }, [
    noticeBar(),
    el("div", { class: "page-head" }, [
      el("h1", { class: "page-title", text: tr("review.title") }),
      el("p", { class: "muted small", text: localize(profile.title, state.locale) }),
    ]),
    el("section", { class: "card" }, [
      el(
        "dl",
        { class: "summary" },
        summaryRows(profile).flatMap((row) => [el("dt", { text: row.label }), el("dd", { class: "mono", text: row.value })]),
      ),
    ]),
    el("section", { class: `card ${warn ? "card-warn" : ""}`.trim() }, [
      el("h2", { class: "card-title", text: tr("review.budget") }),
      el("p", { class: "mono", text: tr("review.budget.value", { chars: estimate, limit }) }),
      warn ? el("p", { class: "muted small", text: tr("review.budget.warn") }) : null,
    ]),
    el("p", { class: "muted small", text: tr("review.recipient", { name: profile.consumer || profile.id }) }),
    el("div", { class: "actions actions-stack" }, [
      actionButton(state.busy ? tr("common.busy") : tr("review.generate"), () => void generate(), "primary"),
      actionButton(tr("review.edit"), () => go({ name: "form" }), "secondary"),
    ]),
  ]);
}

async function generate(): Promise<void> {
  const draft = state.draft;
  const profile = draft ? profileOf(draft.profileId) : undefined;
  if (!draft || !profile || !state.config || state.busy) return;
  state.busy = "issue";
  state.notice = null;
  state.issues = [];
  render();

  try {
    const now = Date.now();
    const sid = newSessionId((length) => crypto.getRandomValues(new Uint8Array(length)));
    const derived = derivedValues(profile, { sessionId: sid, deviceKid: "AITQR", now });
    const payload = buildPayload(profile, state.config.bundle, draft.values, derived, sid);
    const maxChars = profile.limits?.max_token_chars ?? 800;
    const { token } = await issueEncryptedToken(payload, profile.recipient.public, maxChars);

    const summary: Record<string, string> = {};
    for (const field of fieldsOf(profile)) {
      const raw = field.type === "constant" ? field.value : draft.values[field.key];
      if (raw !== undefined && raw !== "" && field.type !== "computed") summary[field.key] = String(raw);
    }
    const record: IssueRecord = {
      sid,
      profileId: profile.id,
      profileVersion: profile.version,
      issuedAt: now,
      token,
      kidHex: "MQ1",
      summary,
    };
    try {
      await addRecord(record);
    } catch {
      state.notice = tr("history.save.failed");
    }
    state.busy = "";
    go({ name: "qr", record, redisplay: false });
  } catch (error) {
    state.busy = "";
    if (error instanceof TokenTooLargeError) {
      const labels = payloadKeyLabels(profile);
      const worst = Object.keys(labels).find((short) => short !== "p" && short !== "pv" && short !== "s");
      state.notice = tr("error.budget", { limit: profile.limits?.max_token_chars ?? 800, field: worst ? labels[worst] : "-" });
    } else {
      state.notice = error instanceof Error ? error.message : tr("common.error");
    }
    render();
  }
}

type ScreenWakeLockSentinel = { release(): Promise<void>; addEventListener?(type: "release", listener: () => void): void };
type ScreenWakeLockApi = { request(type: "screen"): Promise<ScreenWakeLockSentinel> };

let activeWakeLock: ScreenWakeLockSentinel | null = null;
let wakeLockPending = false;

async function releaseQrWakeLock(): Promise<void> {
  const lock = activeWakeLock;
  activeWakeLock = null;
  wakeLockPending = false;
  state.wakeLockStatus = "idle";
  if (lock) await lock.release().catch(() => undefined);
}

async function ensureQrWakeLock(): Promise<void> {
  if (state.view.name !== "qr" || activeWakeLock || wakeLockPending || state.wakeLockStatus === "unsupported" || state.wakeLockStatus === "failed") return;
  const api = (navigator as Navigator & { wakeLock?: ScreenWakeLockApi }).wakeLock;
  if (!api) {
    state.wakeLockStatus = "unsupported";
    return;
  }
  wakeLockPending = true;
  state.wakeLockStatus = "pending";
  try {
    const lock = await api.request("screen");
    if (state.view.name !== "qr") {
      await lock.release().catch(() => undefined);
      return;
    }
    activeWakeLock = lock;
    state.wakeLockStatus = "active";
    lock.addEventListener?.("release", () => {
      if (activeWakeLock === lock) {
        activeWakeLock = null;
        state.wakeLockStatus = "idle";
      }
    });
  } catch {
    state.wakeLockStatus = "failed";
  } finally {
    wakeLockPending = false;
    if (state.view.name === "qr") render();
  }
}

function renderQr(record: IssueRecord, redisplay: boolean): HTMLElement {
  void ensureQrWakeLock();
  const profile = profileOf(record.profileId);
  const ecc = profile?.qr?.ecc ?? state.config?.bundle.global.qr.ecc ?? "Q";
  const quiet = state.config?.bundle.global.qr.quiet_modules ?? 4;
  const ratio = profile?.qr?.min_display_ratio ?? 0.72;
  const viewport = Math.min(window.innerWidth - 40, 560);
  const sizePx = Math.max(240, Math.floor(viewport * Math.max(0.5, Math.min(0.9, ratio))));
  const rendered = renderQrSvg(record.token, { ecc, quietModules: quiet, sizePx });
  const qrBox = el("div", { class: "qr-box" });
  qrBox.innerHTML = rendered.markup;

  const summary = profile
    ? fieldsOf(profile)
        .filter((field) => record.summary[field.key] !== undefined)
        .slice(0, 2)
        .map((field) => `${localize(field.label, state.locale)}: ${record.summary[field.key]}`)
        .join(" 路 ")
    : "";

  return el("div", { class: "qr-screen" }, [
    noticeBar(),
    el("h1", { class: "qr-title", text: tr("qr.title") }),
    el("p", { class: "muted", text: tr("qr.hint") }),
    redisplay ? el("p", { class: "badge badge-warn", text: tr("history.shownAgain") }) : null,
    qrBox,
    el("p", { class: "session-code mono", text: `SID ${record.sid}` }),
    summary ? el("p", { class: "muted small", text: summary }) : null,
    el("p", {
      class: "muted small mono",
      text: `${record.profileId} v${record.profileVersion} 路 ${rendered.modules}脳${rendered.modules} 路 ${record.token.length} ${
        state.locale === "id" ? "karakter" : "chars"
      }`,
    }),
    el("p", { class: "muted small", text: tr("qr.brightness") }),
    el("p", { class: "muted small", text: tr(state.wakeLockStatus === "active" ? "qr.wake" : state.wakeLockStatus === "unsupported" || state.wakeLockStatus === "failed" ? "qr.wake.unsupported" : "qr.wake.pending") }),
    el("p", { class: "muted small", text: tr("qr.encrypted") }),
    el("div", { class: "actions actions-stack" }, [
      el("div", { class: "actions actions-row" }, [
        el("button", {
          class: "button button-secondary",
          attrs: { type: "button" },
          text: tr("qr.copy"),
          on: {
            click: () => {
              void (async () => {
                try {
                  if (!navigator.clipboard?.writeText) throw new Error("Clipboard tidak tersedia pada browser ini.");
                  await navigator.clipboard.writeText(record.token);
                  state.notice = tr("qr.copied");
                } catch {
                  state.notice = tr("qr.copy.failed");
                }
                render();
              })();
            },
          },
        }),
        el("button", {
          class: "button button-secondary",
          attrs: { type: "button" },
          text: tr("qr.back"),
          on: { click: () => go(redisplay ? { name: "history" } : { name: "review" }) },
        }),
      ]),
      actionButton(tr("qr.finish"), () => {
        state.draft = null;
        go({ name: "home" });
      }, "primary"),
    ]),
  ]);
}

async function renderHistory(): Promise<HTMLElement> {
  let records: IssueRecord[] = [];
  try {
    records = await listRecords();
  } catch (error) {
    state.notice = error instanceof Error ? error.message : String(error);
  }
  return el("div", { class: "stack" }, [
    noticeBar(),
    el("div", { class: "page-head" }, [
      el("h1", { class: "page-title", text: tr("history.title") }),
      el("p", { class: "muted small", text: tr("history.local") }),
    ]),
    records.length === 0
      ? el("section", { class: "card" }, [el("p", { class: "muted", text: tr("history.empty") })])
      : el(
          "ul",
          { class: "history-list" },
          records.map((record) => {
            const profile = profileOf(record.profileId);
            return el("li", { class: "history-item" }, [
              el("div", { class: "stack-tight" }, [
                el("span", { class: "mono session-code", text: record.sid }),
                el("span", {
                  class: "muted small",
                  text: `${new Date(record.issuedAt).toLocaleString(state.locale === "id" ? "id-ID" : "en-GB")} 路 ${
                    profile ? localize(profile.title, state.locale) : record.profileId
                  } v${record.profileVersion}`,
                }),
              ]),
              el("button", {
                class: "button button-secondary button-small",
                attrs: { type: "button" },
                text: tr("history.redisplay"),
                on: { click: () => go({ name: "qr", record, redisplay: true }) },
              }),
            ]);
          }),
        ),
    el("div", { class: "actions actions-stack" }, [
      actionButton(tr("form.back"), () => go({ name: "home" }), "primary"),
      records.length > 0
        ? actionButton(
            tr("history.clear"),
            async () => {
              if (!window.confirm(tr("history.clear.confirm"))) return;
              try {
                await clearRecords();
                state.notice = null;
                render();
              } catch {
                state.notice = tr("history.clear.failed");
                render();
              }
            },
            "danger",
          )
        : null,
    ]),
  ]);
}

async function renderHistoryAsync(): Promise<void> {
  const view = await renderHistory();
  if (state.view.name === "history") replace(root(), view);
}

// ---------------------------------------------------------------- render

function render(): void {
  document.documentElement.lang = state.locale;
  renderHeader();
  const main = root();
  switch (state.view.name) {
    case "boot":
      replace(main, el("p", { class: "muted", text: tr("status.checking") }));
      break;
    case "login":
      replace(main, renderLogin());
      break;
    case "session-unavailable":
      replace(main, renderSessionUnavailable());
      break;
    case "config-error":
      replace(main, renderConfigError());
      break;
    case "home":
      replace(main, renderHome());
      break;
    case "form":
      replace(main, renderForm());
      break;
    case "review":
      replace(main, renderReview());
      break;
    case "qr":
      replace(main, renderQr(state.view.record, state.view.redisplay));
      break;
    case "history":
      replace(main, el("p", { class: "muted", text: tr("status.checking") }));
      void renderHistoryAsync();
      break;
  }
}

export function startApp(): void {
  window.addEventListener("aitqr:update", () => {
    state.updateReady = true;
    if (state.view.name === "home") render();
  });
  window.addEventListener("online", () => {
    if (state.config) state.config = { ...state.config, offline: false };
    render();
  });
  window.addEventListener("offline", () => {
    if (state.config) state.config = { ...state.config, offline: true };
    render();
  });
  window.addEventListener("resize", () => {
    if (state.view.name === "qr") render();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.view.name === "qr") {
      if (state.wakeLockStatus === "failed" || state.wakeLockStatus === "unsupported") state.wakeLockStatus = "idle";
      void ensureQrWakeLock();
    }
  });
  window.addEventListener("pagehide", () => { void releaseQrWakeLock(); });
  void boot();
}
