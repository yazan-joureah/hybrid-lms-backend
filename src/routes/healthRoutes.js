/**
 * Health check endpoint — required for Render/Docker orchestration probes.
 */
const express = require('express');
const router = express.Router();

router.get('/health', (req, res) => {
  res
    .status(200)
    .json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

module.exports = router;
