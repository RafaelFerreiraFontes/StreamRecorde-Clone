---
name: streamrecorder-docker-validation
description: Plan and run isolated container validation for StreamRecorder Dockerfile, Compose, mounts, volumes, healthchecks, UID/GID, Docker Desktop/WSL2, PostgreSQL containers, or API/Worker smoke changes while preserving the normal stack and data.
---

# Docker validation

## Purpose and use

Verify container integration with explicit test-resource ownership. Use for container behavior and smoke execution, rather than a general code readiness review.

## Read first

- [Development guide](../../../README.md), [Compose](../../../compose.yml), relevant component Dockerfile/README, and the concrete task.
- [Smoke harness](../../../scripts/docker-integration-smoke.mjs), [fixture override](../../../scripts/docker-smoke/compose.worker-fixture.yml), and [fake Streamlink](../../../scripts/docker-smoke/streamlink-fixture.py) before executing smoke.
- [Project instructions](../../../.github/instructions/project.instructions.md); current persistence decisions and task for PostgreSQL tests.

## Procedure

1. Inventory the normal stack's project/container IDs, state, ports, mounts, and volume names without dumping private data. Resolve image tags and overrides from current files; historical runbook tags are not executable truth.
2. Select a unique disposable project and storage/ports or the existing isolation harness. Detect resource/image-tag collisions before build/start. Avoid rebuilding a shared tag that a normal-stack recreation would consume without an explicit isolation plan.
3. Run `docker compose config --quiet` from the root for syntax. Inspect the resolved test configuration using the exact project/override arguments the test will use, redacting sensitive values. Verify physical mount sources, named-volume identities, fixture bindings, and absence of normal user storage before any mutating test.
4. Confirm runtime mount access, not just Dockerfile ownership. Check read-only API recording access, Worker write/create/rename access for atomic persistence, frontend isolation, and UID/GID where relevant. Docker Desktop/WSL2 sharing and Windows ACLs can change effective permissions; test inside the container rather than assuming `chown` proves access.
5. Separate image/dependency/network preparation from deterministic runtime checks. Use fake Streamlink for API/Worker integration. Run root `pnpm test:smoke` only after verifying its current isolation and cleanup logic; PostgreSQL checks also need a verified disposable connection/volume.
6. Check health/readiness, state propagation, failure/recovery, restart persistence, and process shutdown required by the task. Container running, HTTP healthy, successful probe, completed capture, and playable media are different evidence levels.
7. Clean up only exact test-owned resources after checking project identity and ownership labels/paths. Record created, removed, and retained resources; compare the normal stack and storage to the initial inventory.

## Safety / invariants

Never run `docker compose down -v` against the normal stack or user volumes. No broad prune, wildcard cleanup, root-service workaround, or permission weakening to hide failures. If isolation or ownership cannot be verified, stop before mutation. Interrupted cleanup must report retained resources, not widen deletion scope.

## Validation and expected result

Return resolved test identity, collision/mount/access checks, setup versus runtime results, exact commands, cleanup ownership/outcome, and normal-stack preservation evidence. Pair with Worker lifecycle or persistence procedures for their behavioral assertions; fake media never proves playable MP4.
