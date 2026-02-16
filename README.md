# LayerUp – What To Wear Today

LayerUp is a small front-end weather app that compares **today vs yesterday** and suggests what layer to wear (T-shirt, sweater, or coat) based on "feels like" conditions.

## What this app does

- Shows yesterday and today weather side-by-side
- Calculates and displays changes in temperature, feels-like, and precipitation
- Gives a wear recommendation using a visual dial
- Lets you record what you wore yesterday for personal tracking
- Supports city search and geolocation

## Data modes

LayerUp supports two weather data modes:

1. **Keyless mode (default)**
   - Uses Open-Meteo for live weather and location search
   - Works out of the box without any API keys

2. **Multi-source mode (optional)**
   - Uses WeatherAPI, OpenWeather, and Visual Crossing
   - Enable by adding keys in `app.js`:

```js
const WEATHERAPI_KEY  = "your_key";
const OPENWEATHER_KEY = "your_key";
const VISUALCROSS_KEY = "your_key";
```

If all 3 keys are provided, the app aggregates those sources.

## Run locally

Because this app makes network requests to weather APIs, run it from a local server (not plain `file://`).

### Option A: VS Code Live Server

- Install the Live Server extension
- Right-click `index.html`
- Select **Open with Live Server**

### Option B: Python

```bash
python -m http.server 5500
```

Then open: `http://localhost:5500`

## Project files

- `index.html` – page structure
- `styles.css` – app styling
- `app.js` – weather fetching, calculations, rendering, interactions

## Notes

- The "What Did You Wear Yesterday?" section now stores selection only and does not show explanatory popup feedback.
- Geolocation requires browser permission.
- If external APIs are unavailable, the app falls back to demo data as a safety net.
