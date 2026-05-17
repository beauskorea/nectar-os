# NECTAR-OS

Minimal personal operating OS for executives — forked from a private dashboard, fully de-personalized into a clean shell. Drop in your own data and credentials.

## Stack
Next.js 16 · React 19 · Tailwind 4 · Anthropic SDK

## Modules
`/people` `/todos` `/partners` `/calendar` `/mail` `/money` `/memo` `/outreach` `/inbox` `/weekly` `/monthly` `/seeding`

## Quick start
```bash
npm install
cp .env.example .env.local
# fill in your keys (Anthropic, OpenAI, Google OAuth, etc.)
npm run build
PORT=3742 npm start
```

## Setup guide
See companion deck: `nectar-os-setup-guide.pptx` (5 steps · ~50 min to functional)

## License
MIT
