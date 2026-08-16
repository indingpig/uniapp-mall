export function joinURL(baseURL: string, url: string) {
  if (!baseURL)
    return url;
  return `${baseURL.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
}
