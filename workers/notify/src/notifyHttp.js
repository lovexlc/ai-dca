import { CLIENT_SECRET_HEADER } from './clientSettings.js';

export function jsonResponse(payload, { status = 200, origin = '*' } = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': `content-type, ${CLIENT_SECRET_HEADER}`
    }
  });
}

export function emptyResponse({ status = 204, origin = '*' } = {}) {
  return new Response(null, {
    status,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': `content-type, ${CLIENT_SECRET_HEADER}`
    }
  });
}

export function readOrigin(request) {
  return request.headers.get('origin') || '*';
}
