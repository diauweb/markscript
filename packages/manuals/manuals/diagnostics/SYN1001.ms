# SYN1001 — MarkScript parsing failed

## Problem

The parser failed to form a MarkScript document from the Markdown, TypeScript,
TSX, or embedded expression at the reported location.

## Fix

Correct the reported source syntax first. Check delimiters around expressions,
JSX tags and attributes, and TypeScript module statements near the location.
