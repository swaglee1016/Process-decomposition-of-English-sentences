# Third-party components

This application includes its production npm dependencies. Each dependency retains its upstream LICENSE / NOTICE files inside app/node_modules. The exact dependency tree is recorded in package-lock.json. No dependency installation scripts run during packaging.

The setup wizard downloads missing runtime components only after consent:

- Node.js: https://nodejs.org/ — MIT and included third-party notices. The downloaded archive retains its LICENSE file.
- Eclipse Temurin Java runtime: https://adoptium.net/ — see https://adoptium.net/about/licensing/ and the legal notices retained in its archive.
- PlantUML MIT build: https://plantuml.com/download — the selected artifact is plantuml-mit-1.2026.9.jar; its packaged license metadata is retained.

Pinned versions, official artifact URLs, file sizes, and SHA-256 checksums are recorded in installer/components.json in the source repository and embedded in the setup executable. Node and Temurin hashes come from their official checksum metadata. The PlantUML hash is pinned from the official release artifact downloaded over HTTPS during preparation.

The setup executable does not include personal books, output notes, a vocabulary database, API keys, or a .env file. This notice does not assign a new license to the project's own source code.
