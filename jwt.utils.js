const jwt = require('jsonwebtoken');
const generateToken = (payload, secret_key) => {
  return jwt.sign(payload, secret_key);
};

const verifyToken = (token, secret_key) => {
  try {
    return jwt.verify(token, secret_key);
  } catch (error) {
    return null;
  }
};

module.exports = { generateToken, verifyToken };