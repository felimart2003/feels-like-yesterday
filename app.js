/* ==========================================================
   LayerUp – app.js
   Uses keyless Open-Meteo daily forecasts,
   shows yesterday vs today with layer recommendation.
   ========================================================== */

// ──────────────────────────── DOM REFS ────────────────────────────
const $ = (s) => document.querySelector(s);
const overlay     = $("#loading-overlay");
const cityInput   = $("#city-input");
const searchBtn   = $("#search-btn");
const geoBtn      = $("#geo-btn");

// ──────────────────────────── HELPERS ─────────────────────────────
function formatDate(d) {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function dateStr(d) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function avg(...nums) {
  const valid = nums.filter(Number.isFinite);
  if (!valid.length) return null;
  return round1(valid.reduce((a, b) => a + b, 0) / valid.length);
}

function sum(...nums) {
  const valid = nums.filter(Number.isFinite);
  if (!valid.length) return null;
  return round1(valid.reduce((a, b) => a + b, 0));
}

// ──────────────── LAYER LOGIC ────────────────────────────────────
function getLayerFromFeelsLike(feelsLike) {
  if (feelsLike >= 20) return { layer: "tshirt",  label: "👕 T-Shirt Weather",  detail: "Light clothing is all you need." };
  if (feelsLike >= 10) return { layer: "sweater", label: "🧶 Sweater Weather",  detail: "A mid-layer will keep you comfortable." };
  return                       { layer: "coat",    label: "🧥 Coat Weather",     detail: "Bundle up — it's cold out there." };
}

// Dial angle: -90° (coat/cold) → 0° (sweater) → +90° (t-shirt/warm)
function getDialAngle(feelsLike) {
  // Align the needle with the clothing label bands.
  return Math.max(-90, Math.min(90, (feelsLike - 15) * 6));
}

function openMeteoCodeToText(code) {
  const map = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow",
    73: "Moderate snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Thunderstorm with heavy hail",
  };
  return map[code] || "--";
}

function isLatLonQuery(query) {
  return /^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/.test(query || "");
}

function parseLatLonQuery(query) {
  const [latStr, lonStr] = query.split(",").map((v) => v.trim());
  return { lat: parseFloat(latStr), lon: parseFloat(lonStr) };
}

function getDailyStatsForDate(hourly, targetDate) {
  const rows = [];
  for (let i = 0; i < hourly.time.length; i++) {
    if (!hourly.time[i].startsWith(targetDate)) continue;
    rows.push({
      temp: hourly.temperature_2m?.[i],
      feelsLike: hourly.apparent_temperature?.[i],
      humidity: hourly.relative_humidity_2m?.[i],
      wind: hourly.wind_speed_10m?.[i],
      precip: hourly.precipitation?.[i],
      code: hourly.weather_code?.[i],
      uv: hourly.uv_index?.[i],
    });
  }

  if (!rows.length) return null;
  if (rows.some(row => [row.temp, row.feelsLike, row.humidity, row.wind, row.precip, row.uv].some(value => !Number.isFinite(value)))) {
    throw new Error("Weather provider returned missing measurements. Please try again later.");
  }

  const midday = rows[Math.min(12, rows.length - 1)] || rows[0];
  return {
    temp: avg(...rows.map((r) => r.temp)),
    feelsLike: avg(...rows.map((r) => r.feelsLike)),
    humidity: avg(...rows.map((r) => r.humidity)),
    wind: avg(...rows.map((r) => r.wind)),
    precip: sum(...rows.map((r) => r.precip)),
    condition: openMeteoCodeToText(midday.code),
    icon: "",
    uv: Math.max(...rows.map((r) => r.uv ?? 0)),
  };
}

async function resolveLocation(query) {
  if (isLatLonQuery(query)) {
    const { lat, lon } = parseLatLonQuery(query);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error("Coordinates are out of range.");
    return { latitude: lat, longitude: lon, displayName: `Location ${lat.toFixed(2)}, ${lon.toFixed(2)}` };
  }
  const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
  const geocodeRes = await fetch(geocodeUrl, { signal: AbortSignal.timeout(12000) });
  if (!geocodeRes.ok) throw new Error("Could not find that location");
  const geocodeData = await geocodeRes.json();
  const result = geocodeData?.results?.[0];
  if (!result) throw new Error("Location not found");

  const nameParts = [result.name, result.admin1, result.country].filter(Boolean);
  return {
    latitude: result.latitude,
    longitude: result.longitude,
    displayName: nameParts.join(", "),
  };
}

async function fetchOpenMeteoFallback(query) {
  const location = await resolveLocation(query);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,weather_code,uv_index&current=temperature_2m&wind_speed_unit=kmh&temperature_unit=celsius&precipitation_unit=mm&timezone=auto&past_days=1&forecast_days=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error("Open-Meteo fetch failed");
  const data = await res.json();

  // API timestamps use the selected location's timezone, not the visitor's timezone.
  const todayDate = data.current?.time?.slice(0, 10);
  if (!todayDate || !Array.isArray(data.hourly?.time)) throw new Error("Incomplete weather response.");
  const yesterdayDateObj = new Date(todayDate + "T12:00:00Z");
  yesterdayDateObj.setUTCDate(yesterdayDateObj.getUTCDate() - 1);
  const yesterdayDate = dateStr(yesterdayDateObj);
  const yesterday = getDailyStatsForDate(data.hourly, yesterdayDate);
  const today = getDailyStatsForDate(data.hourly, todayDate);
  if (!yesterday || !today) throw new Error("Incomplete weather data from Open-Meteo");

  return {
    dates: { today: todayDate, yesterday: yesterdayDate },
    sources: [
      {
        source: "Open-Meteo",
        yesterday,
        today,
      },
    ],
    demo: false,
    mode: "keyless",
    displayName: location.displayName,
  };
}

function getDemoData() {
  return [{ source: "Illustrative sample — not live weather",
    yesterday: {temp: 12, feelsLike: 10, humidity: 72, wind: 22, precip: 1.4, condition: "Light rain", uv: 2},
    today: {temp: 18, feelsLike: 17, humidity: 60, wind: 12, precip: 0, condition: "Partly cloudy", uv: 4}
  }];
}

// ──────────────── RENDER ──────────────────────────────────────────
function render(sources, dates) {
  const today = dates ? new Date(dates.today + "T12:00:00") : new Date();
  const yesterday = dates ? new Date(dates.yesterday + "T12:00:00") : new Date(today.getTime() - 86400000);

  // --- Compute averages ---
  const yTemps  = sources.map((s) => s.yesterday?.temp).filter((v) => v != null);
  const yFeels  = sources.map((s) => s.yesterday?.feelsLike).filter((v) => v != null);
  const yHum    = sources.map((s) => s.yesterday?.humidity).filter((v) => v != null);
  const yWind   = sources.map((s) => s.yesterday?.wind).filter((v) => v != null);
  const yPrecip = sources.map((s) => s.yesterday?.precip).filter((v) => v != null);
  const yUv     = sources.map((s) => s.yesterday?.uv).filter((v) => v != null);

  const tTemps  = sources.map((s) => s.today?.temp).filter((v) => v != null);
  const tFeels  = sources.map((s) => s.today?.feelsLike).filter((v) => v != null);
  const tHum    = sources.map((s) => s.today?.humidity).filter((v) => v != null);
  const tWind   = sources.map((s) => s.today?.wind).filter((v) => v != null);
  const tPrecip = sources.map((s) => s.today?.precip).filter((v) => v != null);
  const tUv     = sources.map((s) => s.today?.uv).filter((v) => v != null);

  const avgYTemp  = avg(...yTemps);
  const avgYFeels = avg(...yFeels);
  const avgYHum   = avg(...yHum);
  const avgYWind  = avg(...yWind);
  const avgYPrec  = avg(...yPrecip);
  const avgYUv    = avg(...yUv);

  const avgTTemp  = avg(...tTemps);
  const avgTFeels = avg(...tFeels);
  const avgTHum   = avg(...tHum);
  const avgTWind  = avg(...tWind);
  const avgTPrec  = avg(...tPrecip);
  const avgTUv    = avg(...tUv);

  // Preserve the provider apparent-temperature measurements.
  const finalYFeels = avgYFeels;
  const finalTFeels = avgTFeels;

  // --- Yesterday card ---
  $("#yesterday-date").textContent = formatDate(yesterday);
  $("#yesterday-temp").textContent = `${avgYTemp}°C`;
  $("#yesterday-feels").textContent = `${finalYFeels}°C`;
  $("#yesterday-humidity").textContent = `${avgYHum}%`;
  $("#yesterday-wind").textContent = `${avgYWind} km/h`;
  $("#yesterday-precip").textContent = `${avgYPrec} mm`;
  $("#yesterday-uv").textContent = avgYUv;
  const yCondition = sources[0]?.yesterday?.condition || "--";
  $("#yesterday-condition").textContent = yCondition;
  const yIcon = sources.find((s) => s.yesterday?.icon)?.yesterday?.icon;
  if (yIcon) { $("#yesterday-icon").src = yIcon; $("#yesterday-icon").alt = yCondition; }
  else { $("#yesterday-icon").style.display = "none"; }

  // --- Today card ---
  $("#today-date").textContent = formatDate(today);
  $("#today-temp").textContent = `${avgTTemp}°C`;
  $("#today-feels").textContent = `${finalTFeels}°C`;
  $("#today-humidity").textContent = `${avgTHum}%`;
  $("#today-wind").textContent = `${avgTWind} km/h`;
  $("#today-precip").textContent = `${avgTPrec} mm`;
  $("#today-uv").textContent = avgTUv;
  const tCondition = sources[0]?.today?.condition || "--";
  $("#today-condition").textContent = tCondition;
  const tIcon = sources.find((s) => s.today?.icon)?.today?.icon;
  if (tIcon) { $("#today-icon").src = tIcon; $("#today-icon").alt = tCondition; }
  else { $("#today-icon").style.display = "none"; }

  // --- Change indicators ---
  renderChange("temp",   avgYTemp,  avgTTemp,  "°C");
  renderChange("feels",  finalYFeels, finalTFeels, "°C");
  renderChange("precip", avgYPrec,  avgTPrec,  " mm");

  // --- Dial ---
  $("#wore-feedback").classList.remove("show");
  const angle = getDialAngle(finalTFeels);
  $("#dial-needle").setAttribute("transform", `rotate(${angle}, 150, 170)`);
  const layer = getLayerFromFeelsLike(finalTFeels);
  $("#dial-recommendation").textContent = layer.label;
  $("#dial-detail").textContent = layer.detail;

  // --- Breakdown table ---
  const tbody = $("#breakdown-body");
  tbody.innerHTML = "";
  sources.forEach((s) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${s.source}</td>
      <td>${s.today?.temp ?? "--"}°C</td>
      <td>${s.today?.feelsLike ?? "--"}°C</td>
      <td>${s.today?.humidity ?? "--"}%</td>
      <td>${s.today?.wind ?? "--"} km/h</td>
      <td>${s.today?.precip ?? "--"} mm</td>
    `;
    tbody.appendChild(row);
  });
  $("#avg-temp").textContent    = `${avgTTemp}°C`;
  $("#avg-feels").textContent   = `${finalTFeels}°C`;
  $("#avg-humidity").textContent = `${avgTHum}%`;
  $("#avg-wind").textContent    = `${avgTWind} km/h`;
  $("#avg-precip").textContent  = `${avgTPrec} mm`;

  $("#src-1").textContent = sources[0].source;
  // Store data for wore-section interaction
  window.__layerData = { finalYFeels, finalTFeels, avgYTemp, avgTTemp, avgYWind, avgTWind, avgYHum, avgTHum };
}

function renderChange(key, oldVal, newVal, unit) {
  const dir = newVal > oldVal ? "up" : newVal < oldVal ? "down" : "same";
  const card  = $(`#${key}-change-card`);
  const value = $(`#${key}-change`);
  const diff = round1(newVal - oldVal);
  const sign = diff > 0 ? "+" : "";
  card.className = `change-card ${dir}`;
  value.textContent = `${sign}${diff}${unit}`;
}

// Local preferences are optional: restricted browser storage must not break weather.
function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } }
let activeDates;
let activeLocation = "";
function updateWoreButtons() {
  const key = `layerup-wore:${activeLocation}:${activeDates?.yesterday || "sample"}`;
  const saved = storageGet(key);
  document.querySelectorAll(".wore-btn").forEach(button => {
    const selected = button.dataset.layer === saved;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}
document.querySelectorAll(".wore-btn").forEach(button => {
  button.addEventListener("click", () => {
    const key = `layerup-wore:${activeLocation}:${activeDates?.yesterday || "sample"}`;
    const stored = storageSet(key, button.dataset.layer);
    updateWoreButtons();
    const feedback = $("#wore-feedback");
    feedback.classList.add("show");
    const data = window.__layerData;
    const difference = data ? round1(data.finalTFeels - data.finalYFeels) : 0;
    feedback.textContent = `${stored ? "Saved on this device." : "Browser storage is unavailable."} Today feels ${Math.abs(difference)}°C ${difference >= 0 ? "warmer" : "cooler"}. Use yesterday's outfit as a starting point and adjust for your comfort.`;
  });
});
function setStatus(message, error = false) {
  $("#status").textContent = message;
  $("#status").classList.toggle("error", error);
}
let requestId = 0;
async function boot(city) {
  if (!city.trim()) { setStatus("Enter a city to search.", true); return; }
  const id = ++requestId;
  overlay.classList.remove("hidden");
  setStatus("Finding your forecast…");
  try {
    const { sources, displayName, dates } = await fetchOpenMeteoFallback(city);
    if (id !== requestId) return;
    render(sources, dates);
    activeDates = dates;
    activeLocation = displayName;
    $("#forecast").hidden = false;
    $("#forecast-location").textContent = displayName;
    storageSet("layerup-city", city);
    setStatus("Live forecast · Daily averages in local time · Updated " + new Date().toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}));
    updateWoreButtons();
  } catch (error) {
    if (id !== requestId) return;
    setStatus((error.name === "TimeoutError" ? "The weather service timed out." : error.message) + " Try another city, retry, or explore the sample forecast. Any forecast below is from your previous selection.", true);
  } finally {
    if (id === requestId) overlay.classList.add("hidden");
  }
}
searchBtn.addEventListener("click", () => boot(cityInput.value.trim()));
cityInput.addEventListener("keydown", event => { if (event.key === "Enter") boot(cityInput.value.trim()); });
$("#demo-btn").addEventListener("click", () => {
  ++requestId;
  overlay.classList.add("hidden");
  activeDates = undefined;
  activeLocation = "Sample";
  render(getDemoData());
  $("#forecast").hidden = false;
  $("#forecast-location").textContent = "Sample forecast";
  setStatus("DEMO · Illustrative weather only. Search for a city to see a live forecast.");
  updateWoreButtons();
});
geoBtn.addEventListener("click", () => {
  if (!navigator.geolocation) { setStatus("Location is unavailable. Search by city instead.", true); return; }
  setStatus("Waiting for location permission…");
  navigator.geolocation.getCurrentPosition(
    position => boot(`${position.coords.latitude},${position.coords.longitude}`),
    () => setStatus("Could not access your location. Search by city instead.", true),
    {timeout: 10000, maximumAge: 300000}
  );
});
cityInput.value = storageGet("layerup-city") || "Toronto";
boot(cityInput.value);
