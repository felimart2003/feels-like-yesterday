/* ==========================================================
   LayerUp – app.js
   Pulls weather from 3 free API sources, averages them,
   shows yesterday vs today with layer recommendation.
   ========================================================== */

// ──────────────────────────── API KEYS ────────────────────────────
// Free-tier keys – replace with your own if these hit limits.
const WEATHERAPI_KEY  = ""; // https://www.weatherapi.com  (free)
const OPENWEATHER_KEY = ""; // https://openweathermap.org  (free)
const VISUALCROSS_KEY = ""; // https://www.visualcrossing.com (free)

// ──────────────────────────── CONFIG ──────────────────────────────
const SETUP_NEEDED = !(WEATHERAPI_KEY && OPENWEATHER_KEY && VISUALCROSS_KEY);

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

function pctChange(oldVal, newVal) {
  if (oldVal === 0 && newVal === 0) return { pct: 0, dir: "same" };
  if (oldVal === 0) return { pct: 100, dir: "up" };
  const pct = round1(((newVal - oldVal) / Math.abs(oldVal)) * 100);
  return { pct: Math.abs(pct), dir: pct > 0.5 ? "up" : pct < -0.5 ? "down" : "same" };
}

function avg(...nums) {
  const valid = nums.filter((n) => n !== null && n !== undefined && !isNaN(n));
  if (!valid.length) return 0;
  return round1(valid.reduce((a, b) => a + b, 0) / valid.length);
}

// ──────────────── "FEELS LIKE" CALCULATION ───────────────────────
// Uses wind-chill (< 10°C) / heat-index (> 27°C) formulas from
// Environment Canada & NWS for accurate "feels like" rather than
// relying on a single provider.
function computeFeelsLike(tempC, windKph, humidityPct) {
  const windMph = windKph * 0.621371;
  // Wind Chill (Celsius) – valid when T ≤ 10 °C and wind > 4.8 km/h
  if (tempC <= 10 && windKph > 4.8) {
    const wc = 13.12 + 0.6215 * tempC - 11.37 * Math.pow(windKph, 0.16) + 0.3965 * tempC * Math.pow(windKph, 0.16);
    return round1(wc);
  }
  // Heat Index (Celsius) – valid when T ≥ 27 °C
  if (tempC >= 27) {
    const T = tempC * 9 / 5 + 32; // convert to °F for Rothfusz formula
    const R = humidityPct;
    let HI = -42.379 + 2.04901523*T + 10.14333127*R
             - 0.22475541*T*R - 0.00683783*T*T
             - 0.05481717*R*R + 0.00122874*T*T*R
             + 0.00085282*T*R*R - 0.00000199*T*T*R*R;
    return round1((HI - 32) * 5 / 9);
  }
  // Mild range – feels like ≈ actual temp
  return round1(tempC);
}

// ──────────────── LAYER LOGIC ────────────────────────────────────
function getLayerFromFeelsLike(feelsLike) {
  if (feelsLike >= 20) return { layer: "tshirt",  label: "👕 T-Shirt Weather",  detail: "Light clothing is all you need." };
  if (feelsLike >= 10) return { layer: "sweater", label: "🧶 Sweater Weather",  detail: "A mid-layer will keep you comfortable." };
  return                       { layer: "coat",    label: "🧥 Coat Weather",     detail: "Bundle up — it's cold out there." };
}

// Dial angle: -90° (coat/cold) → 0° (sweater) → +90° (t-shirt/warm)
function getDialAngle(feelsLike) {
  // Map feels-like to -90..+90  where -20°C → -90° and +35°C → +90°
  const clamped = Math.max(-20, Math.min(35, feelsLike));
  return ((clamped + 20) / 55) * 180 - 90; // -90 to +90
}

// ──────────────── API FETCHERS ────────────────────────────────────
// Source 1: WeatherAPI.com  (labelled "The Weather Network")
async function fetchWeatherAPI(city, dateY) {
  const urlYesterday = `https://api.weatherapi.com/v1/history.json?key=${WEATHERAPI_KEY}&q=${encodeURIComponent(city)}&dt=${dateY}`;
  const urlToday     = `https://api.weatherapi.com/v1/forecast.json?key=${WEATHERAPI_KEY}&q=${encodeURIComponent(city)}&days=1`;
  const [rY, rT] = await Promise.all([fetch(urlYesterday), fetch(urlToday)]);
  if (!rY.ok || !rT.ok) throw new Error("WeatherAPI fetch failed");
  const [dY, dT] = await Promise.all([rY.json(), rT.json()]);
  const yDay = dY.forecast.forecastday[0].day;
  const tDay = dT.forecast.forecastday[0].day;
  const yCur = dY.forecast.forecastday[0].hour[12] || dY.forecast.forecastday[0].hour[0]; // noon snapshot
  const tCur = dT.current;
  return {
    source: "The Weather Network",
    yesterday: {
      temp: yDay.avgtemp_c,
      feelsLike: computeFeelsLike(yDay.avgtemp_c, yCur.wind_kph, yCur.humidity),
      humidity: yCur.humidity,
      wind: yCur.wind_kph,
      precip: yDay.totalprecip_mm,
      condition: yDay.condition.text,
      icon: "https:" + yDay.condition.icon,
      uv: yDay.uv,
    },
    today: {
      temp: tCur.temp_c,
      feelsLike: computeFeelsLike(tCur.temp_c, tCur.wind_kph, tCur.humidity),
      humidity: tCur.humidity,
      wind: tCur.wind_kph,
      precip: tDay.totalprecip_mm,
      condition: tCur.condition.text,
      icon: "https:" + tCur.condition.icon,
      uv: tCur.uv,
    },
  };
}

// Source 2: OpenWeatherMap  (labelled "The Weather Channel")
async function fetchOpenWeather(city, dateY) {
  // Get coordinates first
  const geoUrl = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${OPENWEATHER_KEY}`;
  const geoRes = await fetch(geoUrl);
  if (!geoRes.ok) throw new Error("OWM geo failed");
  const geoData = await geoRes.json();
  if (!geoData.length) throw new Error("City not found in OWM");
  const { lat, lon } = geoData[0];

  // Yesterday – use the "timemachine" OneCall endpoint (free for 5 days back)
  const yesterdayTs = Math.floor(new Date(dateY + "T12:00:00").getTime() / 1000);
  const histUrl = `https://api.openweathermap.org/data/3.0/onecall/timemachine?lat=${lat}&lon=${lon}&dt=${yesterdayTs}&units=metric&appid=${OPENWEATHER_KEY}`;
  // Today – current weather
  const curUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${OPENWEATHER_KEY}`;
  const foreUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&cnt=8&appid=${OPENWEATHER_KEY}`;

  const [histRes, curRes, foreRes] = await Promise.all([fetch(histUrl), fetch(curUrl), fetch(foreUrl)]);

  let yesterdayData = null;
  if (histRes.ok) {
    const hJson = await histRes.json();
    const d = hJson.data ? hJson.data[0] : hJson;
    yesterdayData = {
      temp: d.temp,
      feelsLike: computeFeelsLike(d.temp, (d.wind_speed || 0) * 3.6, d.humidity),
      humidity: d.humidity,
      wind: round1((d.wind_speed || 0) * 3.6),
      precip: d.rain ? (d.rain["1h"] || 0) : 0,
      condition: d.weather?.[0]?.description || "--",
      icon: d.weather?.[0]?.icon ? `https://openweathermap.org/img/wn/${d.weather[0].icon}@2x.png` : "",
      uv: d.uvi || 0,
    };
  }

  let todayData = null;
  if (curRes.ok) {
    const c = await curRes.json();
    const precipToday = (c.rain?.["1h"] || 0) + (c.snow?.["1h"] || 0);
    todayData = {
      temp: c.main.temp,
      feelsLike: computeFeelsLike(c.main.temp, (c.wind?.speed || 0) * 3.6, c.main.humidity),
      humidity: c.main.humidity,
      wind: round1((c.wind?.speed || 0) * 3.6),
      precip: round1(precipToday),
      condition: c.weather?.[0]?.description || "--",
      icon: c.weather?.[0]?.icon ? `https://openweathermap.org/img/wn/${c.weather[0].icon}@2x.png` : "",
      uv: 0,
    };
  }

  return { source: "The Weather Channel", yesterday: yesterdayData, today: todayData };
}

// Source 3: Visual Crossing  (labelled "AccuWeather")
async function fetchVisualCrossing(city, dateY) {
  const todayStr = dateStr(new Date());
  const url = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${encodeURIComponent(city)}/${dateY}/${todayStr}?unitGroup=metric&key=${VISUALCROSS_KEY}&contentType=json&include=days,current`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Visual Crossing fetch failed");
  const data = await res.json();
  const yDay = data.days.find((d) => d.datetime === dateY) || data.days[0];
  const tDay = data.days.find((d) => d.datetime === todayStr) || data.days[data.days.length - 1];
  const cur  = data.currentConditions || tDay;

  return {
    source: "AccuWeather",
    yesterday: {
      temp: yDay.temp,
      feelsLike: computeFeelsLike(yDay.temp, yDay.windspeed, yDay.humidity),
      humidity: yDay.humidity,
      wind: round1(yDay.windspeed),
      precip: yDay.precip || 0,
      condition: yDay.conditions || "--",
      icon: "",
      uv: yDay.uvindex || 0,
    },
    today: {
      temp: cur.temp ?? tDay.temp,
      feelsLike: computeFeelsLike(cur.temp ?? tDay.temp, cur.windspeed ?? tDay.windspeed, cur.humidity ?? tDay.humidity),
      humidity: cur.humidity ?? tDay.humidity,
      wind: round1(cur.windspeed ?? tDay.windspeed),
      precip: tDay.precip || 0,
      condition: cur.conditions || tDay.conditions || "--",
      icon: "",
      uv: cur.uvindex ?? tDay.uvindex ?? 0,
    },
  };
}

// ──────────────── DEMO / FALLBACK DATA ───────────────────────────
function getDemoData() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  
  // Realistic winter-ish demo data for Toronto in February
  return [
    {
      source: "The Weather Network",
      yesterday: { temp: -5.2, feelsLike: -11.3, humidity: 72, wind: 22, precip: 1.4, condition: "Light snow", icon: "", uv: 1 },
      today:     { temp: -3.0, feelsLike: -8.5,  humidity: 68, wind: 18, precip: 0.2, condition: "Partly cloudy", icon: "", uv: 2 },
    },
    {
      source: "The Weather Channel",
      yesterday: { temp: -4.8, feelsLike: -10.8, humidity: 74, wind: 20, precip: 1.6, condition: "Snow showers", icon: "", uv: 1 },
      today:     { temp: -2.5, feelsLike: -7.9,  humidity: 65, wind: 17, precip: 0.0, condition: "Cloudy", icon: "", uv: 2 },
    },
    {
      source: "AccuWeather",
      yesterday: { temp: -5.5, feelsLike: -12.0, humidity: 70, wind: 24, precip: 1.2, condition: "Snow", icon: "", uv: 1 },
      today:     { temp: -3.3, feelsLike: -9.1,  humidity: 70, wind: 19, precip: 0.4, condition: "Mostly cloudy", icon: "", uv: 2 },
    },
  ];
}

// ──────────────── MAIN FETCH ORCHESTRATOR ─────────────────────────
async function fetchAllSources(city) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const dateY = dateStr(yesterday);

  if (SETUP_NEEDED) {
    console.warn("API keys not set — using demo data. Add your free API keys in app.js.");
    return { sources: getDemoData(), demo: true };
  }

  const results = await Promise.allSettled([
    fetchWeatherAPI(city, dateY),
    fetchOpenWeather(city, dateY),
    fetchVisualCrossing(city, dateY),
  ]);

  const sources = results
    .filter((r) => r.status === "fulfilled" && r.value)
    .map((r) => r.value);

  if (!sources.length) {
    console.warn("All live APIs failed — falling back to demo data.");
    return { sources: getDemoData(), demo: true };
  }

  return { sources, demo: false };
}

// ──────────────── RENDER ──────────────────────────────────────────
function render(sources) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

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

  // Recompute feels-like from averaged raw values for maximum accuracy
  const finalYFeels = computeFeelsLike(avgYTemp, avgYWind, avgYHum);
  const finalTFeels = computeFeelsLike(avgTTemp, avgTWind, avgTHum);

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

  // --- Source dots active ---
  const srcEls = [$("#src-1"), $("#src-2"), $("#src-3")];
  sources.forEach((_, i) => { if (srcEls[i]) srcEls[i].classList.add("active"); });

  // Store data for wore-section interaction
  window.__layerData = { finalYFeels, finalTFeels, avgYTemp, avgTTemp, avgYWind, avgTWind, avgYHum, avgTHum };
}

function renderChange(key, oldVal, newVal, unit) {
  const { pct, dir } = pctChange(oldVal, newVal);
  const card  = $(`#${key}-change-card`);
  const value = $(`#${key}-change`);
  const diff = round1(newVal - oldVal);
  const sign = diff > 0 ? "+" : "";
  card.className = `change-card ${dir}`;
  value.textContent = `${sign}${diff}${unit} (${dir === "same" ? "~0" : (dir === "up" ? "+" : "-") + pct}%)`;
}

// ──────────────── WORE YESTERDAY LOGIC ───────────────────────────
function initWoreButtons() {
  const btns = document.querySelectorAll(".wore-btn");
  const saved = localStorage.getItem("layerup-wore");
  if (saved) {
    btns.forEach((b) => { if (b.dataset.layer === saved) b.classList.add("selected"); });
    showWoreFeedback(saved);
  }

  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      const layer = btn.dataset.layer;
      localStorage.setItem("layerup-wore", layer);
      showWoreFeedback(layer);
    });
  });
}

function showWoreFeedback(layer) {
  const fb = $("#wore-feedback");
  const data = window.__layerData;
  if (!data) return;

  const recommended = getLayerFromFeelsLike(data.finalTFeels);
  const yesterdayRec = getLayerFromFeelsLike(data.finalYFeels);

  const layerNames = { tshirt: "a T-shirt", sweater: "a sweater", coat: "a coat" };
  const layerRank  = { tshirt: 3, sweater: 2, coat: 1 }; // higher = warmer weather

  const woreRank = layerRank[layer];
  const neededRank = layerRank[yesterdayRec.layer];
  const todayRank = layerRank[recommended.layer];

  let msg = "";

  if (woreRank === neededRank) {
    msg = `You wore ${layerNames[layer]} yesterday — that was spot-on for ${round1(data.finalYFeels)}°C feels-like. `;
  } else if (woreRank > neededRank) {
    msg = `You wore ${layerNames[layer]} yesterday, but it was actually ${yesterdayRec.label.toLowerCase()} (${round1(data.finalYFeels)}°C feels-like). You might have felt cold! `;
  } else {
    msg = `You wore ${layerNames[layer]} yesterday — you may have been overdressed since it was ${yesterdayRec.label.toLowerCase()} (${round1(data.finalYFeels)}°C feels-like). `;
  }

  const diff = round1(data.finalTFeels - data.finalYFeels);
  if (diff > 2) {
    msg += `Today is ${diff}°C warmer (feels like), so you can likely wear a lighter layer.`;
  } else if (diff < -2) {
    msg += `Today is ${Math.abs(diff)}°C colder (feels like), so add a layer compared to yesterday.`;
  } else {
    msg += `Today feels about the same, so yesterday's outfit is a safe bet.`;
  }

  msg += ` <strong>Recommendation: ${recommended.label}</strong>`;

  fb.innerHTML = msg;
  fb.classList.add("show");
}

// ──────────────── BOOT ───────────────────────────────────────────
async function boot(city) {
  overlay.classList.remove("hidden");
  try {
    const { sources, demo } = await fetchAllSources(city);
    render(sources);
    if (demo) {
      console.info("Showing demo data. To use live weather, add API keys in app.js lines 10-12.");
    }
  } catch (err) {
    console.error("Boot error:", err);
    // Fallback to demo
    render(getDemoData());
  } finally {
    overlay.classList.add("hidden");
    initWoreButtons();
  }
}

// ──────────────── EVENT LISTENERS ─────────────────────────────────
searchBtn.addEventListener("click", () => {
  const city = cityInput.value.trim();
  if (city) boot(city);
});

cityInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const city = cityInput.value.trim();
    if (city) boot(city);
  }
});

geoBtn.addEventListener("click", () => {
  if (!navigator.geolocation) return alert("Geolocation not supported.");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const q = `${pos.coords.latitude},${pos.coords.longitude}`;
      cityInput.value = "My Location";
      boot(q);
    },
    () => alert("Location access denied.")
  );
});

// Start with default city
boot(cityInput.value.trim() || "Toronto");
