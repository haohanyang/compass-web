'use strict';

const assert = require('assert');
const {
  createAuthTestApp,
  loginViaOidcCallback,
  resetOidcTestState,
  setMockTokenClaims,
} = require('./test-helpers');

describe('OIDC auth routes', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app;

  beforeEach(async () => {
    resetOidcTestState();
    app = await createAuthTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('renders the login page for unauthenticated users', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/login?returnTo=%2F',
      headers: { accept: 'text/html' },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.match(res.body, /Sign in/);
    assert.match(res.body, /Test App/);
    assert.match(res.body, /auth\/login\/oidc\?returnTo=%2F/);
  });

  it('redirects authenticated users away from the login page', async () => {
    const { cookie } = await loginViaOidcCallback(app);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/login',
      headers: { cookie },
    });

    assert.strictEqual(res.statusCode, 302);
    assert.strictEqual(res.headers.location, '/');
  });

  it('shows login errors passed through the query string', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/login?error=SSO%20sign-in%20failed',
      headers: { accept: 'text/html' },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.match(res.body, /SSO sign-in failed/);
  });

  it('returns 401 from /auth/me when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' });

    assert.strictEqual(res.statusCode, 401);
    assert.deepStrictEqual(res.json(), { error: 'Unauthenticated' });
  });

  it('returns the session user from /auth/me when authenticated', async () => {
    const { cookie } = await loginViaOidcCallback(app);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.json(), {
      user: {
        id: 'user-1',
        username: 'alice',
        name: 'Alice',
        email: 'alice@example.com',
        roles: ['user'],
        provider: 'oidc',
      },
    });
  });

  it('starts OIDC login by redirecting to the identity provider', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/login/oidc?returnTo=%2Fdashboard',
    });

    assert.strictEqual(res.statusCode, 302);
    assert.match(
      res.headers.location,
      /^https:\/\/idp\.example\.com\/auth\?state=/
    );
    assert.ok(res.headers['set-cookie']);
  });

  it('rejects callback requests without a pending OIDC transaction', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/callback?code=test-code&state=test-state',
    });

    assert.strictEqual(res.statusCode, 400);
    assert.deepStrictEqual(res.json(), {
      error: 'No login transaction in progress',
    });
  });

  it('completes the OIDC callback and stores the authenticated user', async () => {
    const { callback, cookie } = await loginViaOidcCallback(app);

    assert.strictEqual(callback.statusCode, 302);
    assert.strictEqual(callback.headers.location, '/');

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie },
    });

    assert.strictEqual(me.statusCode, 200);
    assert.strictEqual(me.json().user.username, 'alice');
  });

  it('redirects to the requested returnTo URL after callback', async () => {
    const start = await app.inject({
      method: 'GET',
      url: '/auth/login/oidc?returnTo=%2Fdashboard',
    });

    const callback = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=test-code&state=${encodeURIComponent(
        oidcStateFromStart(start)
      )}`,
      headers: { cookie: start.headers['set-cookie'] },
    });

    assert.strictEqual(callback.statusCode, 302);
    assert.strictEqual(callback.headers.location, '/dashboard');
  });

  it('rejects users who are not in an allowed group', async () => {
    await app.close();
    resetOidcTestState();
    app = await createAuthTestApp({
      oidc: { allowedGroups: ['admins'] },
    });
    setMockTokenClaims({
      sub: 'user-2',
      preferred_username: 'bob',
      email: 'bob@example.com',
      groups: ['viewers'],
      memberOf: [
        'CN=Viewers,OU=Groups,DC=example,DC=com',
        'cn=Ops\\, Team,OU=Groups,DC=example,DC=com',
      ],
    });

    const { callback } = await loginViaOidcCallback(app);

    assert.strictEqual(callback.statusCode, 302);
    const location = decodeURIComponent(callback.headers.location);
    assert.match(
      location,
      /\/auth\/login\?error=You are not a member of an authorized group\. Groups: Viewers, Ops, Team/
    );
    assert.doesNotMatch(location, /OU=Groups|bob@example.com|preferred_username/);

    const me = await app.inject({ method: 'GET', url: '/auth/me' });
    assert.strictEqual(me.statusCode, 401);
  });

  it('accepts users when allowedGroups matches a string claim', async () => {
    await app.close();
    resetOidcTestState();
    app = await createAuthTestApp({
      oidc: { allowedGroups: ['admins'], groupsClaim: 'role' },
    });
    setMockTokenClaims({
      sub: 'user-3',
      preferred_username: 'carol',
      role: 'admins',
    });

    const { cookie } = await loginViaOidcCallback(app);
    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie },
    });

    assert.strictEqual(me.statusCode, 200);
    assert.strictEqual(me.json().user.username, 'carol');
  });

  it('redirects to login when the OIDC callback fails', async () => {
    await app.close();
    resetOidcTestState();
    app = await createAuthTestApp({
      openIdClientOverrides: {
        authorizationCodeGrant: async () => {
          throw new Error('invalid_grant');
        },
      },
    });

    const start = await app.inject({
      method: 'GET',
      url: '/auth/login/oidc',
    });

    const callback = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=bad&state=${encodeURIComponent(
        oidcStateFromStart(start)
      )}`,
      headers: { cookie: start.headers['set-cookie'] },
    });

    assert.strictEqual(callback.statusCode, 302);
    assert.match(callback.headers.location, /error=SSO%20sign-in%20failed/);
  });

  it('logs out OIDC users through the identity provider end-session endpoint', async () => {
    const { cookie } = await loginViaOidcCallback(app);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/logout',
      headers: { cookie },
    });

    assert.strictEqual(res.statusCode, 302);
    assert.match(res.headers.location, /^https:\/\/idp\.example\.com\/logout/);

    const me = await app.inject({ method: 'GET', url: '/auth/me' });
    assert.strictEqual(me.statusCode, 401);
  });

  it('falls back to the login page when end-session is unavailable', async () => {
    await app.close();
    resetOidcTestState();
    app = await createAuthTestApp({
      openIdClientOverrides: {
        buildEndSessionUrl: () => {
          throw new Error('no end_session_endpoint');
        },
      },
    });

    const { cookie } = await loginViaOidcCallback(app);
    const res = await app.inject({
      method: 'GET',
      url: '/auth/logout',
      headers: { cookie },
    });

    assert.strictEqual(res.statusCode, 302);
    assert.strictEqual(res.headers.location, '/auth/login');
  });
});

describe('OIDC auth guard', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app;

  beforeEach(async () => {
    resetOidcTestState();
    app = await createAuthTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows unauthenticated access to health checks', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    assert.strictEqual(res.statusCode, 200);
  });

  it('returns 401 for unauthenticated API requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/protected' });
    assert.strictEqual(res.statusCode, 401);
    assert.deepStrictEqual(res.json(), { error: 'Unauthenticated' });
  });

  it('redirects unauthenticated HTML requests to the login page', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { accept: 'text/html' },
    });

    assert.strictEqual(res.statusCode, 302);
    assert.strictEqual(
      res.headers.location,
      '/auth/login?returnTo=%2Fprotected'
    );
  });

  it('allows authenticated users to reach protected routes', async () => {
    const { cookie } = await loginViaOidcCallback(app);

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.json(), { ok: true });
  });
});

describe('OIDC auth with base route', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app;

  beforeEach(async () => {
    resetOidcTestState();
    app = await createAuthTestApp({ baseRoute: 'compass' });
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves auth routes under the configured base route', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/compass/auth/login',
      headers: { accept: 'text/html' },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.match(res.body, /compass\/auth\/login\/oidc/);
  });

  it('authenticates users through the prefixed callback route', async () => {
    const { cookie } = await loginViaOidcCallback(app, '/compass');
    const me = await app.inject({
      method: 'GET',
      url: '/compass/auth/me',
      headers: { cookie },
    });

    assert.strictEqual(me.statusCode, 200);
    assert.strictEqual(me.json().user.username, 'alice');
  });
});

/**
 * @param {import('light-my-request').Response} startResponse
 */
function oidcStateFromStart(startResponse) {
  const location = startResponse.headers.location;
  assert.ok(location);
  return new URL(location).searchParams.get('state');
}
