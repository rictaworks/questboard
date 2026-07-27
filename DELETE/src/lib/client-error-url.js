export function sanitizeClientErrorUrl(href) {
  const url = new URL(href);
  const segments = url.pathname.split('/');
  const boardIndex = segments.indexOf('b');

  if (boardIndex !== -1 && segments[boardIndex + 1]) {
    segments[boardIndex + 1] = '[redacted]';
    url.pathname = segments.join('/');
  }

  url.search = '';
  url.hash = '';
  return url.pathname;
}
