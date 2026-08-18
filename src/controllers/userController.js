// src/controllers/userController.js
const profilePictureController = require('./user/profilePicture.controller');
const profileInfoController = require('./user/profileInfo.controller');

module.exports = {
  ...profileInfoController,
  ...profilePictureController,
};
