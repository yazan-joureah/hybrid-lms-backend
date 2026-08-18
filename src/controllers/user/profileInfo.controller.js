const userService = require('../../services/userService');

async function getMe(req, res, next) {
  try {
    const userData = await userService.getUserProfile({ userId: req.user.id });
    return res.status(200).json({ success: true, data: userData });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMe };
