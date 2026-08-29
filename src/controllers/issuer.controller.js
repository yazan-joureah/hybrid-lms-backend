// src/controllers/issuer.controller.js
const { getIssuerProfile } = require('../services/cert/credential.service');

function getProfile(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).json(getIssuerProfile());
}

module.exports = { getProfile };
