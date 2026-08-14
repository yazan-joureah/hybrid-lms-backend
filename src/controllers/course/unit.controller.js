// src/controllers/course/unit.controller.js
const {
  addUnit,
  updateUnit,
  deleteUnit,
  reorderUnits,
  getUnitDetails,
  listUnitsForUser,
} = require('../../services/courseService');

async function createUnit(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId } = req.params;
    const { title, desc } = req.body;

    const result = await addUnit({ courseId, instructorId, unitData: { title, desc }, req });

    return res.status(201).json({
      success: true,
      message: 'Unit added successfully.',
      data: { unit: result.data.unit },
    });
  } catch (err) {
    return next(err);
  }
}

async function updateOneUnit(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId, unitId } = req.params;
    const { title, desc } = req.body;

    const updateData = Object.fromEntries(
      Object.entries({ title, desc }).filter(([_, v]) => v !== undefined)
    );

    const result = await updateUnit({ courseId, unitId, instructorId, updateData, req });

    return res.status(200).json({
      success: true,
      message: 'Unit updated successfully.',
      data: { unit: result.data.unit },
    });
  } catch (err) {
    return next(err);
  }
}

async function removeUnit(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId, unitId } = req.params;
    await deleteUnit({ courseId, unitId, instructorId, req });
    return res.status(200).json({ success: true, message: 'Unit deleted successfully.' });
  } catch (err) {
    return next(err);
  }
}

async function reorderUnit(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId } = req.params;
    const result = await reorderUnits({
      courseId,
      instructorId,
      orderedUnitIds: req.body.ordered_unit_ids,
      req,
    });
    return res.status(200).json({ success: true, data: { units: result.data.units } });
  } catch (err) {
    return next(err);
  }
}

/** Unified role-aware unit list read */
async function listUnits(req, res, next) {
  try {
    const userId = req.user?.id;
    const role = req.verifiedRole || req.user?.role;
    const { courseId } = req.params;

    const result = await listUnitsForUser({ userId, role, courseId });

    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** Unified read — Student/Instructor/Admin/Guest, single code path. */
async function getOneUnit(req, res, next) {
  try {
    const userId = req.user?.id;
    const role = req.verifiedRole || req.user?.role;
    const { courseId, unitId } = req.params;

    const result = await getUnitDetails({ userId, role, courseId, unitId });

    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createUnit,
  getOneUnit,
  updateOneUnit,
  removeUnit,
  reorderUnit,
  listUnits,
};
