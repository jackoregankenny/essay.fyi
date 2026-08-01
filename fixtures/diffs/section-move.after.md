# Migrating the Reporting Pipeline

## Summary

The current pipeline runs nightly and fails roughly once a week. This document
proposes replacing it in three stages.

## Background

The pipeline was written in 2021 against a data model that has since changed
twice. Most failures trace to assumptions in the extraction stage that were
true then and are not true now.

## Proposed stages

Stage one replaces extraction only, leaving transformation and loading intact.
Stage two replaces transformation. Stage three retires the old scheduler.

## Risks

Migration risk concentrates in the cutover. Running both pipelines in parallel
for a full billing cycle is the mitigation, at the cost of a month of duplicated
compute.

## Cost

Two engineers for six weeks, plus one month of duplicated compute during the
parallel run.

## Decision requested

Approval to begin stage one in the next planning cycle.
