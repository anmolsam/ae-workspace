# Briefy — Frontend

Next.js (App Router) app for `briefy-web`. Run from inside this directory:

    npm install
    cp .env.local.example .env.local   # fill in real values
    npm run dev

Tests: `npm test` (Vitest). Build: `npm run build`.

Deployed on Railway as a third service in the same project as ICP Match's
`watch.js` and Briefy's `src/briefy/engine.js` — root directory `web/`,
start command `npm run build && npm run start`.
