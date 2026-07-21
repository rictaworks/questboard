# questboard

Questboard frontend scaffold built with Next.js, TypeScript, App Router, next-intl, and FontAwesome.

## Scripts

- `npm run dev` — run the local development server
- `npm run build` — create a production build
- `npm start` — run the production server
- `npm test` — run repository checks

## Pages

- `/` — redirects to the default locale
- `/{locale}` — localized landing page with Google sign-in (`ja`, `en`, `fr`, `zh`, `ru`, `es`, `ar`)
- `/auth/google/callback` — Google OAuth callback alias
- `/{locale}/auth/google/callback` — Google OAuth callback and reCAPTCHA exchange

## Authentication

- Frontend env: `NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_REDIRECT_URI`, `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`, `NEXT_PUBLIC_ENV`
- Backend env: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `RECAPTCHA_SECRET_KEY`
- Development mode treats the app as already authenticated; this branch is not present in production builds

## Localization

Messages live in `src/messages/*.json` and should be referenced by translation keys only.

## Design tokens

CSS custom properties are defined in `src/styles/tokens/*.css` and imported by `src/app/globals.css`.
