export type Language = 'en' | 'uk'
export type WeatherMode = 'day' | 'week'

export type City = {
  name: string
  country: string
  state?: string
  lat: number
  lon: number
}

export type CurrentWeather = {
  name: string
  timezone: number
  main: { temp: number; feels_like: number; humidity: number }
  wind: { speed: number }
  weather: Array<{ description: string; icon: string; main: string }>
}

export type ForecastPoint = {
  dt: number
  main: { temp: number }
  weather: Array<{ description: string; icon: string }>
  dt_txt: string
}

export type ForecastWeather = { list: ForecastPoint[]; city: { timezone: number } }
export type WeatherData = { current: CurrentWeather; forecast: ForecastWeather }
export type DailyForecast = {
  date: string
  label: string
  temp: number
  icon: string
  description: string
}

export type WeatherBlock = {
  id: number
  city: City | null
  data: WeatherData | null
  loading: boolean
  error: string
  mode: WeatherMode
}

export type Favorite = {
  city: City
  data: WeatherData | null
  loading: boolean
  error: string
  mode: WeatherMode
}
