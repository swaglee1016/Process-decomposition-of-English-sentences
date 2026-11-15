# Project Rules

## Purpose

This project turns an English article into a complete two-column HTML study page: the source article on the left and sentence/process decomposition on the right.

## Directory Contract

- `public/`: browser UI and static assets.
- `services/`: external analysis and diagram-rendering integrations.
- `tests/`: automated regression and integration tests.
- `installer/`: Windows setup/launcher source, pinned component download manifest, and build scripts. Build and installation verification artifacts belong under `outputs/` and are not committed.
- `outputs/`: generated, self-contained HTML result pages. These files are persistent user artifacts and must not be committed.
- `data/`: permanent local vocabulary SQLite database and its internal journals, plus `reader-session/` for uploaded source books and durable reading/analysis state; never commit or automatically delete these user records.
- `docs/superpowers/plans/`: confirmed implementation plans.
- Project-root files: server entry point, package metadata, launcher, and documentation only.

## Naming

- JavaScript files use `camelCase.js` unless an existing convention requires otherwise.
- Tests use `<subject>.test.js`.
- Generated result files use `sentence-decomposition-YYYYMMDD-HHmmss[-N].html`.
- Companion diagram pages use `<result-basename>-diagram-<sentence-number>.html` in `outputs/`; links from the saved study page are relative. Preserve companion pages with their study page.
- `outputs/.<result-filename>.reserve` files are zero-byte exclusive filename reservations preventing concurrent output collisions. They are persistent internal metadata, ignored by Git, and are not automatically deleted.
- Shared browser utilities live in `public/` and are embedded into exported HTML when offline use requires them; no CDN or running server is required by saved pages.
- User-facing generated HTML must be UTF-8 and self-contained: no dependency on the running local server for viewing.

## Persistence Rules

- A completed result must be written to `outputs/` before the UI reports completion.
- The saved file must contain the full layout, including the left article, right analysis/diagrams, styles, and interactions that work from `file://`.
- Source text completeness is the first acceptance criterion for book import. Check the text that a reader actually sees when opening a directory entry, including chapter numbers, titles, blurbs, introductions, intervening prose, notes and end matter. For a reported omission, compare the affected range against the original file when it is available.
- Keep the complete original reading order available. If text cannot be assigned confidently to an entry, give it an identifiable reading entry or source-page link. A warning, a hidden candidate, or preserving archive bytes alone does not satisfy this requirement.
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
