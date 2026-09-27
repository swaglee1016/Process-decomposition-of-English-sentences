# Project Rules

## Purpose

This project turns an English article into a complete two-column HTML study page: the source article on the left and sentence/process decomposition on the right.

## Directory Contract

- `public/`: browser UI and static assets.
- `services/`: external analysis and diagram-rendering integrations.
- `tests/`: automated regression and integration tests.
- `outputs/`: generated, self-contained HTML result pages. These files are persistent user artifacts and must not be committed.
- `docs/superpowers/plans/`: confirmed implementation plans.
- Project-root files: server entry point, package metadata, launcher, and documentation only.

## Naming

- JavaScript files use `camelCase.js` unless an existing convention requires otherwise.
- Tests use `<subject>.test.js`.
- Generated result files use `sentence-decomposition-YYYYMMDD-HHmmss[-N].html`.
- User-facing generated HTML must be UTF-8 and self-contained: no dependency on the running local server for viewing.

## Persistence Rules

- A completed result must be written to `outputs/` before the UI reports completion.
- The saved file must contain the full layout, including the left article, right analysis/diagrams, styles, and interactions that work from `file://`.
- Closing the browser, terminal, or Node.js process must not make an already completed output unreadable.
- Never store generated output only in memory, a `blob:` URL, or browser storage.

## Change Discipline

- Write or update a failing regression test before changing runtime behavior.
- Keep fixes scoped; do not refactor unrelated processing logic.
- Do not modify `.env`, credentials, deployment, or CI configuration without explicit user approval.
- Do not delete generated outputs automatically. Any cleanup policy requires explicit user approval.

## Verification

- Run the project test suite after logic changes.
- Start the app and smoke-test the generation/result retrieval path when runtime behavior changes.
- Verify a saved output directly from disk with the server stopped.
