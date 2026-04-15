---
"@aretw0/pi-stack": patch
---

Fix cross-platform handling of Windows-style paths in colony runtime mirror detection.

This prevents smoke test failures on Linux CI when validating Windows path normalization.
