const BUILT_IN_GROUP_ROLES = [
  { key: "admin", name: "Admin", permissions: { manageRoles: true, manageMembers: true, manageChannels: true, manageMessages: true, postMessages: true } },
  { key: "member", name: "Member", permissions: { manageRoles: false, manageMembers: false, manageChannels: false, manageMessages: false, postMessages: true } },
  { key: "moderator", name: "Moderator", permissions: { manageRoles: false, manageMembers: false, manageChannels: false, manageMessages: true, postMessages: true } },
  { key: "developer", name: "Developer", permissions: { manageRoles: false, manageMembers: false, manageChannels: false, manageMessages: false, postMessages: true } },
  { key: "mentor", name: "Mentor", permissions: { manageRoles: false, manageMembers: false, manageChannels: false, manageMessages: false, postMessages: true } },
  { key: "verified", name: "Verified", permissions: { manageRoles: false, manageMembers: false, manageChannels: false, manageMessages: false, postMessages: true } },
];

const GROUP_PERMISSION_KEYS = ["manageRoles", "manageMembers", "manageChannels", "manageMessages", "postMessages"];

const parsePermissions = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const hasGroupPermission = (group, permission, platformRole) => {
  if (platformRole === "admin" || group?.groupRole === "admin") return true;
  const permissions = parsePermissions(group?.rolePermissions);
  if (typeof permissions[permission] === "boolean") return permissions[permission];
  return group?.groupRole === "member" && permission === "postMessages";
};

const normalizeGroupPermissions = (value) => Object.fromEntries(
  GROUP_PERMISSION_KEYS.map((key) => [key, value?.[key] === true])
);

const ensureBuiltInGroupRoles = async (executor, groupId) => {
  for (const role of BUILT_IN_GROUP_ROLES) {
    await executor.execute(
      `INSERT IGNORE INTO group_roles (group_id, role_key, name, permissions, is_system)
       VALUES (?, ?, ?, ?, TRUE)`,
      [groupId, role.key, role.name, JSON.stringify(role.permissions)]
    );
  }
};

module.exports = {
  BUILT_IN_GROUP_ROLES,
  GROUP_PERMISSION_KEYS,
  ensureBuiltInGroupRoles,
  hasGroupPermission,
  normalizeGroupPermissions,
  parsePermissions,
};
