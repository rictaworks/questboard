# questboard

Questboard frontend scaffold built with Next.js, TypeScript, App Router, next-intl, and FontAwesome.

## Scripts

- `npm run dev` — run the local development server
- `npm run build` — create a production build
- `npm start` — run the production server
- `npm test` — run repository checks

## Pages

- `/` — redirects to the default locale
- `/{locale}` — localized landing page (`ja`, `en`, `fr`, `zh`, `ru`, `es`, `ar`)

## Localization

Messages live in `src/messages/*.json` and should be referenced by translation keys only.

## Design tokens

CSS custom properties are defined in `src/styles/tokens/*.css` and imported by `src/app/globals.css`.
