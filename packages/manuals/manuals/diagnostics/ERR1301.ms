# ERR1301 — Lifecycle API is used outside its valid phase

## Problem

This code reports one of these lifecycle API errors:

- `onTransform`, `onReady`, or `executeDocument` received another value type.
- `onTransform` or `onReady` was called outside an active document render.
- `onTransform` or `onReady` was called during the transform, ready, or closed phase
  of a document lifetime.

## Fix

Pass a function to each lifecycle API. Register `onTransform` and `onReady`
callbacks while the document body is rendering, before the transform phase
starts. Move registrations out of transform and ready callbacks.
