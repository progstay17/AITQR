#!/usr/bin/env python3
"""Cross-language check: decode and verify AITQR tokens with the reference Python decoder.

    python3 scripts/verify-with-python.py vectors/aitqr-vectors.json keys/decoder-test/private.hex

Needs the reference library: `pip install -e <path-to-Metaqr>` (or `pip install metaqr`).
Exit code 0 only when every vector decrypts, matches its payload byte-for-byte as JSON, and passes
signature + allow-list verification.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import metaqr


def main() -> int:
    vectors_path = Path(sys.argv[1] if len(sys.argv) > 1 else "vectors/aitqr-vectors.json")
    private_path = Path(sys.argv[2] if len(sys.argv) > 2 else "keys/decoder-test/private.hex")

    vectors = json.loads(vectors_path.read_text())["vectors"]
    private_key = private_path.read_text().splitlines()[-1].strip()

    failures = 0
    for vector in vectors:
        label = f"{vector['profile']} v{vector['profileVersion']}"
        token = vector["token"]
        allowlist = {
            "format": "metaqr-allowlist",
            "version": 1,
            "devices": [
                {
                    "id": "aitqr-test-device",
                    "public_key": vector["devicePublic"],
                    "label": "AITQR test vector",
                    "status": "active",
                }
            ],
        }
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump(allowlist, handle)
            allowlist_path = handle.name

        try:
            allow = metaqr.Allowlist.load(allowlist_path)
            result = metaqr.verify(token, private_key, allow)
            metadata = result.metadata
            ok_payload = metadata == vector["payload"]
            ok_device = result.device.id == "aitqr-test-device"
            ok_version = token.startswith("MQ2:")
            if ok_payload and ok_device and ok_version:
                print(f"OK   {label}: verified, {len(token)} chars, device={result.device.id}")
            else:
                failures += 1
                print(f"FAIL {label}: payload={ok_payload} device={ok_device} mq2={ok_version}")
                print(f"     expected {vector['payload']}")
                print(f"     got      {metadata}")
        except Exception as error:  # noqa: BLE001 - report the decoder's own error
            failures += 1
            print(f"FAIL {label}: {type(error).__name__}: {error}")
        finally:
            Path(allowlist_path).unlink(missing_ok=True)

    print(f"{len(vectors) - failures}/{len(vectors)} vectors verified")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
