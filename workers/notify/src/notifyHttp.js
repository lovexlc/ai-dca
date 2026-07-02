import { CLIENT_ACCOUNT_USERNAME_HEADER, CLIENT_SECRET_HEADER } from './clientSettings.js';

const CORS_ALLOW_HEADERS = [
  'content-type',
  'authorization',
  'x-admin-token',
  CLIENT_SECRET_HEADER,
  CLIENT_ACCOUNT_USERNAME_HEADER
].join(', ');

export function jsonResponse(payload, { status = 200, origin = '*' } = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
      'access-control-allow-headers': CORS_ALLOW_HEADERS
    }
  });
}

export function emptyResponse({ status = 204, origin = '*' } = {}) {
  return new Response(null, {
    status,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
      'access-control-allow-headers': CORS_ALLOW_HEADERS
    }
  });
}

export function readOrigin(request) {
  return request.headers.get('origin') || '*';
}
