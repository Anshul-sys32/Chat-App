const { pool } = require("../config/db");
const { getGroupAccess, canAccessGroup, canManageGroup } = require("../services/groupAccess");
const { BUILT_IN_GROUP_ROLES, GROUP_PERMISSION_KEYS, normalizeGroupPermissions } = require("../services/groupRoles");

const validId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const toRoleKey = (value) => String(value || "").normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "")
  .slice(0, 40);

const resolveRoleManager = async (groupId, user) => {
  const group = await getGroupAccess(groupId, user.id);
  if (!group) return { status: 404, message: "Group not found." };
  if (!canAccessGroup(group, user.role) || !canManageGroup(group, "manageRoles", user.role)) {
    return { status: 403, message: "You do not have permission to manage roles in this group." };
  }
  return { group };
};

const listGroupRoles = async (req, res) => {
  const groupId = Number(req.params.groupId);
  if (!validId(groupId)) return res.status(400).json({ message: "Invalid group id." });
  try {
    const group = await getGroupAccess(groupId, req.user.id);
    if (!group) return res.status(404).json({ message: "Group not found." });
    if (!canAccessGroup(group, req.user.role)) return res.status(403).json({ message: "You are not a member of this group." });
    const [roles] = await pool.execute(
      `SELECT role_key AS roleKey, name, permissions, is_system AS isSystem
       FROM group_roles WHERE group_id = ? ORDER BY is_system DESC, name`,
      [groupId]
    );
    return res.json({ roles });
  } catch (error) {
    console.error("List group roles error:", error);
    return res.status(500).json({ message: "Could not load group roles." });
  }
};

const createGroupRole = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const roleKey = toRoleKey(req.body?.roleKey || name);
  const permissionInput = req.body?.permissions;
  if (!validId(groupId) || !name || name.length > 60 || !roleKey
    || !permissionInput || typeof permissionInput !== "object" || Array.isArray(permissionInput)
    || Object.keys(permissionInput).some((key) => !GROUP_PERMISSION_KEYS.includes(key)
      || typeof permissionInput[key] !== "boolean")) {
    return res.status(400).json({ message: "Provide a role name and supported boolean permissions." });
  }
  if (BUILT_IN_GROUP_ROLES.some((role) => role.key === roleKey)) {
    return res.status(409).json({ message: "That role key is reserved." });
  }
  try {
    const access = await resolveRoleManager(groupId, req.user);
    if (access.status) return res.status(access.status).json({ message: access.message });
    const [result] = await pool.execute(
      "INSERT INTO group_roles (group_id, role_key, name, permissions, is_system) VALUES (?, ?, ?, ?, FALSE)",
      [groupId, roleKey, name, JSON.stringify(normalizeGroupPermissions(permissionInput))]
    );
    const role = { _id: result.insertId, roleKey, name, permissions: normalizeGroupPermissions(permissionInput), isSystem: 0 };
    req.app.get("io")?.to(`group:${groupId}`).emit("group-roles-updated", { groupId });
    return res.status(201).json(role);
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "A role with that name already exists." });
    console.error("Create group role error:", error);
    return res.status(500).json({ message: "Could not create this role." });
  }
};

const updateGroupRole = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const roleKey = String(req.params.roleKey || "");
  const updates = req.body || {};
  const name = updates.name === undefined ? undefined : String(updates.name).trim();
  const permissions = updates.permissions;
  if (!validId(groupId) || !roleKey || Object.keys(updates).some((key) => !["name", "permissions"].includes(key))
    || name !== undefined && (!name || name.length > 60)
    || permissions !== undefined && (!permissions || typeof permissions !== "object" || Array.isArray(permissions)
      || Object.keys(permissions).some((key) => !GROUP_PERMISSION_KEYS.includes(key) || typeof permissions[key] !== "boolean"))) {
    return res.status(400).json({ message: "Provide a valid role name or permission set." });
  }
  if (name === undefined && permissions === undefined) return res.status(400).json({ message: "Provide role changes." });
  try {
    const access = await resolveRoleManager(groupId, req.user);
    if (access.status) return res.status(access.status).json({ message: access.message });
    const [rows] = await pool.execute(
      "SELECT role_key AS roleKey, name, permissions, is_system AS isSystem FROM group_roles WHERE group_id = ? AND role_key = ? LIMIT 1",
      [groupId, roleKey]
    );
    if (!rows.length) return res.status(404).json({ message: "Role not found." });
    if (rows[0].isSystem) return res.status(409).json({ message: "Built-in roles cannot be edited." });
    const nextPermissions = permissions === undefined
      ? rows[0].permissions
      : JSON.stringify(normalizeGroupPermissions({
        ...((typeof rows[0].permissions === "string" ? JSON.parse(rows[0].permissions) : rows[0].permissions) || {}),
        ...permissions,
      }));
    await pool.execute(
      "UPDATE group_roles SET name = COALESCE(?, name), permissions = ? WHERE group_id = ? AND role_key = ?",
      [name ?? null, nextPermissions, groupId, roleKey]
    );
    req.app.get("io")?.to(`group:${groupId}`).emit("group-roles-updated", { groupId });
    return res.json({ ...rows[0], name: name ?? rows[0].name, permissions: permissions === undefined ? rows[0].permissions : normalizeGroupPermissions(permissions) });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "A role with that name already exists." });
    console.error("Update group role error:", error);
    return res.status(500).json({ message: "Could not update this role." });
  }
};

const deleteGroupRole = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const roleKey = String(req.params.roleKey || "");
  if (!validId(groupId) || !roleKey) return res.status(400).json({ message: "Invalid group or role." });
  try {
    const access = await resolveRoleManager(groupId, req.user);
    if (access.status) return res.status(access.status).json({ message: access.message });
    const [roles] = await pool.execute(
      "SELECT is_system AS isSystem FROM group_roles WHERE group_id = ? AND role_key = ? LIMIT 1",
      [groupId, roleKey]
    );
    if (!roles.length) return res.status(404).json({ message: "Role not found." });
    if (roles[0].isSystem) return res.status(409).json({ message: "Built-in roles cannot be deleted." });
    const [[{ assignmentCount }]] = await pool.execute(
      "SELECT COUNT(*) AS assignmentCount FROM group_members WHERE group_id = ? AND role = ?",
      [groupId, roleKey]
    );
    if (Number(assignmentCount)) return res.status(409).json({ message: "Reassign members before deleting this role." });
    await pool.execute(
      `DELETE permission FROM community_channel_role_permissions permission
       JOIN group_channels channel ON channel.id = permission.channel_id
       WHERE channel.group_id = ? AND permission.role_key = ?`,
      [groupId, roleKey]
    );
    await pool.execute("DELETE FROM group_roles WHERE group_id = ? AND role_key = ?", [groupId, roleKey]);
    req.app.get("io")?.to(`group:${groupId}`).emit("group-roles-updated", { groupId });
    return res.status(204).end();
  } catch (error) {
    console.error("Delete group role error:", error);
    return res.status(500).json({ message: "Could not delete this role." });
  }
};

module.exports = { createGroupRole, deleteGroupRole, listGroupRoles, updateGroupRole };
