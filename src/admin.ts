/**
 * Admin console: accounts (username, password, public key), metadata fields, keys and publication.
 * AITQR never generates account keys — the administrator only stores each account's public key.
 */
import { el, replace } from "./dom.js";
import { FIELD_TYPES } from "./profile.js";
import type { Bundle, FieldDef, Localized, Profile } from "./types.js";

interface AdminSession {
  signedIn: boolean;
  user: { username: string; displayName: string | null; role: string; publicKey: string | null } | null;
}

interface Health {
  admins: number;
  users: number;
  publishedSeq: number | null;
  configured: { adminKey: boolean; sessionKey: boolean; decoderSecret: boolean };
}

interface UserRow {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
  publicKey: string | null;
  kid: string | null;
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
  keys: { adminKeyConfigured: boolean; decoderSecretConfigured: boolean };
}

interface VerifyResult {
  ok: boolean;
  code?: string | null;
  kid?: string;
  account?: { username: string; label: string | null; status: string };
  issuedAt?: number;
  compressed?: boolean;
  metadata?: Record<string, unknown>;
  error?: string;
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
  loginError: string | null;
  verify: VerifyResult | null;
}

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
  loginError: null,
  verify: null,
};

let secretBuffer = "";
let tokenBuffer = "";

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

function note(message: string | null): void {
  state.notice = message;
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
  options: { type?: string; placeholder?: string; label?: string; mono?: boolean; readonly?: boolean } = {},
): HTMLElement {
  const control = el("input", {
    class: `input${options.mono ? " mono" : ""}`,
    attrs: {
      type: options.type ?? "text",
      placeholder: options.placeholder,
      readonly: options.readonly,
      autocomplete: "off",
      spellcheck: "false",
    },
    props: { value },
    on: { input: (event) => onChange((event.target as HTMLInputElement).value) },
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
  const parts = localizeParts(field.label);
  const listName = field.list ?? "";
  const options = listName && state.doc?.lists[listName] ? state.doc.lists[listName] : [];
  const markDirty = (): void => {
    state.dirty = true;
  };

  return el("div", { class: "field-editor" }, [
    el("div", { class: "field-editor-head" }, [
      el("span", { class: "tag mono", text: field.key || "(tanpa kunci)" }),
      el("div", { class: "actions actions-row" }, [
        button(
          "Hapus",
          () => {
            profile.fields.splice(index, 1);
            state.dirty = true;
            render();
          },
          "danger",
        ),
      ]),
    ]),
    el("div", { class: "grid-2" }, [
      input(field.key, (next) => {
        field.key = next.trim();
        markDirty();
      }, { label: "Kunci field", mono: true, placeholder: "recorder" }),
      el("label", { class: "field" }, [
        el("span", { class: "field-label", text: "Tipe" }),
        el(
          "select",
          {
            class: "input",
            on: {
              change: (event) => {
                field.type = (event.target as HTMLSelectElement).value as FieldDef["type"];
                markDirty();
                render();
              },
            },
          },
          FIELD_TYPES.map((type) => el("option", { attrs: { value: type, selected: field.type === type }, text: type })),
        ),
      ]),
      input(parts.id, (next) => {
        setLocalized(field, { ...localizeParts(field.label), id: next });
        markDirty();
      }, { label: "Label (Indonesia)" }),
      input(parts.en, (next) => {
        setLocalized(field, { ...localizeParts(field.label), en: next });
        markDirty();
      }, { label: "Label (English)" }),
      input(field.short ?? "", (next) => {
        field.short = next.trim() || undefined;
        markDirty();
      }, { label: "Kunci payload (short)", mono: true, placeholder: "r" }),
      input(field.group ?? "details", (next) => {
        field.group = next.trim() || "details";
        markDirty();
      }, { label: "Grup form" }),
      input(field.max === undefined ? "" : String(field.max), (next) => {
        field.max = next ? Number(next) : undefined;
        markDirty();
      }, { label: "Maks panjang", type: "number" }),
      input(field.pattern ?? "", (next) => {
        field.pattern = next.trim() || undefined;
        markDirty();
      }, { label: "Pola (regex)", mono: true }),
      field.type === "select"
        ? input(listName || field.key, (next) => {
            field.list = next.trim() || undefined;
            markDirty();
          }, { label: "Nama daftar opsi", mono: true })
        : null,
      el("label", { class: "field field-inline" }, [
        el("input", {
          class: "checkbox",
          attrs: { type: "checkbox", checked: field.required === true },
          on: {
            change: (event) => {
              field.required = (event.target as HTMLInputElement).checked;
              markDirty();
            },
          },
        }),
        el("span", { text: "Wajib diisi" }),
      ]),
    ]),
    field.type === "select"
      ? el("label", { class: "field" }, [
          el("span", { class: "field-label", text: "Opsi (pisahkan dengan koma)" }),
          el("textarea", {
            class: "input textarea",
            props: { value: options.map(String).join(", ") },
            on: {
              input: (event) => {
                const doc = state.doc;
                if (!doc) return;
                const name = field.list ?? field.key;
                field.list = name;
                doc.lists[name] = (event.target as HTMLTextAreaElement).value
                  .split(",")
                  .map((part) => part.trim())
                  .filter((part) => part !== "");
                markDirty();
              },
            },
          }),
        ])
      : null,
  ]);
}

function renderFields(): HTMLElement | null {
  const doc = state.doc;
  const account = state.loaded?.users.find((item) => item.id === state.accountId);
  const accountConfig = selectedAccountConfig();
  if (!doc || !account || !accountConfig) {
    return card("Kolom metadata per akun", [
      el("p", { class: "muted", text: "Pilih atau buat akun untuk mengatur field secara terpisah." }),
    ]);
  }
  const profile = selectedProfile();
  if (!profile) {
    return card("Kolom metadata per akun", [el("p", { class: "muted", text: "Draf akun belum memiliki profil." })]);
  }

  const accountSelector = el(
    "select",
    {
      class: "input",
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
        text: (item.displayName ?? item.username) + " ? " + item.username + " ? " + item.role + " ? " + item.status,
      }),
    ),
  );

  const profileSelector = el(
    "select",
    {
      class: "input",
      props: { value: profile.id },
      on: {
        change: (event) => {
          state.profileId = (event.target as HTMLSelectElement).value;
          render();
        },
      },
    },
    doc.profiles.map((item) =>
      el("option", { attrs: { value: item.id, selected: item.id === profile.id }, text: item.id + " v" + item.version }),
    ),
  );

  return card(
    "Kolom metadata per akun",
    [
      el("p", {
        class: "muted small",
        text: "Field, daftar opsi, profil, dan kunci penerima di bawah ini hanya berlaku untuk akun " +
          (account.displayName ?? account.username) + ". Setiap akun memiliki draf dan publikasi terpisah.",
      }),
      el("label", { class: "field" }, [
        el("span", { class: "field-label", text: "Akun yang dikonfigurasi" }),
        accountSelector,
      ]),
      el("div", { class: "actions actions-row" }, [
        profileSelector,
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
      el("p", {
        class: "muted small",
        text: "Kolom dengan kunci payload masuk ke token; tanpa kunci payload hanya tampil di formulir.",
      }),
      ...profile.fields.map((field, index) => fieldEditor(profile, field, index)),
      el("details", { class: "details" }, [
        el("summary", { text: "JSON mentah draf akun" }),
        el("textarea", {
          class: "input textarea mono",
          props: { value: JSON.stringify(doc, null, 2) },
          on: {
            change: (event) => {
              try {
                const parsed = JSON.parse((event.target as HTMLTextAreaElement).value) as Bundle;
                state.doc = parsed;
                state.dirty = true;
                state.profileId = parsed.profiles[0]?.id ?? null;
                note("JSON diterapkan ke draf akun di layar. Tekan Simpan draf akun untuk menyimpan.");
              } catch {
                note("JSON tidak valid");
              }
            },
          },
        }),
      ]),
    ],
    "Konfigurasi terisolasi untuk akun " + account.username + ". Perubahan di sini tidak mengubah akun lain.",
  );
}

function renderUsers(): HTMLElement | null {
  const users = state.loaded?.users ?? [];
  const username = el("input", {
    class: "input",
    attrs: { type: "text", autocapitalize: "none", placeholder: "petugas01" },
  }) as HTMLInputElement;
  const display = el("input", { class: "input", attrs: { type: "text", placeholder: "Nama tampilan" } }) as HTMLInputElement;
  const password = el("input", {
    class: "input",
    attrs: { type: "password", autocomplete: "new-password", minlength: 8 },
  }) as HTMLInputElement;
  const publicKey = el("input", {
    class: "input mono",
    attrs: { type: "text", placeholder: "64 hex Ed25519", spellcheck: "false" },
  }) as HTMLInputElement;
  const role = el(
    "select",
    { class: "input" },
    [el("option", { attrs: { value: "staff" }, text: "staff" }), el("option", { attrs: { value: "admin" }, text: "admin" })],
  ) as HTMLSelectElement;

  return card(
    "Akun",
    [
      el("p", {
        class: "muted small",
        text: "Buat username + kata sandi, lalu tempel public key akun (Ed25519). Aplikasi tidak membuat kunci.",
      }),
      el("div", { class: "grid-2" }, [
        el("label", { class: "field" }, [el("span", { class: "field-label", text: "Username" }), username]),
        el("label", { class: "field" }, [el("span", { class: "field-label", text: "Nama tampilan" }), display]),
        el("label", { class: "field" }, [el("span", { class: "field-label", text: "Kata sandi (min. 8)" }), password]),
        el("label", { class: "field" }, [el("span", { class: "field-label", text: "Public key" }), publicKey]),
        el("label", { class: "field" }, [el("span", { class: "field-label", text: "Peran" }), role]),
      ]),
      el("div", { class: "actions actions-row" }, [
        button(
          "Tambah akun",
          () => {
            void api<{ id: string }>("/api/admin/users", {
              method: "POST",
              body: JSON.stringify({
                action: "create",
                username: username.value,
                displayName: display.value,
                password: password.value,
                publicKey: publicKey.value,
                role: role.value,
              }),
            })
              .then((result) => {
                state.accountId = result.id;
                state.profileId = null;
                return refresh().then(() => note("Akun dibuat dengan konfigurasi field miliknya sendiri."));
              })
              .catch((error: unknown) => note(error instanceof Error ? error.message : String(error)));
          },
          "primary",
        ),
        el("a", { class: "button button-secondary", attrs: { href: "/api/admin/allowlist" }, text: "Unduh allowlist.json" }),
      ]),
      users.length === 0
        ? el("p", { class: "muted", text: "Belum ada akun." })
        : el(
            "ul",
            { class: "history-list" },
            users.map((user) => userRow(user)),
          ),
    ],
    "Setiap akun punya satu kunci tanda tangan; public key-nya dipakai decoder untuk memeriksa QR.",
  );
}

function userRow(user: UserRow): HTMLElement {
  const keyInput = el("input", {
    class: "input mono",
    attrs: { type: "text", placeholder: "64 hex Ed25519", spellcheck: "false" },
    props: { value: user.publicKey ?? "" },
  }) as HTMLInputElement;
  const passwordInput = el("input", {
    class: "input",
    attrs: { type: "password", autocomplete: "new-password", placeholder: "kata sandi baru (min. 8)" },
  }) as HTMLInputElement;

  return el("li", { class: "history-item history-item-stack" }, [
    el("div", { class: "stack-tight" }, [
      el("span", { text: `${user.displayName ?? user.username} · ${user.role}` }),
      el("span", { class: "mono small muted", text: `${user.username} · ${user.status}${user.kid ? ` · kid ${user.kid}` : ""}` }),
    ]),
    el("div", { class: "grid-2" }, [
      el("label", { class: "field" }, [el("span", { class: "field-label", text: "Public key" }), keyInput]),
      el("label", { class: "field" }, [el("span", { class: "field-label", text: "Reset kata sandi" }), passwordInput]),
    ]),
    el("div", { class: "actions actions-row" }, [
      button(
        "Simpan kunci",
        () => {
          void api("/api/admin/users", {
            method: "POST",
            body: JSON.stringify({ action: "update", id: user.id, publicKey: keyInput.value }),
          })
            .then(() => refresh().then(() => note("Public key diperbarui.")))
            .catch((error: unknown) => note(error instanceof Error ? error.message : String(error)));
        },
        "primary",
      ),
      button(
        "Simpan sandi",
        () => {
          void api("/api/admin/users", {
            method: "POST",
            body: JSON.stringify({ action: "password", id: user.id, password: passwordInput.value }),
          })
            .then(() => refresh().then(() => note("Kata sandi diperbarui.")))
            .catch((error: unknown) => note(error instanceof Error ? error.message : String(error)));
        },
        "secondary",
      ),
      button(
        user.status === "active" ? "Nonaktifkan" : "Aktifkan",
        () => {
          void api("/api/admin/users", {
            method: "POST",
            body: JSON.stringify({ action: "update", id: user.id, status: user.status === "active" ? "disabled" : "active" }),
          })
            .then(() => refresh().then(() => note("Status diperbarui.")))
            .catch((error: unknown) => note(error instanceof Error ? error.message : String(error)));
        },
        user.status === "active" ? "danger" : "secondary",
      ),
      button(
        "Hapus",
        () => {
          if (!window.confirm(`Hapus akun ${user.username}?`)) return;
          void api("/api/admin/users", { method: "POST", body: JSON.stringify({ action: "delete", id: user.id }) })
            .then(() => refresh().then(() => note("Akun dihapus.")))
            .catch((error: unknown) => note(error instanceof Error ? error.message : String(error)));
        },
        "danger",
      ),
    ]),
  ]);
}

function renderKeys(): HTMLElement | null {
  const doc = state.doc;
  const profile = selectedProfile();
  if (!doc) return null;
  const keys = state.loaded?.keys;

  return card(
    "Kunci",
    [
      el("p", {
        class: "muted small",
        text: "Public key penerima dipakai untuk mengenkripsi QR. Kunci rahasia hanya disimpan di server untuk memverifikasi token.",
      }),
      profile
        ? el("div", { class: "grid-2" }, [
            input(profile.recipient.kid, (next) => {
              profile.recipient.kid = next.trim();
              state.dirty = true;
            }, { label: "Kid penerima (decoder)", mono: true }),
            input(profile.recipient.public, (next) => {
              profile.recipient.public = next.trim();
              state.dirty = true;
            }, { label: "Public key penerima (X25519, hex/base64url)", mono: true }),
          ])
        : null,
      el("p", {
        class: "muted small mono",
        text: `Kunci admin bundel: ${keys?.adminKeyConfigured ? "terpasang" : "belum"} · kunci rahasia decoder: ${
          keys?.decoderSecretConfigured ? "tersimpan" : "belum"
        }`,
      }),
      el("hr", { class: "rule" }),
      el("h3", { class: "card-subtitle", text: "Kunci rahasia decoder" }),
      el("div", { class: "actions actions-row" }, [
        input("", (next) => {
          secretBuffer = next.trim();
        }, { label: "Kunci rahasia decoder (64 hex)", type: "password", mono: true }),
        button("Simpan", () => void saveDecoderSecret(), "primary"),
        button(
          "Hapus",
          () => {
            secretBuffer = "";
            void saveDecoderSecret();
          },
          "danger",
        ),
      ]),
      el("hr", { class: "rule" }),
      el("h3", { class: "card-subtitle", text: "Verifikasi token" }),
      el("label", { class: "field" }, [
        el("span", { class: "field-label", text: "Tempel token MQ2" }),
        el("textarea", {
          class: "input textarea mono",
          attrs: { placeholder: "MQ2:…" },
          on: { input: (event) => (tokenBuffer = (event.target as HTMLTextAreaElement).value.trim()) },
        }),
      ]),
      button("Verifikasi", () => void verifyToken(), "secondary"),
      state.verify ? renderVerifyResult(state.verify) : null,
    ],
    "Public key dan secret key decoder dikelola di sini, bukan di perangkat petugas.",
  );
}

function renderVerifyResult(result: VerifyResult): HTMLElement {
  return el("div", { class: `notice ${result.ok ? "notice-info" : "notice-warn"}` }, [
    el("p", {
      class: "mono small",
      text: result.ok
        ? `Sah · akun ${result.account?.label ?? result.account?.username ?? "-"} · kid ${result.kid}`
        : `Tidak sah · ${result.code ?? result.error ?? "gagal"}`,
    }),
    result.ok ? el("pre", { class: "code-block", text: JSON.stringify(result.metadata, null, 2) }) : null,
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

async function saveDecoderSecret(): Promise<void> {
  try {
    await api("/api/admin/keys", { method: "POST", body: JSON.stringify({ decoderSecret: secretBuffer }) });
    secretBuffer = "";
    await load();
    note("Kunci rahasia decoder diperbarui.");
  } catch (error) {
    note(error instanceof Error ? error.message : String(error));
  }
}

async function verifyToken(): Promise<void> {
  try {
    state.verify = await api<VerifyResult>("/api/admin/verify", {
      method: "POST",
      body: JSON.stringify({ token: tokenBuffer }),
    });
    render();
  } catch (error) {
    note(error instanceof Error ? error.message : String(error));
  }
}

async function saveDraft(): Promise<void> {
  if (!state.doc || !state.accountId) return;
  try {
    await api("/api/admin/account-config", {
      method: "PUT",
      body: JSON.stringify({ accountId: state.accountId, source: JSON.stringify(state.doc, null, 2) }),
    });
    state.dirty = false;
    await load();
    note("Draf field tersimpan khusus untuk akun ini.");
  } catch (error) {
    note(error instanceof Error ? error.message : String(error));
  }
}

async function publish(): Promise<void> {
  const account = state.loaded?.users.find((item) => item.id === state.accountId);
  if (!state.accountId || !account) return;
  if (state.dirty) {
    note("Simpan draf akun terlebih dahulu sebelum menerbitkan.");
    return;
  }
  if (!window.confirm("Terbitkan konfigurasi untuk akun " + account.username + " saja? Akun lain tidak akan berubah.")) return;
  try {
    const result = await api<{ seq: number; kid: string }>("/api/admin/account-config/publish", {
      method: "POST",
      body: JSON.stringify({ accountId: state.accountId }),
    });
    await load();
    note("Konfigurasi " + account.username + " terbit pada urutan " + result.seq + " (kid " + result.kid + ").");
  } catch (error) {
    note(error instanceof Error ? error.message : String(error));
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
    replace(main, el("p", { class: "muted", text: "Memuat…" }));
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
        ? el("div", { class: "notice", attrs: { role: "status" } }, [
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
          ])
        : null,
      el("div", { class: "page-head" }, [
        el("h1", { class: "page-title", text: "Konsol admin" }),
        el("p", { class: "muted small", text: `Masuk sebagai ${state.session.user?.username ?? "-"} · ${state.session.user?.role ?? ""}` }),
      ]),
      renderFields(),
      renderUsers(),
      renderKeys(),
      renderPublish(),
      renderAudit(),
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
    note(error instanceof Error ? error.message : String(error));
  });
}

startAdmin();
