'use strict';

/**
 *
 * @param {import('fastify').FastifyInstance} instance
 */
function registerAuth(instance) {
  const basicAuth = instance.args.basicAuth;

  if (basicAuth) {
    instance.register(require('@fastify/basic-auth'), {
      validate: (username, password, _req, _reply, done) => {
        if (
          username === basicAuth.username &&
          password === basicAuth.password
        ) {
          done();
        } else {
          done(new Error('Authentication error'));
        }
      },
      authenticate: true,
    });
  }
}

module.exports = { registerAuth };
