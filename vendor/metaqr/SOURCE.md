# Vendored: metaqr JavaScript encoder

- Upstream: https://github.com/progstay17/Metaqr
- Commit: baae37471201b3ae3477d0cf0dcb8ffd26e4dc76 ("metaqr 0.4.0")
- License: MIT (see LICENSE in this directory)
- Copied verbatim: js/src/*.js and js/src/index.d.ts. Do not edit these files.
- AITQR added type declarations only (`src/crypto.d.ts`, `src/signing.d.ts`, `src/payload.d.ts`,
  `src/keys.d.ts`) so direct module imports type-check. No JavaScript was changed.
- Reason: AITQR does not implement cryptography itself (AGENTS.md §4). src/mq2.ts is the only adapter.
