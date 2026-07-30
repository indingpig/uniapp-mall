export const requestConfig = {
  baseURL: import.meta.env.VITE_API_BASE_URL, // Base URL for API requests
  timeout: 5000, // Request timeout in milliseconds
  headers: {
    'Content-Type': 'application/json', // Default content type for requests
  },
};
