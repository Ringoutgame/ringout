# CLAUDE.md

## Project Overview

RingOut is a polished, competitive browser game that should feel fast, fair, visually refined, and technically reliable. Every contribution should improve gameplay quality, code maintainability, performance, and long-term scalability.

This document defines the standards for contributors, maintainers, and AI-assisted development work.

---

## Core Principles

- Prioritize clarity over cleverness.
- Write code that is easy to read, test, and extend.
- Favor deterministic, predictable behavior over fragile shortcuts.
- Optimize for maintainability first, then performance where it matters.
- Keep the player experience smooth, responsive, and visually consistent.
- Treat architecture as a long-term investment, not a temporary patch.

---

## Coding Standards

### General

- Use clear, intentional naming.
- Keep functions small and focused on a single responsibility.
- Prefer composition over duplication.
- Avoid magic numbers and hard-coded values when a shared constant is better.
- Remove dead code, unused imports, and temporary debugging artifacts before finishing work.
- Write code that can be understood by a new contributor within minutes.

### Style

- Follow the existing project style consistently.
- Use formatting tools and linting rules rather than manual style exceptions.
- Keep files readable and well-structured.
- Prefer explicit code over implicit behavior.
- Write comments only when they add meaning; avoid restating what the code already says.

### Type Safety

- Prefer strong typing and explicit interfaces.
- Avoid `any` unless absolutely necessary and clearly justified.
- Validate external data, API responses, and user input.
- Keep type definitions close to the code that uses them when practical.

---

## Project Architecture

RingOut should follow a modular, layered architecture that keeps gameplay logic, rendering, UI, and infrastructure separated.

### Recommended Structure

- Core engine: game loop, timing, scene lifecycle, event flow
- Gameplay systems: rules, match logic, game state, AI or competitive logic
- Presentation layer: rendering, UI components, animations, visual effects
- Infrastructure: input handling, persistence, networking, analytics, asset loading
- Shared utilities: helpers, math, data structures, configuration

### Architectural Rules

- Keep domain logic independent from rendering details.
- Avoid mixing UI concerns with gameplay rules.
- Use dependency injection or explicit wiring where it improves testability.
- Keep state changes predictable and traceable.
- Prefer small, cohesive modules over large monolithic files.

---

## Folder Structure

A clean and scalable structure for this project should look approximately like this:

```text
src/
  core/
  gameplay/
  ui/
  rendering/
  systems/
  entities/
  config/
  assets/
  utils/
  services/
  tests/
  types/
```

### Guidelines

- Put reusable logic in shared modules.
- Keep feature-specific code close to the feature it supports.
- Group related files together rather than scattering them across the codebase.
- Place tests next to the functionality they validate when practical.

---

## Naming Conventions

- Use descriptive, intention-revealing names.
- Prefer `camelCase` for variables and functions.
- Prefer `PascalCase` for classes, types, and components.
- Use `SCREAMING_SNAKE_CASE` for constants and configuration keys.
- Use domain-specific names where appropriate, not generic placeholders like `data` or `temp`.
- Keep file names consistent with the code they contain.

### Examples

- `gameState`
- `PlayerController`
- `MATCH_CONFIG`
- `renderHud()`
- `useInputHandler()`

---

## Documentation Rules

- Every significant feature, module, or subsystem should have clear documentation when needed.
- Keep documentation concise, current, and useful.
- Update docs alongside code changes.
- Document public APIs, complex gameplay rules, and non-obvious architectural decisions.
- Prefer short, practical documentation over long theoretical writing.

### Required Documentation

- README updates for user-facing changes
- Inline comments only where they clarify intent or trade-offs
- Architecture notes for major systems or refactors
- Changelog or release notes for meaningful user-facing updates

---

## Performance Guidelines

Performance matters in a browser game, especially for competitive interactions and visual polish.

- Avoid unnecessary allocations inside hot paths.
- Keep rendering work predictable and efficient.
- Minimize layout thrashing and expensive DOM operations in UI code.
- Reuse objects or structures when appropriate.
- Profile before optimizing; never optimize prematurely without evidence.
- Keep the frame budget in mind during feature development.
- Prefer lightweight, targeted updates over broad full-scene recalculations when feasible.

### Performance Checklist

- Is the logic running too often?
- Can rendering be reduced or batched?
- Is the code causing avoidable garbage collection?
- Does the feature scale well with more players, objects, or UI states?

---

## UI/UX Consistency

The game should feel intentional and premium.

- Maintain consistent spacing, typography, color usage, and interaction patterns.
- Ensure controls feel responsive and readable.
- Preserve visual hierarchy and accessibility.
- Keep motion purposeful and polished.
- Avoid inconsistent UI states, ambiguous feedback, or visual clutter.
- Treat UI polish as part of gameplay quality, not a cosmetic afterthought.

### Design Expectations

- Buttons and controls should feel clear and deliberate.
- Feedback should be immediate and understandable.
- Visual states should be consistent across screens and interactions.
- Accessibility should be considered from the start, not added later.

---

## Testing Strategy

Testing should be practical, reliable, and focused on real behavior.

### Recommended Approach

- Write unit tests for core logic and deterministic systems.
- Add integration tests for interactions between modules.
- Cover gameplay rules, state transitions, and edge cases.
- Test UI behavior where it affects player experience or critical flows.
- Prefer regression tests for bugs that are easy to reintroduce.

### Testing Principles

- Test real behavior, not implementation details.
- Keep tests readable and maintainable.
- Avoid brittle tests that depend on incidental implementation choices.
- Use mocks sparingly and only where they preserve realism.

---

## Git Workflow

- Use short, descriptive branch names.
- Keep commits focused and meaningful.
- Write clear commit messages that explain what changed and why.
- Prefer small, reviewable changes over large bundled updates.
- Rebase or squash when it improves history clarity.
- Do not leave unrelated changes in a feature branch.

### Commit Message Guidelines

- `feat: add match countdown system`
- `fix: correct collision edge case`
- `refactor: separate input handling from gameplay state`
- `perf: reduce UI update cost in HUD`

---

## Code Review Standards

Code review should protect quality, clarity, and long-term maintainability.

- Review for correctness, readability, and maintainability.
- Check whether the change fits the architecture and project direction.
- Look for hidden complexity, fragile logic, or duplicated behavior.
- Ask whether the solution is understandable to future contributors.
- Encourage refactoring when the implementation is becoming hard to follow.

### Review Expectations

- Respect the author’s intent while raising meaningful concerns.
- Focus on the change, not the person.
- Prefer constructive suggestions over blunt criticism.
- Do not approve code that introduces obvious regressions or technical debt without mitigation.

---

## Scalability and Long-Term Maintainability

RingOut should be built as a project that can grow without becoming fragile.

- Keep abstractions useful, not excessive.
- Refactor early when a module becomes too crowded or too coupled.
- Preserve separation between gameplay, UI, and infrastructure concerns.
- Make decisions that keep the codebase approachable for future contributors.
- Plan for future features, balancing immediate delivery with sustainable structure.

### Scalability Checklist

- Can the feature be extended without rewriting large parts of the system?
- Is the code easy to reason about under growth?
- Does the architecture support more content, systems, or players without major rework?
- Will future contributors be able to understand and modify the code confidently?

---

## Final Guidance

Every change should move RingOut closer to being a high-quality, competitive, and enjoyable browser game. Good engineering decisions today will make the project stronger, faster, and easier to evolve tomorrow.

---

## AI-Assisted Development Rules

These rules apply specifically to AI-assisted work on this project and complement all standards above.

### Language Policy

- **English** is used for: code, comments in code, commit messages, technical documentation, file contents, architecture notes, and internal reasoning.
- **German** is mandatory for every explanation addressed to the project owner:
  - the pre-implementation task briefing (Planning Workflow Step 5),
  - the completion summary after every finished task (Feature Completion Workflow Step 6),
  - status updates, findings, trade-off explanations, questions, and recommendations.
- Existing German-language project files (`PROJECT.md`, `TODO.md`, `ROADMAP.md`, `CHANGELOG.md`, README) keep their current language — do not translate them.
- Exception: the exact completion sentence in Feature Completion Workflow Step 11 remains verbatim in English ("Everything has been saved successfully to GitHub. You can safely close VS Code.") unless the project owner decides to change it.

### Communication Style

Owner communication is **compact and decision-oriented by default.** No long texts, no repetition, no unprompted deep technical detail.

- **During implementation:** short status lines only (e.g., "Code analysiert.", "Implementierung läuft.", "Tests werden ausgeführt.", "Dokumentation wird aktualisiert.", "Commit und Push werden vorbereitet.").
- **Task briefing (Planning Workflow Step 5) — exactly these points, each brief:**
  1. **Ziel** — what the task delivers
  2. **Warum jetzt** — place in the roadmap
  3. **Was wird geändert** — files/sections touched
  4. **Risiken** — what could break
  5. **Tests** — how success is verified
  6. **Empfehlung** — recommendation, including a one-line answer to the 100k-player commercial test
- **Completion summary (Feature Completion Workflow Step 6) — exactly these points, each brief:**
  1. Was wurde geändert?
  2. Welche Dateien wurden geändert?
  3. Welche Tests wurden durchgeführt?
  4. Doku / Commit / Push erfolgreich?
  5. Bekannte Restrisiken?
  6. Nächster empfohlener Schritt?
- Detailed technical analysis **only when the owner explicitly asks for it.**
- **Long answers start with a summary.** If a reply will exceed ~15–20 lines, it must begin with a 2–4 line summary in this format, followed by details as needed:
  ```
  Kurz gesagt:
  - …
  - …
  ```
  The summary states the recommendation/outcome so the owner can decide without reading the full text. Short replies need no extra summary.

- Before starting any task, read `PROJECT.md`, `TODO.md`, `ROADMAP.md`, and `CHANGELOG.md` to understand the current project state, open tasks, and long-term direction.
- Never rely solely on memory or prior context — always verify the current state of relevant files before making changes.

### Documentation Hygiene

- After every relevant change, automatically update:
  - `PROJECT.md` — reflect new or modified systems, file structure, or technical state
  - `TODO.md` — remove completed tasks, add newly discovered ones, adjust priorities
  - `CHANGELOG.md` — log every completed change with date and description under `[Unreleased]`
- If long-term goals or architectural direction changes, also update `ROADMAP.md`.
- Never leave documentation out of sync with the actual codebase.

### Feature Preservation

- Never delete, disable, or fundamentally alter an existing feature without explicit approval from the project owner.
- If a change risks breaking or removing existing behavior, state this clearly before proceeding and wait for confirmation.

### Planning Workflow

This workflow is the **permanent default** before implementing any non-trivial feature, fix, or refactor. Execute every step before writing a single line of code.

#### Step 1 — Analyze the request

- Read the request carefully and identify the core intent.
- Check `PROJECT.md`, `TODO.md`, and relevant source files to understand the current state of the affected systems.
- Determine whether the task is **small** (isolated change, one or two touch-points, no risk to existing behavior) or **large** (affects multiple systems, changes shared state, modifies architecture, or could break existing features).

#### Step 2 — Explain the planned approach

- State in plain language what will be built and how.
- Reference the existing systems that will be reused or extended.
- If multiple valid approaches exist, name them briefly and recommend one with a reason.
- Keep this concise — a paragraph or a short bullet list is enough.

#### Step 3 — Identify risks and edge cases

- Name anything that could go wrong: physics desync, state-machine conflicts, Firebase schema drift, rendering performance, mobile compatibility, or interactions with bot AI.
- Note any existing behavior that is adjacent to the change and could be accidentally broken.
- If a risk cannot be mitigated cleanly, say so and propose a fallback.

#### Step 4 — List files that will likely change

- Name every file (or section within `index.html`) that is expected to be modified.
- Flag any file that is touched only for a minor reason — these are candidates for scope reduction.
- If a change requires touching more than three major systems, reconsider whether the task should be broken into smaller steps.

#### Step 5 — Task briefing and approval

Before writing any code — for **every** task, regardless of size — present a **compact briefing** in the format defined under "Communication Style" (Ziel · Warum jetzt · Was wird geändert · Risiken · Tests · Empfehlung incl. the 100k-player commercial test).

Then **wait for explicit approval before writing a single line of code.** There are no exceptions for small tasks.

- The small/large classification from Step 1 still applies, but it now only controls the *depth* of the briefing points, not whether to wait. Detailed analysis (risk tables, full plans) only when the owner explicitly asks.
- Approval applies to one task only. It does not carry over to the next task, even within the same milestone.
- Pure documentation-only changes explicitly requested by the owner (e.g., "update CLAUDE.md with…") are the only exemption — they are executed directly.

---

### Architecture and Reuse Rules

- **Always prefer maintainable architecture over quick fixes.** A solution that requires a workaround today will require a larger workaround tomorrow. If the clean solution takes longer, explain the trade-off and take it anyway unless the project owner explicitly decides otherwise.
- **Never duplicate code when an existing system can be reused.** Before writing new logic, check whether the physics stepper, bot candidate generator, particle spawner, toast system, or any other existing function already solves the problem. Extend what exists; do not copy it.
- **If reuse requires a small refactor, do it.** Extracting a shared helper as part of a feature is not scope creep — it is good engineering. Note it in the plan and in the commit.

### Change Philosophy

- Prefer small, safe, incremental changes over large rewrites.
- One logical concern per change — do not bundle unrelated modifications.
- If a large change is unavoidable, break it into reviewable steps.

### Architecture Documentation

- Document important architectural decisions inline or in `PROJECT.md` when they affect how the system is structured or why a non-obvious approach was chosen.
- Record the reasoning behind decisions that future contributors might question.

### Token Efficiency

- Work concisely. Read only the files needed for the current task.
- Avoid re-reading files already established in context.
- Prefer targeted edits over full-file rewrites.
- Summarize findings rather than reproducing large code blocks verbatim.

### Technical Debt Awareness

- When encountering technical debt, suboptimal patterns, or optimization opportunities, call them out explicitly — even if they are outside the current task scope.
- Flag them as low-priority observations so the project owner can decide whether to address them now or add them to `TODO.md`.

---

### Feature Completion Workflow

This workflow is the **permanent default** for every successfully completed task, feature, fix, or refactor. Execute every step in order without skipping — **automatically, without waiting for an instruction from the project owner.** Completing the implementation is not the end of the task; the task ends only when the repository is clean and pushed (see Step 11).

If any step fails: explain the issue, fix it if possible, and continue the workflow until the repository is clean. Stop and ask only when a fix requires a decision that belongs to the project owner (e.g., removing a feature, changing protected behavior, force-pushing).

#### Step 1 — Test the implementation

- Open `index.html` in a browser and exercise the changed behavior directly.
- Cover the happy path, at least one edge case, and any interaction with existing features that could be affected.
- For online changes: verify both host and guest flows in separate tabs.
- For bot changes: test all three difficulty levels.
- Do not proceed to Step 2 if the feature does not behave correctly.

#### Step 2 — Fix any obvious issues

- If testing reveals bugs, fix them before continuing.
- A bug that is noticed and left unfixed is not acceptable — log it in `TODO.md` with a P0 or P1 priority if it cannot be fixed immediately, and note it clearly in the commit message.
- Never move to documentation or git steps while a known error exists in the changed code.

#### Step 3 — Update `TODO.md`

- Mark completed tasks as done and move their descriptions to `CHANGELOG.md`.
- Add any newly discovered tasks with the correct priority (P0–P3).
- Remove tasks that are no longer relevant.
- Update the `Zuletzt aktualisiert` date at the top of the file.

#### Step 4 — Update `CHANGELOG.md`

- Add an entry under `## [Unreleased]` with today's date and a concise description of every user-visible or developer-visible change.
- Group entries by type: `feat`, `fix`, `perf`, `refactor`, `docs`.
- Be specific: state *what* changed and *why*, not just *that* something changed.
- Example entry:
  ```
  - fix: clamp online move data (dx, dy, sp) before applying — prevents velocity injection by cheating clients (2026-07-04)
  ```

#### Step 5 — Update `PROJECT.md` if the architecture changed

- Update `PROJECT.md` whenever a new system was added, a file was restructured, a technical constant changed, or a known limitation was resolved.
- Update the `Zuletzt aktualisiert` date at the top of the file.
- Skip this step only for pure bug fixes that leave the architecture unchanged.

#### Step 6 — Explain what changed

- Before committing, give the owner the **compact completion summary** in the format defined under "Communication Style" (Was geändert · Dateien · Tests · Doku/Commit/Push · Restrisiken · Nächster Schritt).
- This summary is for the human, not the commit history. No long explanations unless explicitly requested.

#### Step 7 — Stage all modified files

- Stage every file that was changed as part of this feature: source files, documentation, and assets.
- Do not stage unrelated changes. If unrelated edits exist, stash or revert them first.
- Review `git status` and `git diff --staged` before committing to confirm only the intended changes are included.

#### Step 8 — Create a meaningful Git commit

- Use the conventional commit format:
  ```
  <type>: <short imperative summary>

  <optional body — what and why, not how>
  ```
- Valid types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `chore`.
- The subject line must be ≤ 72 characters.
- The body should explain *why* the change was made if it is not obvious from the subject.
- Never use vague messages like `update`, `fix stuff`, or `changes`.

#### Step 9 — Push to GitHub

- Push to the `main` branch (or the active feature branch) after the commit succeeds.
- Only push if:
  - All tests from Step 1 passed.
  - No known errors remain in the changed code (Step 2).
  - Documentation is synchronized (Steps 3–5).
- If any of those conditions are not met, do not push. State explicitly why the push was skipped.
- Command: `git push origin main` (or the current branch).

#### Step 10 — Verify the push succeeded

- Confirm the push actually reached GitHub — do not assume success from the absence of an error.
- Check that the local branch is in sync with the remote (e.g., `git status` reports the branch is up to date with `origin/main`, or compare `git rev-parse HEAD` with the remote head).
- If the push was rejected (remote diverged): pull and rebase, resolve conflicts, push again, and re-verify. Never use `--force` without explicit approval.

#### Step 11 — Final verification: clean working tree

- Run `git status`.
- A task is only considered **finished** when `git status` returns:
  ```
  nothing to commit, working tree clean
  ```
  and the branch is up to date with the remote.
- If uncommitted or untracked files remain that belong to the task, return to Step 7 and include them.
- If unrelated stray files remain, tell the project owner what they are instead of silently committing or deleting them.
- Only when the tree is clean and the push is verified, report completion with exactly:
  > **Everything has been saved successfully to GitHub. You can safely close VS Code.**
- Never output this sentence if any step above failed, was skipped, or is unverified.

---

### Push Policy

- **Never push code that has known errors.** If a bug was found and not yet fixed, the commit stays local until it is resolved.
- **Never push with documentation out of sync.** `TODO.md`, `CHANGELOG.md`, and `PROJECT.md` must reflect the state of the code at the time of the push.
- **Never force-push to `main`** without explicit approval from the project owner.
- If the push fails (e.g., remote has diverged), pull and rebase, resolve any conflicts, then push again. Do not use `--force` unless instructed.

---

### Workflow Quick Reference

```
1. Test           → browser test, all modes affected
2. Fix            → no known errors before continuing
3. TODO.md        → mark done, add new tasks, update date
4. CHANGELOG.md   → entry under [Unreleased] with date
5. PROJECT.md     → update only if architecture changed
   (also ROADMAP.md and other docs if direction changed)
6. Explain        → 2–5 sentence summary for the owner
7. Stage          → review git diff --staged before commit
8. Commit         → conventional format, ≤72 char subject
9. Push           → only if steps 1–2 passed and docs synced
10. Verify push   → branch up to date with origin
11. git status    → must be "nothing to commit, working
                    tree clean" → only then report:
                    "Everything has been saved successfully
                    to GitHub. You can safely close VS Code."
```

The workflow runs automatically after every completed task — the project owner never needs to ask for it.

---

## Arbeitsmodus: Minimaler Scope und feste Stop-Regel

### Grundprinzip

Bearbeite ausschließlich das, was der Nutzer ausdrücklich verlangt.

Eine kleine Änderung darf nicht selbstständig zu einer größeren Analyse-,
Refactoring-, Test-, Architektur- oder Dokumentationsaufgabe erweitert werden.

Keine zusätzlichen Verbesserungen, nur weil sie sinnvoll erscheinen könnten.
Nicht angeforderte Probleme nur kurz erwähnen, aber nicht automatisch lösen.

### Standardablauf bei Änderungen

Jede normale Aufgabe besteht standardmäßig nur aus Phase 1:

#### Phase 1 – Ändern und zeigen

1. Die konkrete Anforderung kurz prüfen.
2. Nur die minimal notwendigen Dateien und Codebereiche ändern.
3. Den kleinsten sinnvollen Smoke-Test durchführen.
4. Genau ein relevantes Vorschaufenster beziehungsweise Ergebnis öffnen.
5. Danach vollständig stoppen und auf die visuelle oder funktionale
   Freigabe des Nutzers warten.

Ohne ausdrückliche Freigabe nicht automatisch fortfahren mit:

- vollständigen Test-Suites
- zusätzlichen Regressionstests
- umfangreicher Root-Cause-Analyse
- Refactorings
- Dokumentationsänderungen
- weiteren Browserfenstern
- Commit
- Push
- Merge
- Deploy

#### Phase 2 – Finalisieren

Phase 2 beginnt nur, wenn der Nutzer ausdrücklich die finale Freigabe erteilt.

Erst dann:

1. die vereinbarten finalen Tests genau einmal ausführen
2. bei grünen Tests committen, falls ausdrücklich verlangt
3. pushen, falls ausdrücklich verlangt
4. deployen, falls ausdrücklich verlangt
5. kurz das Ergebnis berichten

Nach Beginn von Phase 2 keine zusätzlichen Verbesserungen oder Refactorings
mehr durchführen.

### Kleine UI-, CSS-, Text- und Sound-Aufgaben

Bei klaren kleinen Aufgaben:

- keine lange Voranalyse
- kein umfangreiches Pflicht-Briefing
- keine neue Testarchitektur
- keine unnötigen Screenshots
- keine mehrfachen Auflösungen oder Fenster
- keine Änderungen außerhalb des betroffenen UI-Bereichs
- nach der sichtbaren Vorschau sofort stoppen

Zielzeit: möglichst wenige Minuten statt eines vollständigen Entwicklungsruns.

### Bugfixes

Bei einem klar reproduzierbaren Bug:

1. einmal reproduzieren
2. kleinste nachweisbare Root Cause bestimmen
3. minimalen Fix umsetzen
4. gezielten Test durchführen
5. Ergebnis zeigen
6. stoppen

Keine umfassende Repro-Matrix oder neue Regression-Suite, außer:

- der Nutzer fordert sie ausdrücklich an
- der Fehler betrifft deterministische Physik, Lockstep, Firebase Rules,
  Online-Protokoll oder Datenverlust
- der kleine Test kann das Risiko objektiv nicht absichern

Ist ein Fehler nicht reproduzierbar:

- nichts auf Verdacht ändern
- kurz berichten
- stoppen

### Scope-Erweiterung

Sobald sich zeigt, dass eine Aufgabe deutlich größer wird als vom Nutzer
angefordert, vor weiteren Arbeiten stoppen und kurz erklären:

- warum der Scope größer wird
- welche zusätzliche Arbeit notwendig wäre
- ob dafür eine separate Freigabe benötigt wird

Nicht eigenständig weitermachen.

### Rückfragen

Keine Multiple-Choice-Rückfragen für Details, die aus Repository, aktuellem
Stand oder Nutzeranforderung eindeutig hervorgehen.

Nur nachfragen, wenn eine echte Blockade oder eine Entscheidung mit deutlich
unterschiedlichen Ergebnissen besteht.

### Berichte

Standardberichte kurz halten:

- was geändert wurde
- welcher kleine Test durchgeführt wurde
- Ergebnis
- geänderte Dateien
- aktueller Git-Status

Keine langen Missionsberichte, Risikoabhandlungen oder Wiederholungen der
Aufgabe, sofern nicht ausdrücklich verlangt.

### Harte Stop-Regel

Sobald das ausdrücklich verlangte sichtbare Ergebnis erreicht und dem Nutzer
gezeigt wurde:

STOPPEN.

Nicht weiterprogrammieren, nicht weiteranalysieren und keine zusätzlichen
Tests starten, bis der Nutzer antwortet.

### Qualitätsausnahme

Diese Effizienzregeln dürfen keine sicherheitskritischen oder
produktionskritischen Prüfungen verhindern.

Bei Änderungen an:

- deterministischer Physik
- Lockstep
- Online-Protokoll
- Firebase Rules
- Datenmigration
- Security
- Speicherung oder möglichem Datenverlust

muss das notwendige Mindestmaß professioneller Verifikation erhalten bleiben.

Auch hier darf der Scope jedoch nicht ohne kurze Rücksprache unnötig
ausgeweitet werden.

ENDE DES ABSCHNITTS.
