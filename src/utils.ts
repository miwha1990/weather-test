import type { City, DailyForecast, Favorite, Language, WeatherData } from './types'

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!)
}

export function readFavorites(): City[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem('weather-favorites') || '[]')
    if (!Array.isArray(stored)) return []
    return stored.filter((city): city is City =>
      city !== null
      && typeof city === 'object'
      && typeof city.name === 'string'
      && typeof city.country === 'string'
      && typeof city.lat === 'number'
      && typeof city.lon === 'number',
    ).slice(0, 5)
  } catch {
    return []
  }
}

export function persistFavorites(favorites: Favorite[]): void {
  localStorage.setItem('weather-favorites', JSON.stringify(favorites.map(({ city }) => city)))
}

export function getApiUrl(
  path: string,
  params: Record<string, string>,
  apiKey: string,
  language: Language,
): string {
  const search = new URLSearchParams({ ...params, appid: apiKey, lang: language })
  return `https://api.openweathermap.org${path}?${search.toString()}`
}

export function cityLabel(city: City): string {
  return [city.name, city.state, city.country].filter(Boolean).join(', ')
}

export function formatLocalTime(
  timestamp: number,
  timezone: number,
  language: Language,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(language === 'uk' ? 'uk-UA' : 'en-US', {
    ...options,
    timeZone: 'UTC',
  }).format(new Date((timestamp + timezone) * 1000))
}

export function localDateKey(timestamp: number, timezone: number): string {
  const date = new Date((timestamp + timezone) * 1000)
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`
}

export function getDailyForecast(
  data: WeatherData,
  language: Language,
  todayLabel: string,
): DailyForecast[] {
  const groups = new Map<string, WeatherData['forecast']['list']>()
  for (const point of data.forecast.list) {
    const key = localDateKey(point.dt, data.current.timezone)
    const group = groups.get(key) || []
    group.push(point)
    groups.set(key, group)
  }
  return [...groups.values()].slice(0, 5).map((points, index) => {
    const midday = points.reduce((closest, point) =>
      Math.abs(Number(point.dt_txt.slice(11, 13)) - 12) < Math.abs(Number(closest.dt_txt.slice(11, 13)) - 12)
        ? point
        : closest,
    )
    const average = points.reduce((sum, point) => sum + point.main.temp, 0) / points.length
    return {
      date: localDateKey(midday.dt, data.current.timezone),
      label: index === 0
        ? todayLabel
        : formatLocalTime(midday.dt, data.current.timezone, language, { weekday: 'short' }),
      temp: average,
      icon: midday.weather[0]?.icon || '01d',
      description: midday.weather[0]?.description || '',
    }
  })
}

export function weatherIcon(icon: string): string {
  return `https://openweathermap.org/img/wn/${encodeURIComponent(icon)}@2x.png`
}
