const isAllowedOrigin = () => true;

const corsOrigin = (_origin, callback) => {
  // Reflect the request origin because browsers reject "*" with credentials.
  callback(null, true);
};

module.exports = { corsOrigin, isAllowedOrigin };