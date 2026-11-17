'use strict';

const assert = require('assert');
const { readCliArgs } = require('./cli');

const originalArgv = process.argv;
const sessionSecret = 'x'.repeat(32);

function withArgv(args, fn) {
  process.argv = ['node', 'compass-web', ...args];
  try {
    return fn();
  } finally {
    process.argv = originalArgv;
  }
}

describe('readCliArgs connections dir', () => {
  it('leaves connectionsDir unset by default', () => {
    withArgv(['--mongo-uri', 'mongodb://localhost:27017'], () => {
      const args = readCliArgs();
      assert.strictEqual(args.connectionsDir, undefined);
    });
  });

  it('reads --connections-dir', () => {
    withArgv(['--connections-dir', '/data/credentials'], () => {
      const args = readCliArgs();
      assert.strictEqual(args.connectionsDir, '/data/credentials');
    });
  });

  it('reads CW_CONNECTIONS_DIR', () => {
    process.env.CW_CONNECTIONS_DIR = '/var/lib/compass';
    try {
      withArgv([], () => {
        const args = readCliArgs();
        assert.strictEqual(args.connectionsDir, '/var/lib/compass');
      });
    } finally {
      delete process.env.CW_CONNECTIONS_DIR;
    }
  });
});

describe('readCliArgs OIDC auth', () => {
  it('leaves auth null when OIDC is not configured', () => {
    withArgv(['--mongo-uri', 'mongodb://localhost:27017'], () => {
      const args = readCliArgs();
      assert.strictEqual(args.auth, null);
    });
  });

  it('enables OIDC auth when issuer and client id are set', () => {
    withArgv(
      [
        '--oidc-issuer',
        'https://idp.example.com/realms/r',
        '--oidc-client-id',
        'compass-web',
        '--oidc-client-secret',
        'secret',
        '--session-secret',
        sessionSecret,
      ],
      () => {
        const args = readCliArgs();
        assert.ok(args.auth);
        assert.strictEqual(
          args.auth.oidc.issuer,
          'https://idp.example.com/realms/r'
        );
        assert.strictEqual(args.auth.oidc.clientId, 'compass-web');
      }
    );
  });

  it('throws when session-secret is missing for OIDC', () => {
    withArgv(
      ['--oidc-issuer', 'https://idp.example.com', '--oidc-client-id', 'cw'],
      () => {
        assert.throws(() => readCliArgs(), /session-secret/);
      }
    );
  });

  it('throws when oidc-client-id is missing', () => {
    withArgv(['--oidc-issuer', 'https://idp.example.com'], () => {
      assert.throws(() => readCliArgs(), /oidc-client-id/);
    });
  });

  it('throws when oidc-issuer is missing', () => {
    withArgv(['--oidc-client-id', 'compass-web'], () => {
      assert.throws(() => readCliArgs(), /oidc-issuer/);
    });
  });

  it('throws when session-secret is too short', () => {
    withArgv(
      [
        '--oidc-issuer',
        'https://idp.example.com',
        '--oidc-client-id',
        'compass-web',
        '--session-secret',
        'too-short',
      ],
      () => {
        assert.throws(() => readCliArgs(), /session-secret/);
      }
    );
  });

  it('parses allowed groups and optional OIDC settings', () => {
    withArgv(
      [
        '--oidc-issuer',
        'https://idp.example.com/realms/r',
        '--oidc-client-id',
        'compass-web',
        '--oidc-client-secret',
        'secret',
        '--oidc-redirect-uri',
        'https://compass.example.com/auth/callback',
        '--oidc-post-logout-redirect-uri',
        'https://compass.example.com/auth/login',
        '--oidc-allowed-groups',
        ' admins , developers ',
        '--oidc-groups-claim',
        'roles',
        '--oidc-scope',
        'openid email',
        '--session-secret',
        sessionSecret,
      ],
      () => {
        const args = readCliArgs();
        assert.ok(args.auth);
        assert.deepStrictEqual(args.auth.oidc.allowedGroups, [
          'admins',
          'developers',
        ]);
        assert.strictEqual(args.auth.oidc.groupsClaim, 'roles');
        assert.strictEqual(args.auth.oidc.scope, 'openid email');
        assert.strictEqual(
          args.auth.oidc.redirectUri,
          'https://compass.example.com/auth/callback'
        );
        assert.strictEqual(
          args.auth.oidc.postLogoutRedirectUri,
          'https://compass.example.com/auth/login'
        );
        assert.strictEqual(args.auth.enabled, true);
        assert.strictEqual(args.auth.sessionRequired, true);
      }
    );
  });
});
