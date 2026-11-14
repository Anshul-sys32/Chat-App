const validateWhiteboardStroke = (payload = {}) => {
  const { groupId, points, color, width, finished } = payload;
  if (!Number.isSafeInteger(Number(groupId)) || Number(groupId) < 1 || !Array.isArray(points)
    || (finished !== true && points.length < 1) || points.length > 150
    || points.some((point) => !point || !Number.isFinite(point.x) || point.x < 0 || point.x > 1000
      || !Number.isFinite(point.y) || point.y < 0 || point.y > 600)
    || typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)
    || !Number.isFinite(width) || width < 1 || width > 18) return false;
  return true;
};

module.exports = { validateWhiteboardStroke };
