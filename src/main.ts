import Chart from 'chart.js/auto'
import type { AnimationItem } from 'lottie-web/build/player/lottie_svg'
import './style.css'
import { translations, type TranslationKey } from './translations'
import type {
  City,
  CurrentWeather,
  Favorite,
  ForecastWeather,
  Language,
  WeatherBlock,
  WeatherData,
} from './types'
import {
  getDailyForecast as calculateDailyForecast,
  cityLabel,
  escapeHtml,
  formatLocalTime,
  getApiUrl,
  localDateKey,
  persistFavorites,
  readFavorites,
  weatherIcon,
} from './utils'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('App root element #app was not found.')

const savedFavorites = readFavorites()
let language: Language = localStorage.getItem('weather-language') === 'en' ? 'en' : 'uk'
const apiKey = import.meta.env.VITE_OPENWEATHER_API_KEY || ''
let activeTab: 'forecast' | 'favorites' = 'forecast'
let blocks: WeatherBlock[] = [{ id: 1, city: null, data: null, loading: false, error: '', mode: 'day' }]
let favorites: Favorite[] = savedFavorites.map((city) => ({ city, data: null, loading: false, error: '', mode: 'day' }))
let nextBlockId = 2
const searchTimers = new Map<string, number>()
const searchSequences = new Map<string, number>()
let modalAction: (() => void) | null = null
let toastTimer: number | undefined
const charts = new Map<string, Chart>()
const weatherAnimations = new Map<string, AnimationItem>()

function t(key: TranslationKey): string {
  return translations[language][key]
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    if (response.status === 401) throw new Error('OpenWeather rejected the API key. Check that the key is active.')
    if (response.status === 404) throw new Error(t('cityError'))
    throw new Error(`OpenWeather request failed (${response.status}).`)
  }
  return response.json() as Promise<T>
}

async function loadWeather(city: City): Promise<WeatherData> {
  const params = { lat: String(city.lat), lon: String(city.lon), units: 'metric' }
  const [current, forecast] = await Promise.all([
    fetchJson<CurrentWeather>(getApiUrl('/data/2.5/weather', params, apiKey, language)),
    fetchJson<ForecastWeather>(getApiUrl('/data/2.5/forecast', params, apiKey, language)),
  ])
  return { current, forecast }
}

function animationForWeather(main: string | undefined, icon: string | undefined): 'clear' | 'clouds' | 'rain' | null {
  if (main === 'Clear' && icon?.endsWith('d')) return 'clear'
  if (main === 'Clouds') return 'clouds'
  if (main === 'Rain' || main === 'Drizzle' || main === 'Thunderstorm') return 'rain'
  return null
}

async function mountWeatherAnimations(): Promise<void> {
  const containers = [...app!.querySelectorAll<HTMLElement>('[data-weather-animation]')]
  await Promise.all(containers.map(async (container) => {
    const type = container.dataset.weatherAnimation
    if (type !== 'clear' && type !== 'clouds' && type !== 'rain') return

    const [lottieModule, animationModule] = await Promise.all([
      import('lottie-web/build/player/lottie_svg'),
      type === 'clear'
        ? import('./assets/Clear_Day.json')
        : type === 'clouds'
          ? import('./assets/Clouds.json')
          : import('./assets/Rainy.json'),
    ])
    if (!container.isConnected) return

    const animation = lottieModule.default.loadAnimation({
      container,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      animationData: animationModule.default,
    })
    animation.addEventListener('DOMLoaded', () => {
      container.closest('.weather-art')?.classList.add('is-animated')
    })
    weatherAnimations.set(container.id, animation)
  }))
}

function weatherSummary(data: WeatherData, cityName: string, mode: 'day' | 'week', animationId: string): string {
  const weather = data.current.weather[0]
  const currentTemp = Math.round(data.current.main.temp)
  const daily = calculateDailyForecast(data, language, t('todayLabel'))
  const tempText = mode === 'day' ? `${currentTemp}°` : `${Math.round(daily[0]?.temp ?? currentTemp)}°`
  const animation = animationForWeather(weather?.main, weather?.icon)
  console.log('Weather summary:', { cityName, mode, tempText, animation })
  return `
    <div class="weather-summary">
      <div class="weather-main">
        <div class="weather-art ${animation ? 'has-animation' : ''}">
          <img class="weather-icon" src="${weatherIcon(weather?.icon || '01d')}" alt="">
          ${animation ? `<div class="weather-animation" id="weather-animation-${escapeHtml(animationId)}" data-weather-animation="${animation}" aria-hidden="true"></div>` : ''}
        </div>
        <div class="weather-reading">
          <div class="temperature">${tempText}</div>
          <p class="condition">${escapeHtml(weather?.description || '')}</p>
        </div>
      </div>
      <p class="summary-city">${escapeHtml(cityName)}</p>
      ${mode === 'day' ? `
        <div class="weather-stats">
          <div><span>${t('feelsLike')}</span><strong>${Math.round(data.current.main.feels_like)}°</strong></div>
          <div><span>${t('humidity')}</span><strong>${data.current.main.humidity}%</strong></div>
          <div><span>${t('wind')}</span><strong>${Math.round(data.current.wind.speed * 3.6)} <small>km/h</small></strong></div>
        </div>
      ` : ''}
    </div>
  `
}

function renderChart(key: string, data: WeatherData, mode: 'day' | 'week'): void {
  const canvas = document.getElementById(`chart-${key}`) as HTMLCanvasElement | null
  if (!canvas) return
  charts.get(key)?.destroy()
  const isDay = mode === 'day'
  const currentDate = localDateKey(Date.now() / 1000, data.current.timezone)
  const hourly = data.forecast.list.filter((point) => localDateKey(point.dt, data.current.timezone) === currentDate)
  const daily = calculateDailyForecast(data, language, t('todayLabel'))
  const labels = isDay
    ? hourly.map((point) => formatLocalTime(point.dt, data.current.timezone, language, { hour: '2-digit', minute: '2-digit' }))
    : daily.map((point) => point.label)
  const temperatures = isDay ? hourly.map((point) => point.main.temp) : daily.map((point) => point.temp)

  charts.set(key, new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: temperatures,
        borderColor: '#f5a623',
        backgroundColor: 'rgba(245, 166, 35, .14)',
        borderWidth: 3,
        pointRadius: isDay ? 3 : 5,
        pointHoverRadius: 6,
        pointBackgroundColor: '#fff',
        pointBorderColor: '#f5a623',
        pointBorderWidth: 2,
        fill: true,
        tension: 0.38,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => context.parsed.y === null ? '' : ` ${Math.round(context.parsed.y)}°C` } } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: '#818895', maxTicksLimit: isDay ? 7 : 5 } },
        y: { grid: { color: 'rgba(128, 138, 150, .13)' }, border: { display: false }, ticks: { color: '#818895', callback: (value) => `${value}°` } },
      },
    },
  }))
}

function locationSearch(id: string, city: City | null): string {
  return `
    <div class="search-wrap">
      <label class="sr-only" for="search-${id}">${t('searchPlaceholder')}</label>
      <i class="search-icon fa-solid fa-magnifying-glass" aria-hidden="true"></i>
      <input id="search-${id}" class="city-search" data-search="${id}" type="search"
        placeholder="${t('searchPlaceholder')}" value="${city ? escapeHtml(cityLabel(city)) : ''}"
        autocomplete="off" ${apiKey ? '' : 'disabled'}>
      <div class="suggestions" id="suggestions-${id}" role="listbox"></div>
    </div>
  `
}

function suggestionMarkup(cities: City[]): string {
  if (!cities.length) return ''
  return `<div class="suggestion-list">${cities.map((city, index) => `
    <button class="suggestion" type="button" role="option" data-city-index="${index}" data-city="${escapeHtml(JSON.stringify(city))}">
      <i class="suggestion-pin fa-solid fa-location-dot" aria-hidden="true"></i>
      <span>${escapeHtml(city.name)}${city.state ? `, ${escapeHtml(city.state)}` : ''}<small>${escapeHtml(city.country)}</small></span>
    </button>
  `).join('')}</div>`
}

function renderBlock(block: WeatherBlock): string {
  const city = block.city
  const favorite = city && favorites.some((item) => item.city.lat === city.lat && item.city.lon === city.lon)
  const cardTitle = city ? escapeHtml(city.name) : t('addCity')
  return `
    <article class="weather-card ${city && favorite ? 'is-favorite' : ''}" data-block="${block.id}">
      <div class="card-top">
        <div class="location-heading">
          <i class="location-pin fa-solid fa-location-dot" aria-hidden="true"></i>
          <div><h2>${cardTitle}${favorite ? '<i class="favorite-mark fa-solid fa-star" aria-label="Favorite"></i>' : ''}</h2>
          <span class="location-country">${city ? escapeHtml([city.state, city.country].filter(Boolean).join(', ')) : t('emptyBlock')}</span></div>
        </div>
        <div class="card-actions">
          ${city ? `<button class="icon-button favorite-button ${favorite ? 'selected' : ''}" data-favorite="${block.id}" type="button" title="${favorite ? t('unfavorite') : t('favorite')}" aria-label="${favorite ? t('unfavorite') : t('favorite')}"><i class="${favorite ? 'fa-solid' : 'fa-regular'} fa-star" aria-hidden="true"></i></button>` : ''}
          ${blocks.length > 1 ? `<button class="icon-button remove-button" data-remove="${block.id}" type="button" title="${t('remove')}" aria-label="${t('remove')}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>` : ''}
        </div>
      </div>
      ${locationSearch(String(block.id), city)}
      ${block.loading ? `<div class="card-loading"><span class="spinner"></span><span>${t('loading')}</span></div>` : ''}
      ${block.error ? `<p class="inline-error">${escapeHtml(block.error)}</p>` : ''}
      ${block.data && city ? `
        ${weatherSummary(block.data, city.name, block.mode, String(block.id))}
        <div class="chart-section">
          <div class="chart-heading"><h3>${block.mode === 'day' ? t('hourly') : t('daily')}</h3>${modeToggle(String(block.id), block.mode)}</div>
          <div class="chart-container"><canvas id="chart-${block.id}" aria-label="${block.mode === 'day' ? t('hourly') : t('daily')}"></canvas></div>
          ${block.mode === 'week' ? `<div class="daily-forecast">${dailyForecastMarkup(block.data)}</div>` : ''}
        </div>
      ` : ''}
    </article>
  `
}

function modeToggle(id: string, mode: 'day' | 'week'): string {
  return `<div class="mode-toggle" role="group" aria-label="${t('forecast')}">
    <button type="button" data-mode="${id}" data-value="day" class="${mode === 'day' ? 'active' : ''}">${t('today')}</button>
    <button type="button" data-mode="${id}" data-value="week" class="${mode === 'week' ? 'active' : ''}">${t('fiveDays')}</button>
  </div>`
}

function dailyForecastMarkup(data: WeatherData): string {
  return `<div class="daily-list">${calculateDailyForecast(data, language, t('todayLabel')).map((day) => `
    <div class="daily-item"><span>${escapeHtml(day.label)}</span>
      <img src="${weatherIcon(day.icon)}" alt="${escapeHtml(day.description)}">
      <strong>${Math.round(day.temp)}°</strong></div>
  `).join('')}</div>`
}

function renderFavorite(item: Favorite, index: number): string {
  const title = escapeHtml(item.city.name)
  return `
    <article class="weather-card favorite-card">
      <div class="card-top">
        <div class="location-heading"><i class="location-pin fa-solid fa-location-dot" aria-hidden="true"></i><div>
          <h2>${title}<i class="favorite-mark fa-solid fa-star" aria-label="Favorite"></i></h2>
          <span class="location-country">${escapeHtml([item.city.state, item.city.country].filter(Boolean).join(', '))}</span>
        </div></div>
        <button class="icon-button remove-button" data-remove-favorite="${index}" type="button" title="${t('unfavorite')}" aria-label="${t('unfavorite')}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      </div>
      ${item.loading ? `<div class="card-loading"><span class="spinner"></span><span>${t('loading')}</span></div>` : ''}
      ${item.error ? `<p class="inline-error">${escapeHtml(item.error)}</p>` : ''}
      ${item.data ? `
        ${weatherSummary(item.data, item.city.name, item.mode, `fav-${index}`)}
        <div class="chart-section">
          <div class="chart-heading"><h3>${item.mode === 'day' ? t('hourly') : t('daily')}</h3>${modeToggle(`fav-${index}`, item.mode)}</div>
          <div class="chart-container"><canvas id="chart-fav-${index}" aria-label="${item.mode === 'day' ? t('hourly') : t('daily')}"></canvas></div>
          ${item.mode === 'week' ? `<div class="daily-forecast">${dailyForecastMarkup(item.data)}</div>` : ''}
        </div>
      ` : ''}
    </article>
  `
}

function render(): void {
  for (const chart of charts.values()) chart.destroy()
  charts.clear()
  for (const animation of weatherAnimations.values()) animation.destroy()
  weatherAnimations.clear()
  document.documentElement.lang = language
  document.body.classList.toggle('night-theme', document.documentElement.dataset.theme === 'night')
  app!.innerHTML = `
    <header class="app-header">
      <a class="brand" href="#" aria-label="${t('title')} home"><i class="brand-icon fa-solid fa-sun" aria-hidden="true"></i><span>${t('title')}</span></a>
      <p class="header-subtitle">${t('subtitle')}</p>
      <div class="header-actions">
        <button class="text-button theme-button" id="theme-button" type="button" aria-label="${document.documentElement.dataset.theme === 'night' ? t('night') : t('day')}"><i class="fa-solid ${document.documentElement.dataset.theme === 'night' ? 'fa-moon' : 'fa-sun'}" aria-hidden="true"></i><span>${document.documentElement.dataset.theme === 'night' ? t('night') : t('day')}</span></button>
        <button class="language-button" id="language-button" type="button" aria-label="${t('language')}">${language === 'uk' ? 'EN' : 'UA'}</button>
      </div>
    </header>
    <main class="main-content">
      <div class="page-heading"><div><p class="eyebrow">${language === 'uk' ? 'ВАШ ПРОГНОЗ' : 'YOUR FORECAST'}</p><h1>${activeTab === 'forecast' ? t('forecast') : t('favorites')}</h1></div>
        ${activeTab === 'forecast' ? `<button class="add-button" id="add-block" type="button" ${blocks.length >= 5 ? 'disabled' : ''}><i class="fa-solid fa-plus" aria-hidden="true"></i>${t('addBlock')}</button>` : ''}
      </div>
      <nav class="tabs" aria-label="Main navigation">
        <button class="${activeTab === 'forecast' ? 'active' : ''}" data-tab="forecast" type="button"><i class="fa-regular fa-clock" aria-hidden="true"></i>${t('forecast')}</button>
        <button class="${activeTab === 'favorites' ? 'active' : ''}" data-tab="favorites" type="button"><i class="fa-regular fa-star" aria-hidden="true"></i>${t('favorites')}<span class="tab-count">${favorites.length}</span></button>
      </nav>
      ${activeTab === 'forecast' ? `<section class="weather-grid">${blocks.map(renderBlock).join('')}</section>` : favorites.length
      ? `<section class="weather-grid">${favorites.map(renderFavorite).join('')}</section>`
      : `<section class="empty-state"><i class="empty-icon fa-regular fa-star" aria-hidden="true"></i><h2>${t('noFavorites')}</h2><button class="add-button" data-tab="forecast" type="button">${t('addFirst')}</button></section>`}
      <footer class="app-footer"><span>OpenWeather</span><span>·</span><span>${language === 'uk' ? 'Погода, що надихає' : 'Forecast for brighter days'}</span></footer>
    </main>
    <div class="toast" id="toast" role="status"></div>
    <dialog class="app-dialog" id="app-dialog"><div id="dialog-content"></div></dialog>
  `
  const chartsToRender = activeTab === 'forecast'
    ? blocks.filter((block) => block.data).map((block) => ({ id: String(block.id), data: block.data!, mode: block.mode }))
    : favorites.filter((item) => item.data).map((item) => ({ id: `fav-${favorites.indexOf(item)}`, data: item.data!, mode: item.mode }))
  for (const chart of chartsToRender) renderChart(chart.id, chart.data, chart.mode)
  void mountWeatherAnimations()
  bindEvents()
}

function showToast(message: string): void {
  const toast = document.getElementById('toast')
  if (!toast) return
  toast.textContent = message
  toast.classList.add('visible')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2600)
}

function openDialog(content: string, action: (() => void) | null = null): void {
  const dialog = document.getElementById('app-dialog') as HTMLDialogElement | null
  const target = document.getElementById('dialog-content')
  if (!dialog || !target) return
  modalAction = action
  target.innerHTML = content
  dialog.showModal()
  bindDialogEvents()
}

function askToRemoveBlock(id: number): void {
  openDialog(`
    <div class="dialog-icon danger"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></div><h2>${t('removeTitle')}</h2>
    <p class="dialog-description">${t('removeText')}</p>
    <div class="dialog-buttons"><button class="secondary-button" data-dialog-cancel type="button">${t('cancel')}</button>
    <button class="danger-button" data-dialog-confirm type="button">${t('confirm')}</button></div>
  `, () => {
    blocks = blocks.filter((block) => block.id !== id)
    render()
  })
}

function showFavoriteLimit(city: City): void {
  openDialog(`
    <button class="dialog-close" type="button" aria-label="${t('cancel')}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    <div class="dialog-icon"><i class="fa-solid fa-star" aria-hidden="true"></i></div><p class="eyebrow">${t('favorites')}</p><h2>${t('limitTitle')}</h2>
    <p class="dialog-description">${t('limitText').replace('{city}', escapeHtml(city.name))}</p>
    <button class="add-button full-button" data-dialog-favorites type="button">${t('favorites')}</button>
  `)
}

function bindDialogEvents(): void {
  const dialog = document.getElementById('app-dialog') as HTMLDialogElement | null
  if (!dialog) return
  dialog.querySelector('.dialog-close')?.addEventListener('click', () => dialog.close())
  dialog.querySelector('[data-dialog-cancel]')?.addEventListener('click', () => dialog.close())
  dialog.querySelector('[data-dialog-confirm]')?.addEventListener('click', () => {
    dialog.close()
    modalAction?.()
    modalAction = null
  })
  dialog.querySelector('[data-dialog-favorites]')?.addEventListener('click', () => {
    dialog.close()
    activeTab = 'favorites'
    render()
  })
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close()
  }, { once: true })
}

async function queryCities(query: string, blockId: string): Promise<void> {
  const sequence = (searchSequences.get(blockId) || 0) + 1
  searchSequences.set(blockId, sequence)
  const target = document.getElementById(`suggestions-${blockId}`)
  if (!target || query.trim().length < 2) {
    if (target) target.innerHTML = ''
    return
  }
  try {
    const cities = await fetchJson<City[]>(getApiUrl('/geo/1.0/direct', { q: query.trim(), limit: '5' }, apiKey, language))
    if (searchSequences.get(blockId) !== sequence) return
    const currentTarget = document.getElementById(`suggestions-${blockId}`)
    if (currentTarget) currentTarget.innerHTML = cities.length
      ? suggestionMarkup(cities)
      : `<div class="suggestion-message">${t('cityError')}</div>`
  } catch {
    if (searchSequences.get(blockId) !== sequence) return
    const currentTarget = document.getElementById(`suggestions-${blockId}`)
    if (currentTarget) currentTarget.innerHTML = `<div class="suggestion-message">${t('searchError')}</div>`
  }
}

async function selectCity(city: City, id: number): Promise<void> {
  const block = blocks.find((item) => item.id === id)
  if (!block) return
  block.city = city
  block.data = null
  block.error = ''
  block.loading = true
  render()
  await reloadBlock(block)
}

async function reloadBlock(block: WeatherBlock): Promise<void> {
  if (!block.city || !apiKey) return
  block.loading = true
  block.error = ''
  render()
  try {
    block.data = await loadWeather(block.city)
  } catch (error) {
    block.error = error instanceof Error ? error.message : t('apiError')
  } finally {
    block.loading = false
    render()
  }
}

async function reloadFavorite(item: Favorite): Promise<void> {
  if (!apiKey) return
  item.loading = true
  item.error = ''
  render()
  try {
    item.data = await loadWeather(item.city)
  } catch (error) {
    item.error = error instanceof Error ? error.message : t('apiError')
  } finally {
    item.loading = false
    render()
  }
}

async function detectDefaultCity(): Promise<void> {
  try {
    const response = await fetch('https://ipapi.co/json/')
    if (!response.ok) throw new Error(`Location lookup failed (${response.status}).`)
    const location = await response.json() as { city?: string; country_code?: string; latitude?: number; longitude?: number }
    if (!location.city || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') throw new Error(t('ipError'))
    if (blocks[0].city) return
    const city: City = { name: location.city, country: location.country_code || '', lat: location.latitude, lon: location.longitude }
    blocks[0].city = city
    if (apiKey) await reloadBlock(blocks[0])
    else render()
  } catch {
    if (apiKey) showToast(t('ipError'))
  }
}

function toggleFavorite(block: WeatherBlock): void {
  if (!block.city) return
  const index = favorites.findIndex((item) => item.city.lat === block.city!.lat && item.city.lon === block.city!.lon)
  if (index >= 0) {
    favorites.splice(index, 1)
  } else {
    if (favorites.length >= 5) {
      showFavoriteLimit(block.city)
      return
    }
    favorites.push({ city: block.city, data: block.data, loading: false, error: '', mode: 'day' })
  }
  persistFavorites(favorites)
  render()
}

function bindEvents(): void {
  app!.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      activeTab = button.dataset.tab as 'forecast' | 'favorites'
      if (activeTab === 'favorites') {
        for (const item of favorites) if (!item.data && !item.loading && apiKey) void reloadFavorite(item)
      }
      render()
    })
  })
  app!.querySelectorAll<HTMLInputElement>('[data-search]').forEach((input) => {
    input.addEventListener('input', () => {
      const id = input.dataset.search!
      window.clearTimeout(searchTimers.get(id))
      searchTimers.set(id, window.setTimeout(() => void queryCities(input.value, id), 280))
    })
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        const suggestions = document.getElementById(`suggestions-${input.dataset.search}`)
        if (suggestions) suggestions.innerHTML = ''
      }
    })
  })
  app!.onclick = (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest<HTMLButtonElement>('[data-city]')
    if (!button) return
    const city = JSON.parse(button.dataset.city!) as City
    const searchId = button.closest('.search-wrap')?.querySelector<HTMLInputElement>('[data-search]')?.dataset.search
    if (searchId) void selectCity(city, Number(searchId))
  }
  app!.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.mode!
      const mode = button.dataset.value as 'day' | 'week'
      if (id.startsWith('fav-')) {
        const index = Number(id.slice(4))
        if (favorites[index]) favorites[index].mode = mode
      } else {
        const block = blocks.find((item) => item.id === Number(id))
        if (block) block.mode = mode
      }
      render()
    })
  })
  app!.querySelectorAll<HTMLButtonElement>('[data-favorite]').forEach((button) => {
    button.addEventListener('click', () => {
      const block = blocks.find((item) => item.id === Number(button.dataset.favorite))
      if (block) toggleFavorite(block)
    })
  })
  app!.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => askToRemoveBlock(Number(button.dataset.remove)))
  })
  app!.querySelectorAll<HTMLButtonElement>('[data-remove-favorite]').forEach((button) => {
    button.addEventListener('click', () => {
      favorites.splice(Number(button.dataset.removeFavorite), 1)
      persistFavorites(favorites)
      render()
    })
  })
  document.getElementById('add-block')?.addEventListener('click', () => {
    if (blocks.length >= 5) return
    blocks.push({ id: nextBlockId++, city: null, data: null, loading: false, error: '', mode: 'day' })
    render()
  })
  document.getElementById('language-button')?.addEventListener('click', () => {
    language = language === 'uk' ? 'en' : 'uk'
    localStorage.setItem('weather-language', language)
    render()
    for (const block of blocks) if (block.city) void reloadBlock(block)
    for (const item of favorites) if (item.data) void reloadFavorite(item)
  })
  document.getElementById('theme-button')?.addEventListener('click', () => {
    document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'night' ? 'day' : 'night'
    localStorage.setItem('weather-theme', document.documentElement.dataset.theme)
    render()
  })
}

document.documentElement.dataset.theme = localStorage.getItem('weather-theme') === 'night' ? 'night' : 'day'
render()
void detectDefaultCity()
