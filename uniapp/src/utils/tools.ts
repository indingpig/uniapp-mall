export function joinURL(baseURL: string, url: string) {
  return `${baseURL.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
}
