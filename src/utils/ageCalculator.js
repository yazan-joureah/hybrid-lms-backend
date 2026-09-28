/**
 * Pure function — computes age in full years from a birth date.
 */

function calculateAge(birthDate, referenceDate = new Date()) {
  const birth = new Date(birthDate);
  let age = referenceDate.getFullYear() - birth.getFullYear();
  const monthDiff = referenceDate.getMonth() - birth.getMonth();
  const dayDiff = referenceDate.getDate() - birth.getDate();

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }
  return age;
}

function isMinor(birthDate, referenceDate = new Date()) {
  return calculateAge(birthDate, referenceDate) < 18;
}

module.exports = { calculateAge, isMinor };
