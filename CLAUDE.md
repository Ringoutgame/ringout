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

### Context Before Action

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

### Planning Before Implementation

- For any non-trivial change (architectural refactors, new systems, changes affecting multiple files), present a clear plan first.
- Describe what will change, what will stay the same, and what the risks are.
- Begin implementation only after explicit approval.

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
