import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
})

/**
 * Request interceptor — attach PairPath's own JWT.
 *
 * Two tokens live in localStorage and they are not interchangeable:
 *
 *   'token'                 PairPath's JWT. The only one this API and the
 *                           Socket.IO gateway accept, because every foreign
 *                           key here points at the local users.id.
 *   'codeguru.accessToken'  The Code Coach platform token, kept by
 *                           codeguru-auth. Used to obtain the above via
 *                           POST /auth/exchange, and available for calling
 *                           Code Coach's own /api/v1/... endpoints directly.
 *
 * Sending the platform token to this API would fail signature verification.
 */
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
  }
  return config
})

/**
 * Response interceptor — a 401 means the PairPath session is gone, so clear it
 * and send them to sign in again.
 *
 * With one exception: /auth/exchange. That endpoint IS the sign-in, and a 401
 * from it means the platform token was refused — which PlatformSessionGate
 * handles, telling the student whether to retry or sign in again. Redirecting
 * from here as well sent them to /login, which redirects to the portal, which
 * hands back another token, which fails the same way: an infinite loop, purely
 * because two pieces of code both tried to handle the same failure.
 */
const EXCHANGE_PATH = '/auth/exchange'

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const isExchange = (error.config?.url || '').includes(EXCHANGE_PATH)

    if (error.response?.status === 401 && !isExchange && typeof window !== 'undefined') {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default api
