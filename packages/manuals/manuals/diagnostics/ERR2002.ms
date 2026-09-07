# ERR2002 — Bundle entry artifact is missing

## Problem

Bun emitted no entry module for the requested MarkScript bundle.

## Fix

Retry with a supported Bun version. If the failure repeats, report it with the
entry path, the Bun and MarkScript versions, and any preceding Bun diagnostics.
