'use strict';

const fp = require('fastify-plugin');
const client = require('openid-client');
const { setSessionUser } = require('../session-user');

/**
 * @param {unknown} memberOf
 * @returns {string[]}
 */
function commonNamesFromMemberOf(memberOf) {
  const values = Array.isArray(memberOf)
    ? memberOf
    : memberOf
      ? [memberOf]
      : [];

  return values.flatMap((value) => {
    if (typeof value !== 'string') {
      return [];
    }
    const match = value.match(/(?:^|,)\s*CN=((?:\\.|[^,])+)/i);
    if (!match) {
      return [];
    }
    const name = match[1].replace(/\\(.)/g, '$1').trim();
    return name ? [name] : [];
  });
}

/**
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{ prefix: string, oidc: NonNullable<import('../index').AuthConfig['oidc']> }} opts
 */
async function registerOidcProvider(fastify, { prefix, oidc }) {
  const config = await client.discovery(
    new URL(oidc.issuer),
    oidc.clientId,
    oidc.clientSecret
  );

  const usePKCE = config.serverMetadata().supportsPKCE();

  /** @param {import('fastify').FastifyRequest} req */
  const callbackUrl = (req) =>
    oidc.redirectUri || `${req.protocol}://${req.host}${prefix}/auth/callback`;

  fastify.get(`${prefix}/auth/login/oidc`, async (req, reply) => {
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const nonce = client.randomNonce();
    const state = client.randomState();

    /** @type {Record<string, string>} */
    const parameters = {
      redirect_uri: callbackUrl(req),
      scope: oidc.scope,
      nonce,
      state,
    };

    if (usePKCE) {
      parameters.code_challenge = codeChallenge;
      parameters.code_challenge_method = 'S256';
    }

    req.session.set('oidc_tx', {
      codeVerifier,
      state,
      nonce,
      returnTo:
        typeof req.query.returnTo === 'string'
          ? req.query.returnTo
          : `${prefix}/`,
    });

    const url = client.buildAuthorizationUrl(config, parameters);
    return reply.redirect(url.href);
  });

  fastify.get(`${prefix}/auth/callback`, async (req, reply) => {
    const tx = req.session.get('oidc_tx');
    if (!tx) {
      reply.code(400).send({ error: 'No login transaction in progress' });
      return;
    }

    const currentUrl = new URL(`${req.protocol}://${req.host}${req.url}`);

    try {
      const tokens = await client.authorizationCodeGrant(config, currentUrl, {
        pkceCodeVerifier: usePKCE ? tx.codeVerifier : undefined,
        expectedState: tx.state,
        expectedNonce: tx.nonce,
      });

      const claims = tokens.claims() ?? {};

      if (oidc.allowedGroups) {
        const groups = claims[oidc.groupsClaim];
        const groupList = Array.isArray(groups)
          ? groups
          : groups
          ? [groups]
          : [];
        const allowed = oidc.allowedGroups.some((g) => groupList.includes(g));
        if (!allowed) {
          const groupNames = commonNamesFromMemberOf(claims.memberOf);
          const message = `You are not a member of an authorized groups ${oidc.allowedGroups}.\n\nYour groups: ${groupNames.join(', ') || '(none)'}`;
          req.session.delete();
          reply.redirect(
            `${prefix}/auth/login?error=${encodeURIComponent(message)}`
          );
          return;
        }
      }

      setSessionUser(req, {
        id: claims.sub,
        username: claims.preferred_username ?? claims.email ?? claims.sub,
        name: claims.name ?? claims.preferred_username ?? claims.sub,
        email: claims.email,
        roles: ['user'],
        provider: 'oidc',
      });
      req.session.set('id_token', tokens.id_token);
      req.session.set('oidc_tx', undefined);

      return reply.redirect(tx.returnTo || `${prefix}/`);
    } catch (err) {
      req.log.error({ err }, 'OIDC callback failed');
      req.session.delete();
      return reply.redirect(
        `${prefix}/auth/login?error=${encodeURIComponent('SSO sign-in failed')}`
      );
    }
  });

  fastify.decorate('oidcConfig', config);
  fastify.log.info(`OIDC provider enabled (issuer: ${oidc.issuer})`);
}

module.exports = fp(registerOidcProvider, { name: 'auth-oidc' });
