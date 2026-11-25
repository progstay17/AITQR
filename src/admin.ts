/**
 * Admin console: accounts (username, password, public key), metadata fields, keys and publication.
 * AITQR never generates account keys — the administrator only stores each account's public key.
 */
import { el, replace } from "./dom.js";
import { DERIVED_SOURCES, FIELD_TYPES, validateProfile } from "./profile.js";
import { exportAllProfilePresets, exportProfilePreset, importProfilePresets } from "./preset.js";
import type { Bundle, FieldDef, Localized, Profile } from "./types.js";

interface AdminSession {
  signedIn: boolean;
  user: { username: string; displayName: string | null; role: string } | null;
}

interface Health {
  admins: number;
  users: number;
  publishedSeq: number | null;
  configured: { adminKey: boolean; sessionKey: boolean };
}

interface UserRow {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
  status: string;
  createdAt: number;
  lastSeenAt: number | null;
}

interface AuditRow {
  at: number;
  actor: string | null;
  action: string;
  detail: string | null;
}

interface AccountConfigRow {
  userId: string;
  draftSource: string;
  updatedAt: number;
  updatedBy: string | null;
  publishedAt: number;
  publishedSeq: number;
}

interface AdminState {
  user: { username: string; displayName: string | null; role: string };
  draft: { source: string; updatedAt: number; updatedBy: string | null } | null;
  published: { seq: number; created_at: number; created_by: string | null; note: string | null } | null;
  users: UserRow[];
  accountConfigs: AccountConfigRow[];
  audit: AuditRow[];
}


interface State {
  session: AdminSession | null;
  health: Health | null;
  loaded: AdminState | null;
  doc: Bundle | null;
  profileId: string | null;
  accountId: string | null;
  dirty: boolean;
  busy: string;
  notice: string | null;
  noticeKind: "info" | "success" | "error";
  loginError: string | null;
  activeTab: "qr" | "users" | "audit";
}

const listTypeOverrides = new Map<string, "string" | "number">();

const state: State = {
  session: null,
  health: null,
  loaded: null,
  doc: null,
  profileId: null,
  accountId: null,
  dirty: false,
  busy: "",
  notice: null,
  noticeKind: "info",
  loginError: null,
  activeTab: "qr",
};


const root = (): HTMLElement => document.getElementById("main") as HTMLElement;
const header = (): HTMLElement => document.getElementById("app-header") as HTMLElement;

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
    const record = payload as { error?: string; problems?: string[] } | null;
    const detail = record?.problems?.length ? record.problems.join("; ") : record?.error;
    throw new Error(detail ?? `HTTP ${response.status}`);
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

function note(message: string | null, kind: "info" | "success" | "error" = "info"): void {
  state.notice = message;
  state.noticeKind = message ? kind : "info";
  render();
}

function card(title: string, children: (Node | string | null | undefined)[], subtitle?: string): HTMLElement {
  return el("section", { class: "card" }, [
    el("h2", { class: "card-title", text: title }),
    subtitle ? el("p", { class: "muted small", text: subtitle }) : null,
    ...children,
  ]);
}

function button(
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

function input(
  value: string,
  onChange: (next: string) => void,
  options: { type?: string; placeholder?: string; label?: string; mono?: boolean; readonly?: boolean; disabled?: boolean; onBlur?: () => void } = {},
): HTMLElement {
  const control = el("input", {
    class: `input${options.mono ? " mono" : ""}`,
    attrs: {
      type: options.type ?? "text",
      placeholder: options.placeholder,
      readonly: options.readonly,
      disabled: options.disabled || state.busy !== "",
      autocomplete: "off",
      spellcheck: "false",
    },
    props: { value },
    on: {
      input: (event) => onChange((event.target as HTMLInputElement).value),
      blur: options.onBlur ? () => options.onBlur?.() : undefined,
    },
  });
  if (!options.label) return control;
  return el("label", { class: "field" }, [el("span", { class: "field-label", text: options.label }), control]);
}

function localizeParts(value: Localized | undefined): { id: string; en: string } {
  if (value === undefined) return { id: "", en: "" };
  if (typeof value === "string") return { id: value, en: value };
  return { id: value.id, en: value.en };
}

function setLocalized(target: { label?: Localized }, parts: { id: string; en: string }): void {
  const same = parts.id === parts.en;
  target.label = same ? parts.id : { id: parts.id, en: parts.en };
}

function selectedProfile(): Profile | null {
  const doc = state.doc;
  if (!doc || doc.profiles.length === 0) return null;
  return doc.profiles.find((profile) => profile.id === state.profileId) ?? doc.profiles[0];
}

function selectedAccountConfig(): AccountConfigRow | null {
  return state.loaded?.accountConfigs.find((config) => config.userId === state.accountId) ?? null;
}

function loadSelectedAccountDraft(): void {
  const config = selectedAccountConfig();
  state.doc = config ? (JSON.parse(config.draftSource) as Bundle) : null;
  state.dirty = false;
  const ids = state.doc?.profiles.map((profile) => profile.id) ?? [];
  if (!state.profileId || !ids.includes(state.profileId)) state.profileId = ids[0] ?? null;
}

async function refresh(): Promise<void> {
  await load();
}

// ---------------------------------------------------------------- views

function renderHeader(): void {
  const user = state.session?.user;
  replace(
    header(),
    el("div", { class: "topbar-inner" }, [
      el("a", { class: "brand", attrs: { href: "/" } }, [
        el("span", { class: "brand-mark", attrs: { "aria-hidden": "true" } }),
        el("span", { class: "brand-text" }, [
          el("strong", { text: "AITQR Admin" }),
          el("span", { class: "brand-sub", text: "Akun, kolom metadata, kunci" }),
        ]),
      ]),
      el("div", { class: "topbar-actions" }, [
        user ? el("span", { class: "pill", text: `${user.username} · ${user.role}` }) : null,
        el("a", { class: "button button-secondary button-small", attrs: { href: "/" }, text: "Aplikasi" }),
      ]),
    ]),
  );
}

function loginForm(): HTMLElement {
  const username = el("input", {
    class: "input",
    attrs: { type: "text", autocomplete: "username", autocapitalize: "none", required: true },
    props: { value: "" },
  }) as HTMLInputElement;
  const password = el("input", {
    class: "input",
    attrs: { type: "password", autocomplete: "current-password", required: true },
  }) as HTMLInputElement;

  return el("form", {
    class: "stack",
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
            return load();
          })
          .catch((error: unknown) => {
            state.busy = "";
            state.loginError = error instanceof Error ? error.message : String(error);
            render();
          });
      },
    },
  }, [
    el("label", { class: "field" }, [el("span", { class: "field-label", text: "Username" }), username]),
    el("label", { class: "field" }, [el("span", { class: "field-label", text: "Kata sandi" }), password]),
    state.loginError ? el("p", { class: "field-error", attrs: { role: "alert" }, text: state.loginError }) : null,
    el("button", {
      class: "button button-primary",
      attrs: { type: "submit", disabled: state.busy !== "" },
      text: state.busy ? "Memproses…" : "Masuk",
    }),
  ]);
}

function renderLogin(): HTMLElement {
  return el("div", { class: "stack" }, [
    card("Masuk sebagai administrator", [
      el("p", { class: "muted", text: "Konsol ini memakai akun yang dibuat di panel admin." }),
      loginForm(),
    ]),
  ]);
}

function renderBootstrap(): HTMLElement {
  const username = el("input", {
    class: "input",
    attrs: { type: "text", autocomplete: "username", autocapitalize: "none", required: true },
    props: { value: "" },
  }) as HTMLInputElement;
  const password = el("input", {
    class: "input",
    attrs: { type: "password", autocomplete: "new-password", required: true, minlength: 8 },
  }) as HTMLInputElement;
  const code = el("input", {
    class: "input mono",
    attrs: { type: "text", placeholder: "kode setup dari server", spellcheck: "false", required: true },
  }) as HTMLInputElement;

  return el("div", { class: "stack" }, [
    card("Buat administrator pertama", [
      el("p", {
        class: "muted",
        text: "Belum ada akun. Buat administrator pertama; setelah ini akun petugas dibuat dari panel ini juga.",
      }),
      el("form", {
        class: "stack",
        on: {
          submit: (event) => {
            event.preventDefault();
            if (state.busy) return;
            state.busy = "bootstrap";
            state.loginError = null;
            render();
            void api("/api/bootstrap", {
              method: "POST",
              body: JSON.stringify({ username: username.value, password: password.value, code: code.value }),
            })
              .then(() => {
                state.busy = "";
                return load();
              })
              .catch((error: unknown) => {
                state.busy = "";
                state.loginError = error instanceof Error ? error.message : String(error);
                render();
              });
          },
        },
      }, [
        el("label", { class: "field" }, [el("span", { class: "field-label", text: "Username admin" }), username]),
        el("label", { class: "field" }, [el("span", { class: "field-label", text: "Kata sandi (min. 8)" }), password]),
        el("label", { class: "field" }, [el("span", { class: "field-label", text: "Kode setup" }), code]),
        state.loginError ? el("p", { class: "field-error", attrs: { role: "alert" }, text: state.loginError }) : null,
        el("button", { class: "button button-primary", attrs: { type: "submit" }, text: "Buat administrator" }),
      ]),
    ]),
  ]);
}

function renderForbidden(): HTMLElement {
  return el("div", { class: "stack" }, [
    card("Akses ditolak", [
      el("p", { class: "muted", text: "Akun ini bukan administrator." }),
      el("p", { class: "muted small mono", text: `username: ${state.session?.user?.username ?? "-"}` }),
      el("div", { class: "actions" }, [button("Keluar", () => void logout(), "secondary")]),
    ]),
  ]);
}

function fieldEditor(profile: Profile, field: FieldDef, index: number): HTMLElement {
  const doc = state.doc;
  const listName = field.list ?? field.key;
  const options = listName && doc?.lists[listName] ? doc.lists[listName] : [];
  const listKey = `${state.accountId ?? ""}::${listName}`;
  const optionType = listTypeOverrides.get(listKey) ??
    (options.length > 0 && options.every((value) => typeof value === "number") ? "number" : "string");
  const markDirty = (): void => { state.dirty = true; };
  const localizedInput = (
    locale: "id" | "en",
    target: "placeholder" | "help",
  ): HTMLElement => input(localizeParts(field[target])[locale], (next) => {
    const parts = { ...localizeParts(field[target]), [locale]: next };
    field[target] = parts.id === parts.en ? parts.id : parts;
    markDirty();
  }, { label: target === "placeholder" ? (locale === "id" ? "Placeholder (Indonesia)" : "Placeholder (English)") :
    (locale === "id" ? "Petunjuk (Indonesia)" : "Help text (English)") });

  const typeControl = el("select", {
    class: "input",
    attrs: { disabled: state.busy !== "" },
    props: { value: field.type },
    on: { change: (event) => {
      field.type = (event.target as HTMLSelectElement).value as FieldDef["type"];
      if (field.type === "constant" && field.value === undefined) field.value = "";
      if (field.type === "computed" && !field.source) field.source = "session_id";
      if ((field.type === "select" || field.type === "device_id") && !field.list) field.list = field.key;
      markDirty();
      render();
    } },
  }, FIELD_TYPES.map((type) => el("option", { attrs: { value: type, selected: field.type === type }, text: type })));

  const controls: (Node | string | null)[] = [
    input(field.key, (next) => { field.key = next.trim(); markDirty(); },
      { label: "Kunci field", mono: true, placeholder: "recorder" }),
    el("label", { class: "field" }, [el("span", { class: "field-label", text: "Tipe data" }), typeControl]),
    input(localizeParts(field.label).id, (next) => {
      const parts = { ...localizeParts(field.label), id: next };
      field.label = parts.id === parts.en ? parts.id : parts;
      markDirty();
    }, { label: "Label (Indonesia)" }),
    input(localizeParts(field.label).en, (next) => {
      const parts = { ...localizeParts(field.label), en: next };
      field.label = parts.id === parts.en ? parts.id : parts;
      markDirty();
    }, { label: "Label (English)" }),
    input(field.short ?? "", (next) => { field.short = next.trim() || undefined; markDirty(); },
      { label: "Kunci payload (short)", mono: true, placeholder: "r" }),
    input(field.group ?? "details", (next) => { field.group = next.trim() || "details"; markDirty(); },
      { label: "Grup form", placeholder: "details / place / camera" }),
  ];

  if (field.type === "constant") {
    const valueType = typeof field.value === "number" ? "number" : typeof field.value === "boolean" ? "boolean" : "string";
    const valueTypeControl = el("select", {
      class: "input",
      attrs: { disabled: state.busy !== "" },
      props: { value: valueType },
      on: { change: (event) => {
        const next = (event.target as HTMLSelectElement).value;
        field.value = next === "number" ? 0 : next === "boolean" ? false : String(field.value ?? "");
        markDirty();
        render();
      } },
    }, ["string", "number", "boolean"].map((value) =>
      el("option", { attrs: { value, selected: value === valueType }, text: value })));
    controls.push(el("label", { class: "field" }, [
      el("span", { class: "field-label", text: "Tipe nilai konstanta" }), valueTypeControl,
    ]));
    if (valueType === "boolean") {
      controls.push(el("label", { class: "field" }, [
        el("span", { class: "field-label", text: "Nilai tetap" }),
        el("select", {
          class: "input",
          attrs: { disabled: state.busy !== "" },
          props: { value: String(field.value) },
          on: { change: (event) => { field.value = (event.target as HTMLSelectElement).value === "true"; markDirty(); } },
        }, [
          el("option", { attrs: { value: "true" }, text: "true" }),
          el("option", { attrs: { value: "false" }, text: "false" }),
        ]),
      ]));
    } else {
      controls.push(input(String(field.value ?? ""), (next) => {
        field.value = valueType === "number" ? (next.trim() === "" ? 0 : Number(next)) : next;
        markDirty();
      }, { label: "Nilai tetap", type: valueType === "number" ? "number" : "text" }));
    }
  }

  if (field.type === "computed") {
    controls.push(el("label", { class: "field" }, [
      el("span", { class: "field-label", text: "Sumber variabel otomatis" }),
      el("select", {
        class: "input",
        attrs: { disabled: state.busy !== "" },
        props: { value: field.source ?? "session_id" },
        on: { change: (event) => { field.source = (event.target as HTMLSelectElement).value as FieldDef["source"]; markDirty(); } },
      }, DERIVED_SOURCES.map((source) =>
        el("option", { attrs: { value: source, selected: source === (field.source ?? "session_id") }, text: source }))),
    ]));
  }

  if (field.type !== "constant" && field.type !== "computed") {
    if (field.type === "number") {
      controls.push(input(field.min === undefined ? "" : String(field.min), (next) => {
        field.min = next.trim() === "" ? undefined : Number(next);
        markDirty();
      }, { label: "Nilai minimum", type: "number" }));
    }
    controls.push(input(field.max === undefined ? "" : String(field.max), (next) => {
      field.max = next.trim() === "" ? undefined : Number(next);
      markDirty();
    }, { label: field.type === "number" ? "Nilai maksimum" : "Panjang maksimum (karakter)", type: "number" }));
    controls.push(input(field.pattern ?? "", (next) => { field.pattern = next.trim() || undefined; markDirty(); },
      { label: "Pola validasi (regex)", mono: true }));
    controls.push(localizedInput("id", "placeholder"));
    controls.push(localizedInput("en", "placeholder"));
    controls.push(localizedInput("id", "help"));
    controls.push(localizedInput("en", "help"));
  }

  if (field.type === "select" || (field.type === "device_id" && field.list)) {
    controls.push(input(field.list ?? field.key, (next) => { field.list = next.trim() || undefined; markDirty(); },
      { label: "Nama daftar opsi", mono: true }));
    controls.push(el("label", { class: "field" }, [
      el("span", { class: "field-label", text: "Tipe nilai opsi" }),
      el("select", {
        class: "input",
        attrs: { disabled: state.busy !== "" },
        props: { value: optionType },
        on: { change: (event) => {
          const nextType = (event.target as HTMLSelectElement).value as "string" | "number";
          const target = field.list ?? field.key;
          const key = `${state.accountId ?? ""}::${target}`;
          const current = state.doc?.lists[target] ?? [];
          if (!state.doc) return;
          const converted = current.map((value) => nextType === "number" ? Number(value) : String(value));
          if (nextType === "number" && converted.some((value) => !Number.isFinite(value))) {
            note("Daftar opsi berisi nilai yang tidak dapat diubah menjadi angka.", "error");
            return;
          }
          listTypeOverrides.set(key, nextType);
          state.doc.lists[target] = converted;
          markDirty();
          render();
        } },
      }, [
        el("option", { attrs: { value: "string", selected: optionType === "string" }, text: "Teks" }),
        el("option", { attrs: { value: "number", selected: optionType === "number" }, text: "Angka" }),
      ]),
    ]));
  }

  const identityTitle = typeof field.label === "string" ? field.label : (field.label.id || field.key);
  const header = el("div", { class: "field-editor-head" }, [
    el("div", { class: "field-editor-identity" }, [
      el("span", { class: "field-editor-index", text: String(index + 1).padStart(2, "0") }),
      el("div", { class: "stack-tight" }, [
        el("strong", { class: "field-editor-title", text: identityTitle }),
        el("span", { class: "tag mono", text: field.key || "(tanpa kunci)" }),
      ]),
    ]),
    el("div", { class: "actions actions-row" }, [
      button("Naik", () => {
        if (index <= 0) return;
        const [item] = profile.fields.splice(index, 1);
        if (item) profile.fields.splice(index - 1, 0, item);
        markDirty();
        render();
      }, "secondary", index === 0),
      button("Turun", () => {
        if (index >= profile.fields.length - 1) return;
        const [item] = profile.fields.splice(index, 1);
        if (item) profile.fields.splice(index + 1, 0, item);
        markDirty();
        render();
      }, "secondary", index === profile.fields.length - 1),
      button("Hapus", () => {
        if (!window.confirm("Hapus kolom " + field.key + " dari draf ini?")) return;
        profile.fields.splice(index, 1);
        const usedLists = new Set(state.doc?.profiles.flatMap((item) => item.fields
          .filter((entry) => entry !== field)
          .map((entry) => entry.list).filter((name): name is string => Boolean(name))) ?? []);
        for (const name of Object.keys(state.doc?.lists ?? {})) {
          if (!usedLists.has(name)) delete state.doc?.lists[name];
        }
        markDirty();
        render();
      }, "danger"),
    ]),
  ]);

  const isListField = field.type === "select" || (field.type === "device_id" && Boolean(field.list));
  return el("section", { class: "field-editor", attrs: { "aria-label": "Konfigurasi kolom " + (index + 1) } }, [
    header,
    el("div", { class: "field-editor-grid" }, controls),
    isListField
      ? el("label", { class: "field field-options" }, [
          el("span", { class: "field-label", text: "Pilihan (satu item per baris; koma tetap diperbolehkan)" }),
          el("textarea", {
            class: "input textarea",
            attrs: { disabled: state.busy !== "" },
            props: { value: (doc?.lists[field.list ?? field.key] ?? []).map(String).join("\n") },
            on: { input: (event) => {
              if (!state.doc) return;
              const target = field.list ?? field.key;
              const key = `${state.accountId ?? ""}::${target}`;
              const raw = (event.target as HTMLTextAreaElement).value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
              const currentType = listTypeOverrides.get(key) ?? optionType;
              const values = currentType === "number" ? raw.map(Number) : raw;
              if (currentType === "number" && values.some((value) => !Number.isFinite(value))) return;
              state.doc.lists[target] = values;
              field.list = target;
              markDirty();
            }, change: (event) => {
              const target = field.list ?? field.key;
              const key = `${state.accountId ?? ""}::${target}`;
              const currentType = listTypeOverrides.get(key) ?? optionType;
              const raw = (event.target as HTMLTextAreaElement).value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
              if (currentType === "number" && raw.some((item) => !Number.isFinite(Number(item)))) {
                note("Semua opsi harus berupa angka saat tipe nilai opsi adalah Angka.", "error");
              }
            } },
          }),
        ])
      : null,
    field.type !== "constant" && field.type !== "computed"
      ? el("label", { class: "field field-inline field-required" }, [
          el("input", {
            class: "checkbox",
            attrs: { type: "checkbox", checked: field.required === true, disabled: state.busy !== "" },
            on: { change: (event) => { field.required = (event.target as HTMLInputElement).checked; markDirty(); } },
          }),
          el("span", { text: "Wajib diisi" }),
        ])
      : null,
  ]);
}

function renderDerivedEditors(profile: Profile): HTMLElement {
  const entries = profile.derived ?? [];
  const editors = entries.map((entry, index) => el("section", { class: "field-editor field-editor-derived" }, [
    el("div", { class: "field-editor-head" }, [
      el("div", { class: "field-editor-identity" }, [
        el("span", { class: "field-editor-index", text: "A" + String(index + 1).padStart(2, "0") }),
        el("strong", { class: "field-editor-title", text: entry.key }),
      ]),
      el("div", { class: "actions actions-row" }, [
        button("Naik", () => {
          if (index <= 0) return;
          const [item] = entries.splice(index, 1); if (item) entries.splice(index - 1, 0, item);
          state.dirty = true; render();
        }, "secondary", index === 0),
        button("Turun", () => {
          if (index >= entries.length - 1) return;
          const [item] = entries.splice(index, 1); if (item) entries.splice(index + 1, 0, item);
          state.dirty = true; render();
        }, "secondary", index === entries.length - 1),
        button("Hapus", () => {
          if (!window.confirm("Hapus variabel otomatis " + entry.key + "?")) return;
          entries.splice(index, 1); state.dirty = true; render();
        }, "danger"),
      ]),
    ]),
    el("div", { class: "field-editor-grid" }, [
      input(entry.key, (next) => { entry.key = next.trim(); state.dirty = true; }, { label: "Kunci variabel", mono: true }),
      input(entry.short ?? "", (next) => { entry.short = next.trim() || undefined; state.dirty = true; }, { label: "Kunci payload", mono: true }),
      input(localizeParts(entry.label).id, (next) => {
        const parts = { ...localizeParts(entry.label), id: next };
        entry.label = parts.id === parts.en ? parts.id : parts; state.dirty = true;
      }, { label: "Label (Indonesia)" }),
      input(localizeParts(entry.label).en, (next) => {
        const parts = { ...localizeParts(entry.label), en: next };
        entry.label = parts.id === parts.en ? parts.id : parts; state.dirty = true;
      }, { label: "Label (English)" }),
      el("label", { class: "field" }, [
        el("span", { class: "field-label", text: "Sumber otomatis" }),
        el("select", {
          class: "input",
          attrs: { disabled: state.busy !== "" },
          props: { value: entry.source },
          on: { change: (event) => { entry.source = (event.target as HTMLSelectElement).value as typeof entry.source; state.dirty = true; } },
        }, DERIVED_SOURCES.map((source) => el("option", { attrs: { value: source, selected: source === entry.source }, text: source }))),
      ]),
    ]),
  ]));
  return card("Variabel otomatis", [
    el("p", { class: "muted small", text: "Nilai ini dibuat AITQR secara otomatis dan tidak dapat diubah petugas." }),
    ...editors,
    button("Tambah variabel otomatis", () => {
      const used = new Set([...profile.fields.map((field) => field.key), ...entries.map((entry) => entry.key)]);
      let key = "auto_baru";
      let suffix = 2;
      while (used.has(key)) key = "auto_baru_" + suffix++;
      const target = profile.derived ?? (profile.derived = []);
      target.push({ key, type: "computed", source: "session_id", label: { id: "Nilai otomatis", en: "Automatic value" } });
      state.dirty = true;
      render();
    }, "secondary"),
  ]);
}

function downloadJsonFile(fileName: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2) + "\n"], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safePresetFileName(value: string): string {
  const safe = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return safe || "aitqr-preset";
}

function renderFields(): HTMLElement | null {
  const doc = state.doc;
  const account = state.loaded?.users.find((item) => item.id === state.accountId);
  const accountConfig = selectedAccountConfig();
  if (!doc || !account || !accountConfig) {
    return card("Preset / Profil QR", [
      el("p", { class: "muted", text: "Pilih atau buat akun untuk mengatur preset payload secara terpisah." }),
    ]);
  }

  const accountSelector = el(
    "select",
    {
      class: "input",
      attrs: { disabled: state.busy !== "" },
      props: { value: state.accountId ?? "" },
      on: {
        change: (event) => {
          const next = (event.target as HTMLSelectElement).value;
          if (state.dirty && !window.confirm("Buang perubahan yang belum disimpan untuk akun ini?")) {
            (event.target as HTMLSelectElement).value = state.accountId ?? "";
            return;
          }
          state.accountId = next;
          state.profileId = null;
          loadSelectedAccountDraft();
          render();
        },
      },
    },
    (state.loaded?.users ?? []).map((item) =>
      el("option", {
        attrs: { value: item.id, selected: item.id === state.accountId },
        text: (item.displayName ?? item.username) + " · " + item.username + " · " + item.role + " · " + item.status,
      }),
    ),
  );

  const profile = selectedProfile();
  const profileSelector = el(
    "select",
    {
      class: "input",
      attrs: { disabled: doc.profiles.length === 0 || state.busy !== "" },
      props: { value: profile?.id ?? "" },
      on: {
        change: (event) => {
          state.profileId = (event.target as HTMLSelectElement).value || null;
          render();
        },
      },
    },
    [
      el("option", { attrs: { value: "" }, text: doc.profiles.length ? "Pilih preset" : "Belum ada preset" }),
      ...doc.profiles.map((item) =>
        el("option", {
          attrs: { value: item.id, selected: item.id === profile?.id },
          text: item.id + " v" + item.version,
        }),
      ),
    ],
  );

  const importInput = el("input", {
    attrs: { type: "file", accept: ".json,application/json", hidden: true, disabled: state.busy !== "" },
    on: {
      change: (event) => {
        const control = event.target as HTMLInputElement;
        const file = control.files?.[0];
        if (!file) return;
        void file.text()
          .then((raw) => {
            const imported = importProfilePresets(JSON.parse(raw) as unknown);
            const ids = new Set(doc.profiles.map((item) => item.id));
            for (const preset of imported) {
              if (ids.has(preset.profile.id)) {
                throw new Error("Preset dengan ID " + preset.profile.id + " sudah ada. Ubah ID file atau hapus preset lama terlebih dahulu.");
              }
              ids.add(preset.profile.id);
            }

            for (const preset of imported) {
              const nextProfile = JSON.parse(JSON.stringify(preset.profile)) as Profile;
              const remapped = new Map<string, string>();
              for (const [listName, options] of Object.entries(preset.lists)) {
                let targetName = listName;
                if (doc.lists[targetName] && JSON.stringify(doc.lists[targetName]) !== JSON.stringify(options)) {
                  const base = listName + "_imported";
                  targetName = base;
                  let suffix = 2;
                  while (doc.lists[targetName] && JSON.stringify(doc.lists[targetName]) !== JSON.stringify(options)) {
                    targetName = base + "_" + suffix++;
                  }
                }
                if (!doc.lists[targetName]) doc.lists[targetName] = [...options];
                remapped.set(listName, targetName);
              }
              for (const field of nextProfile.fields) {
                if (field.list && remapped.has(field.list)) field.list = remapped.get(field.list);
              }
              doc.profiles.push(nextProfile);
              if (doc.global.allowed_profiles && !doc.global.allowed_profiles.includes(nextProfile.id)) {
                doc.global.allowed_profiles.push(nextProfile.id);
              }
            }
            state.profileId = imported[0]?.profile.id ?? null;
            state.dirty = true;
            note(imported.length + " preset berhasil diimpor ke draf akun. Simpan draf sebelum menerbitkan.", "success");
          })
          .catch((error: unknown) => {
            note("Import preset gagal: " + (error instanceof Error ? error.message : String(error)), "error");
          })
          .finally(() => {
            control.value = "";
          });
      },
    },
  });

  const addPreset = (): void => {
    const used = new Set(doc.profiles.map((item) => item.id));
    let id = "preset-baru";
    let suffix = 2;
    while (used.has(id)) id = "preset-baru-" + suffix++;
    const next: Profile = {
      id,
      version: 1,
      title: { id: "Preset baru", en: "New preset" },
      consumer: "",
      recipient: { public: "" },
      schema_id: "",
      fields: [],
    };
    doc.profiles.push(next);
    if (doc.global.allowed_profiles && !doc.global.allowed_profiles.includes(id)) {
      doc.global.allowed_profiles.push(id);
    }
    state.profileId = id;
    state.dirty = true;
    render();
  };

  const removePreset = (): void => {
    if (!profile) return;
    if (!window.confirm("Hapus preset " + profile.id + " dari draf akun ini? Perubahan berlaku setelah draf disimpan dan dipublikasikan.")) return;
    doc.profiles = doc.profiles.filter((item) => item.id !== profile.id);
    const referencedLists = new Set(doc.profiles.flatMap((item) => item.fields.map((field) => field.list).filter((name): name is string => Boolean(name))));
    for (const listName of Object.keys(doc.lists)) {
      if (!referencedLists.has(listName)) delete doc.lists[listName];
    }
    if (doc.global.allowed_profiles) {
      doc.global.allowed_profiles = doc.global.allowed_profiles.filter((id) => id !== profile.id);
    }
    state.profileId = doc.profiles[0]?.id ?? null;
    state.dirty = true;
    render();
  };

  const exportSelectedPreset = (): void => {
    if (!profile) return;
    const problems = validateProfile(profile, doc.lists);
    if (problems.length > 0) {
      note("Preset belum valid: " + problems.join("; "), "error");
      return;
    }
    downloadJsonFile(
      safePresetFileName(profile.id) + ".aitqr-preset.json",
      exportProfilePreset(profile, doc),
    );
    note("Preset " + profile.id + " diekspor sebagai JSON.", "success");
  };

  const exportAllPresets = (): void => {
    const problems = doc.profiles.flatMap((item) => validateProfile(item, doc.lists));
    if (problems.length > 0) {
      note("Semua preset harus valid sebelum export sekaligus: " + problems.join("; "), "error");
      return;
    }
    if (doc.profiles.length === 0) return;
    downloadJsonFile(
      "aitqr-presets.json",
      exportAllProfilePresets(doc.profiles, doc),
    );
    note(doc.profiles.length + " preset diekspor sebagai JSON.", "success");
  };

  const presetActions = el("div", { class: "actions actions-row" }, [
    profileSelector,
    button("Tambah preset", addPreset, "primary"),
    button("Hapus preset", removePreset, "danger", !profile),
    button("Import JSON", () => importInput.click(), "secondary"),
    button("Export preset", exportSelectedPreset, "secondary", !profile),
    button("Export semua", exportAllPresets, "secondary", doc.profiles.length === 0),
    importInput,
  ]);

  const children: (Node | string | null | undefined)[] = [
    el("p", {
      class: "muted small",
      text: "Preset, field, daftar opsi, dan public key penerima hanya berlaku untuk akun " +
        (account.displayName ?? account.username) + ". Template akun baru dimulai kosong; tidak ada skema alat yang dipaksakan.",
    }),
    el("label", { class: "field" }, [
      el("span", { class: "field-label", text: "Akun yang dikonfigurasi" }),
      accountSelector,
    ]),
    el("div", { class: "stack-tight" }, [
      el("span", { class: "field-label", text: "PRESET / SKEMA PAYLOAD" }),
      presetActions,
    ]),
  ];

  if (!profile) {
    children.push(
      el("p", {
        class: "muted",
        text: "Belum ada preset untuk akun ini. Tambahkan preset baru atau impor file JSON. QR belum dapat diterbitkan sampai preset valid dibuat dan dipublikasikan.",
      }),
    );
  } else {
    const originalProfileId = profile.id;
    let pendingProfileId = profile.id;
    const titleParts = localizeParts(profile.title);
    children.push(
      el("div", { class: "field-editor" }, [
        el("h3", { class: "card-title", text: "Identitas preset" }),
        el("div", { class: "grid-2" }, [
          input(profile.id, (next) => {
            pendingProfileId = next.trim();
          }, {
            label: "ID preset",
            mono: true,
            placeholder: "nama-profil",
            onBlur: () => {
              const value = pendingProfileId;
              if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(value)) {
                note("ID preset harus 2–64 karakter, huruf kecil, angka, atau tanda hubung; karakter pertama harus huruf/angka.", "error");
                return;
              }
              if (doc.profiles.some((item) => item !== profile && item.id === value)) {
                note("ID preset sudah dipakai oleh profil lain.", "error");
                return;
              }
              profile.id = value;
              if (doc.global.allowed_profiles?.includes(originalProfileId)) {
                doc.global.allowed_profiles = doc.global.allowed_profiles.filter((id) => id !== originalProfileId);
                if (value) doc.global.allowed_profiles.push(value);
              }
              state.profileId = value;
              state.dirty = true;
            },
          }),
          input(String(profile.version), (next) => {
            profile.version = next.trim() ? Number(next) : 0;
            state.dirty = true;
          }, { label: "Versi skema", type: "number" }),
          input(titleParts.id, (next) => {
            const parts = localizeParts(profile.title);
            parts.id = next;
            profile.title = parts.id === parts.en ? parts.id : parts;
            state.dirty = true;
          }, { label: "Nama preset (Indonesia)" }),
          input(titleParts.en, (next) => {
            const parts = localizeParts(profile.title);
            parts.en = next;
            profile.title = parts.id === parts.en ? parts.id : parts;
            state.dirty = true;
          }, { label: "Preset name (English)" }),
          input(profile.consumer, (next) => {
            profile.consumer = next.trim();
            state.dirty = true;
          }, { label: "Consumer / alat", placeholder: "nama-konsumen" }),
          input(profile.schema_id, (next) => {
            profile.schema_id = next.trim();
            state.dirty = true;
          }, { label: "Schema ID", mono: true, placeholder: "consumer-schema/v1" }),
        ]),
      ]),
      el("p", {
        class: "muted small",
        text: "Perubahan schema harus menaikkan versi profil. Pastikan public key cocok dengan decoder penerima sebelum menerbitkan.",
      }),
      el("p", {
        class: "muted small",
        text: "Kolom dengan kunci payload masuk ke token; tanpa kunci payload hanya tampil di formulir.",
      }),
      el("div", { class: "actions actions-row" }, [
        button(
          "Tambah kolom",
          () => {
            const used = new Set(profile.fields.map((item) => item.key));
            let key = "kolom_baru";
            let n = 2;
            while (used.has(key)) key = "kolom_baru_" + n++;
            profile.fields.push({
              key,
              type: "text",
              label: { id: "Kolom baru", en: "New field" },
              required: false,
              group: "details",
            });
            state.dirty = true;
            render();
          },
          "secondary",
        ),
      ]),
      ...profile.fields.map((field, index) => fieldEditor(profile, field, index)),
      renderDerivedEditors(profile),
    );
  }

  children.push(
    el("details", { class: "details" }, [
      el("summary", { text: "JSON mentah draf akun" }),
      el("textarea", {
        class: "input textarea mono",
        attrs: { disabled: state.busy !== "" },
        props: { value: JSON.stringify(doc, null, 2) },
        on: {
          change: (event) => {
            try {
              const parsed = JSON.parse((event.target as HTMLTextAreaElement).value) as Bundle;
              if (!parsed || !Array.isArray(parsed.profiles) || !parsed.global || !parsed.lists) {
                throw new Error("Bundle harus memiliki global, lists, dan profiles.");
              }
              state.doc = parsed;
              state.dirty = true;
              state.profileId = parsed.profiles[0]?.id ?? null;
              note("JSON diterapkan ke draf akun di layar. Tekan Simpan draf akun untuk menyimpan.", "success");
            } catch (error) {
              note("JSON tidak valid: " + (error instanceof Error ? error.message : String(error)), "error");
            }
          },
        },
      }),
    ]),
  );

  return card(
    "Preset / Profil QR",
    children,
    "Konfigurasi terisolasi untuk akun " + account.username + ". Draf kosong diperbolehkan; QR hanya bisa diterbitkan dari profil yang valid dan telah dipublikasikan.",
  );
}

async function runAdminMutation(action: () => Promise<void>, successMessage: string): Promise<void> {
  if (state.busy) return;
  state.busy = "mutation";
  state.notice = "Memproses perubahan akun…";
  state.noticeKind = "info";
  render();
  try {
    await action();
    await refresh();
    state.busy = "";
    note(successMessage, "success");
  } catch (error) {
    state.busy = "";
    note(error instanceof Error ? error.message : String(error), "error");
  }
}

function renderUsers(): HTMLElement | null {
  const users = state.loaded?.users ?? [];
  const username = el("input", { class: "input", attrs: { type: "text", autocapitalize: "none", placeholder: "petugas01", disabled: state.busy !== "" } }) as HTMLInputElement;
  const display = el("input", { class: "input", attrs: { type: "text", placeholder: "Nama tampilan", disabled: state.busy !== "" } }) as HTMLInputElement;
  const password = el("input", { class: "input", attrs: { type: "password", autocomplete: "new-password", minlength: 8, disabled: state.busy !== "" } }) as HTMLInputElement;
  const role = el("select", { class: "input", attrs: { disabled: state.busy !== "" } }, [
    el("option", { attrs: { value: "staff" }, text: "Petugas" }),
    el("option", { attrs: { value: "admin" }, text: "Admin" }),
  ]) as HTMLSelectElement;
  return card("Akun petugas", [
    el("p", { class: "muted small", text: "Buat akun dengan username dan kata sandi. Tidak perlu public key atau pairing perangkat." }),
    el("div", { class: "grid-2" }, [
      el("label", { class: "field" }, [el("span", { class: "field-label", text: "Username" }), username]),
      el("label", { class: "field" }, [el("span", { class: "field-label", text: "Nama tampilan" }), display]),
      el("label", { class: "field" }, [el("span", { class: "field-label", text: "Kata sandi (min. 8)" }), password]),
      el("label", { class: "field" }, [el("span", { class: "field-label", text: "Peran" }), role]),
    ]),
    el("div", { class: "actions actions-row" }, [button("Tambah akun", () => {
      const account = { username: username.value, displayName: display.value, password: password.value, role: role.value };
      void runAdminMutation(async () => {
        const result = await api<{ id: string }>("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({ action: "create", ...account }),
        });
        state.accountId = result.id;
        state.profileId = null;
      }, "Akun petugas dibuat.");
    }, "primary")]),
    users.length === 0 ? el("p", { class: "muted", text: "Belum ada akun." }) : el("ul", { class: "history-list" }, users.map((user) => userRow(user))),
  ], "Akun hanya mengatur akses masuk. QR dienkripsi untuk public key decoder, bukan ditandatangani per petugas.");
}

function userRow(user: UserRow): HTMLElement {
  const passwordInput = el("input", {
    class: "input",
    attrs: {
      type: "password",
      autocomplete: "new-password",
      placeholder: "kata sandi baru (min. 8)",
      disabled: state.busy !== "",
    },
  }) as HTMLInputElement;
  return el("li", { class: "history-item history-item-stack" }, [
    el("div", { class: "stack-tight" }, [
      el("span", { text: `${user.displayName ?? user.username} · ${user.role}` }),
      el("span", { class: "mono small muted", text: `${user.username} · ${user.status}` }),
    ]),
    el("label", { class: "field" }, [el("span", { class: "field-label", text: "Reset kata sandi" }), passwordInput]),
    el("div", { class: "actions actions-row" }, [
      button("Simpan sandi", () => {
        const password = passwordInput.value;
        void runAdminMutation(async () => {
          await api("/api/admin/users", {
            method: "POST",
            body: JSON.stringify({ action: "password", id: user.id, password }),
          });
        }, "Kata sandi diperbarui.");
      }, "secondary"),
      button(user.status === "active" ? "Nonaktifkan" : "Aktifkan", () => {
        void runAdminMutation(async () => {
          await api("/api/admin/users", {
            method: "POST",
            body: JSON.stringify({ action: "update", id: user.id, status: user.status === "active" ? "disabled" : "active" }),
          });
        }, "Status akun diperbarui.");
      }, user.status === "active" ? "danger" : "secondary"),
      button("Hapus", () => {
        if (!window.confirm(`Hapus akun ${user.username}?`)) return;
        void runAdminMutation(async () => {
          await api("/api/admin/users", {
            method: "POST",
            body: JSON.stringify({ action: "delete", id: user.id }),
          });
        }, "Akun petugas dihapus.");
      }, "danger"),
    ]),
  ]);
}

function renderKeys(): HTMLElement | null {
  const profile = selectedProfile();
  if (!profile) return null;
  return card("Enkripsi QR", [
    el("p", { class: "muted small", text: "Tempel public key X25519 dari ZYBTool. AITQR hanya mengenkripsi QR; private key tetap berada di komputer ZYBTool." }),
    input(profile.recipient.public, (next) => { profile.recipient.public = next.trim().toLowerCase(); state.dirty = true; }, { label: "Public key decoder (64 karakter hex)", mono: true, placeholder: "Public key dari ZYBTool" }),
    el("p", { class: "muted small", text: "Format MQ1: terenkripsi, tanpa signing key petugas dan tanpa allow-list." }),
  ]);
}

function renderPublish(): HTMLElement | null {
  const loaded = state.loaded;
  const config = selectedAccountConfig();
  const account = loaded?.users.find((item) => item.id === state.accountId);
  if (!loaded || !config || !account) return null;
  return card("Publikasi konfigurasi akun", [
    el("p", {
      class: "mono small",
      text: "Akun: " + (account.displayName ?? account.username) + " (" + account.username + ")",
    }),
    el("p", {
      class: "mono small",
      text: "Publikasi akun: urutan " + config.publishedSeq + " ? " + new Date(config.publishedAt).toLocaleString("id-ID"),
    }),
    el("p", {
      class: "muted small",
      text: "Draf terakhir: " + new Date(config.updatedAt).toLocaleString("id-ID") + " ? " + (config.updatedBy ?? "-"),
    }),
    el("p", {
      class: "muted small",
      text: state.dirty ? "Ada perubahan yang belum disimpan untuk akun ini." : "Draf akun tersimpan.",
    }),
    el("div", { class: "actions actions-row" }, [
      button("Simpan draf akun", () => void saveDraft(), "secondary"),
      button("Terbitkan untuk akun ini", () => void publish(), "primary"),
    ]),
    el("p", {
      class: "muted small",
      text: "Penerbitan hanya memperbarui form akun ini. Konfigurasi akun lain tidak berubah.",
    }),
  ]);
}

function renderAudit(): HTMLElement | null {
  const audit = state.loaded?.audit ?? [];
  return card(
    "Audit",
    audit.length === 0
      ? [el("p", { class: "muted", text: "Belum ada catatan." })]
      : [
          el(
            "ul",
            { class: "history-list" },
            audit.map((row) =>
              el("li", { class: "history-item" }, [
                el("span", { class: "mono small", text: new Date(row.at).toLocaleString("id-ID") }),
                el("span", { class: "small", text: `${row.action}${row.detail ? ` · ${row.detail}` : ""}` }),
              ]),
            ),
          ),
        ],
  );
}

// ---------------------------------------------------------------- actions

async function saveDraft(): Promise<void> {
  if (!state.doc || !state.accountId || state.busy) return;
  const accountId = state.accountId;
  const snapshot = JSON.parse(JSON.stringify(state.doc)) as Bundle;
  state.busy = "save";
  state.notice = "Menyimpan draf akun…";
  state.noticeKind = "info";
  render();
  try {
    await api("/api/admin/account-config", {
      method: "PUT",
      body: JSON.stringify({ accountId, source: JSON.stringify(snapshot, null, 2) }),
    });
    await load();
    state.busy = "";
    note("Draf konfigurasi tersimpan khusus untuk akun ini.", "success");
  } catch (error) {
    state.busy = "";
    note(error instanceof Error ? error.message : String(error), "error");
  }
}

async function publish(): Promise<void> {
  if (state.busy) return;
  const accountId = state.accountId;
  const account = state.loaded?.users.find((item) => item.id === accountId);
  if (!accountId || !account) return;
  if (state.dirty) {
    note("Simpan draf akun terlebih dahulu sebelum menerbitkan.", "info");
    return;
  }
  if (!window.confirm("Terbitkan konfigurasi untuk akun " + account.username + " saja? Akun lain tidak akan berubah.")) return;
  state.busy = "publish";
  state.notice = "Menerbitkan konfigurasi akun…";
  state.noticeKind = "info";
  render();
  try {
    const result = await api<{ seq: number; kid: string }>("/api/admin/account-config/publish", {
      method: "POST",
      body: JSON.stringify({ accountId }),
    });
    await load();
    state.busy = "";
    note("Konfigurasi " + account.username + " terbit pada urutan " + result.seq + " (kid " + result.kid + ").", "success");
  } catch (error) {
    state.busy = "";
    note(error instanceof Error ? error.message : String(error), "error");
  }
}

async function logout(): Promise<void> {
  await api("/api/logout", { method: "POST", body: "{}" }).catch(() => undefined);
  state.session = null;
  state.loaded = null;
  state.doc = null;
  await load();
}

// ---------------------------------------------------------------- render

function render(): void {
  renderHeader();
  const main = root();
  if (!state.session) {
    replace(main, el("div", { class: "stack" }, [
      state.notice ? el("div", {
        class: `admin-toast admin-toast-${state.noticeKind}`,
        attrs: { role: state.noticeKind === "error" ? "alert" : "status", "aria-live": state.noticeKind === "error" ? "assertive" : "polite" },
      }, [el("span", { text: state.notice })]) : null,
      el("p", { class: "muted", text: "Memuat…" }),
    ]));
    return;
  }
  if (!state.session.signedIn) {
    replace(main, state.health && state.health.admins === 0 ? renderBootstrap() : renderLogin());
    return;
  }
  if (state.session.user?.role !== "admin") {
    replace(main, renderForbidden());
    return;
  }
  if (!state.loaded || !state.doc) {
    replace(main, el("p", { class: "muted", text: "Memuat konfigurasi…" }));
    return;
  }

  replace(
    main,
    el("div", { class: "stack" }, [
      state.notice
        ? el("div", {
            class: `admin-toast admin-toast-${state.noticeKind}`,
            attrs: {
              role: state.noticeKind === "error" ? "alert" : "status",
              "aria-live": state.noticeKind === "error" ? "assertive" : "polite",
              "aria-atomic": "true",
            },
          }, [
            el("span", { text: state.notice }),
            el("button", {
              class: "link-button",
              attrs: { type: "button", "aria-label": "Tutup notifikasi" },
              text: "×",
              on: { click: () => { state.notice = null; render(); } },
            }),
          ])
        : null,
      el("div", { class: "page-head" }, [
        el("h1", { class: "page-title", text: "Pengaturan AITQR" }),
        el("p", { class: "muted small", text: `Masuk sebagai ${state.session.user?.username ?? "-"} · ${state.session.user?.role ?? ""}` }),
      ]),
      el("nav", { class: "admin-tabs", attrs: { "aria-label": "Pengaturan AITQR" } }, [
        ...([ ["qr", "QR & Profil"], ["users", "Akun Petugas"], ["audit", "Aktivitas"] ] as const).map(([id, label]) =>
          el("button", { class: `admin-tab${state.activeTab === id ? " active" : ""}`, attrs: { type: "button", "aria-pressed": String(state.activeTab === id), disabled: state.busy !== "" }, text: label, on: { click: () => { state.activeTab = id; render(); } } }),
        ),
      ]),
      ...(state.activeTab === "qr" ? [renderFields(), renderKeys(), renderPublish()] : state.activeTab === "users" ? [renderUsers()] : [renderAudit()]),
      el("div", { class: "actions actions-stack" }, [button("Keluar", () => void logout(), "secondary")]),
    ]),
  );
}

async function load(): Promise<void> {
  const [session, health] = await Promise.all([
    api<AdminSession>("/api/session"),
    api<Health>("/api/health"),
  ]);
  state.session = session;
  state.health = health;
  if (session.signedIn && session.user?.role === "admin") {
    state.loaded = await api<AdminState>("/api/admin/state");
    const accountIds = state.loaded.accountConfigs.map((config) => config.userId);
    if (!state.accountId || !accountIds.includes(state.accountId)) {
      state.accountId = state.loaded.users[0]?.id ?? null;
    }
    loadSelectedAccountDraft();
  } else {
    state.loaded = null;
    state.doc = null;
  }
  render();
}

export function startAdmin(): void {
  load().catch((error: unknown) => {
    note(error instanceof Error ? error.message : String(error), "error");
  });
}

startAdmin();
