# Weatherly

Responsive weather dashboard built with TypeScript, Vite, custom CSS, OpenWeather, and Chart.js.

## Run locally

```sh
npm install
npm run dev
```

Set `VITE_OPENWEATHER_API_KEY` in the local `.env` file to enable city search and live forecasts. The `.env` file is gitignored. Restart the dev server after changing it.

## Features

- City autocomplete and up to five independent weather cards.
- Current conditions, hourly chart for today, and five-day forecast with daily average temperatures.
- Persistent favorites (up to five cities), with forecasts and day/week chart toggles.
- Ukrainian and English interface and localized OpenWeather descriptions.
- Day/night theme toggle, loading indicators, and confirmation when removing a weather card.
- Weather-matched Lottie illustrations for clear daytime, clouds, and rain.
- Installable PWA with an offline-cached app shell.

The service worker caches the app shell and same-origin assets for offline opening. Weather API requests are not cached, so forecasts and city search require an internet connection.

## Source structure

- `src/main.ts` — application state, rendering, and event handlers.
- `src/types.ts` — shared weather, city, and UI state types.
- `src/translations.ts` — English and Ukrainian interface strings.
- `src/utils.ts` — formatting, forecast aggregation, favorites storage, and URL helpers.
- `src/assets/` — weather animation assets.
