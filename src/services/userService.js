const profileService = require('./user/profileInfo.service');
const profilePictureService = require('./user/profilePicture.service');

module.exports = {
  ...profileService,
  ...profilePictureService,
};
