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

// Response interceptor — handle 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default api
