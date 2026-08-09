// src/controllers/user/profilePicture.controller.js
const userService = require('../../services/userService');

/** authenticated user replaces their own profile picture. */
async function setMine(req, res, next) {
  try {
    const userId = req.user.id;
    const result = await userService.setProfilePicture({ userId, file: req.file, req });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** streams any user's profile picture by ID  */
async function stream(req, res, next) {
  try {
    const { userId } = req.params;
    const {
      stream: fileStream,
      contentType,
      filename,
    } = await userService.streamProfilePicture({ userId });

    res.set('Content-Type', contentType);
    res.set('Content-Disposition', `inline; filename="${filename}"`);
    fileStream.pipe(res);
  } catch (err) {
    return next(err);
  }
}

module.exports = { setMine, stream };
