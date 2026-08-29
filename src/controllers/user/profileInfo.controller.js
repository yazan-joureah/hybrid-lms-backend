const userService = require('../../services/userService');

async function getMe(req, res, next) {
  try {
    const userData = await userService.getUserProfile({ userId: req.user.id });
    return res.status(200).json({ success: true, data: userData });
  } catch (err) {
    next(err);
  }
}

async function updateMe(req, res, next) {
  try {
    const userData = await userService.updateUserProfile({
      userId: req.user.id,
      updates: req.validatedBody,
      req,
    });
    return res.status(200).json({ success: true, data: userData });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMe, updateMe };
