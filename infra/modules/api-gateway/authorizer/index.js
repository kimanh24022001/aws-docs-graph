const { createRemoteJWKSet, jwtVerify } = require('jose');

let JWKS;

function getJWKS() {
  if (!JWKS) {
    const supabaseUrl = process.env.SUPABASE_URL;
    if (!supabaseUrl) {
      console.error('SUPABASE_URL environment variable is not set');
      return null;
    }
    JWKS = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
  }
  return JWKS;
}

exports.handler = async (event) => {
  const token = event.authorizationToken?.replace('Bearer ', '');
  if (!token) return denyAllPolicy();

  const jwks = getJWKS();
  if (!jwks) return denyAllPolicy();

  try {
    const { payload } = await jwtVerify(token, jwks, { algorithms: ['RS256'] });
    return allowPolicy(event.methodArn, payload.sub, payload.email);
  } catch (err) {
    console.error('JWT verification failed:', err.code || err.message);
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
