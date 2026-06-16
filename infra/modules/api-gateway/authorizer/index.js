const { createRemoteJWKSet, jwtVerify } = require('jose');

const SUPABASE_URL = process.env.SUPABASE_URL;
const JWKS = createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`));

exports.handler = async (event) => {
  const token = event.authorizationToken?.replace('Bearer ', '');
  if (!token) return denyAllPolicy();

  try {
    const { payload } = await jwtVerify(token, JWKS, { algorithms: ['RS256', 'HS256'] });
    return allowPolicy(event.methodArn, payload.sub, payload.email);
  } catch {
    return denyAllPolicy();
  }
};

function allowPolicy(methodArn, userId, email) {
  const arnParts = methodArn.split(':');
  const region = arnParts[3];
  const accountId = arnParts[4];
  const apiParts = arnParts[5].split('/');
  const apiId = apiParts[0];
  const stage = apiParts[1];
  return {
    principalId: userId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Action: 'execute-api:Invoke', Resource: `arn:aws:execute-api:${region}:${accountId}:${apiId}/${stage}/*/*` }]
    },
    context: { userId, email }
  };
}

function denyAllPolicy() {
  return {
    principalId: 'unauthorized',
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{ Effect: 'Deny', Action: 'execute-api:Invoke', Resource: '*' }]
    }
  };
}
