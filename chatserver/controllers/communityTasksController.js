const { pool } = require("../config/db");
const { canAccessGroup, canManageGroup, getActiveChannel, getGroupAccess } = require("../services/groupAccess");

const TASK_STATUSES = new Set(["todo", "in_progress", "done"]);
const parseTaskInput = (body = {}, { partial = false } = {}) => {
  const title = body.title === undefined && partial ? undefined : typeof body.title === "string" ? body.title.trim() : "";
  const description = body.description === undefined && partial ? undefined : typeof body.description === "string" ? body.description.trim() : "";
  const status = body.status;
  const dueAt = body.dueAt === undefined ? undefined : body.dueAt === null || body.dueAt === "" ? null : Date.parse(body.dueAt);
  const assignedTo = body.assignedTo === undefined ? undefined : body.assignedTo === null || body.assignedTo === "" ? null : Number(body.assignedTo);
  const linkedMessageId = body.linkedMessageId === undefined ? undefined : body.linkedMessageId === null || body.linkedMessageId === "" ? null : Number(body.linkedMessageId);
  if (title !== undefined && (!title || title.length > 160)) return { error: "Task titles must be 1 to 160 characters." };
  if (description !== undefined && description.length > 3000) return { error: "Task descriptions must be 3,000 characters or shorter." };
  if (status !== undefined && !TASK_STATUSES.has(status)) return { error: "Choose a valid task status." };
  if (dueAt !== undefined && dueAt !== null && !Number.isFinite(dueAt)) return { error: "Choose a valid due date." };
  if (assignedTo !== undefined && assignedTo !== null && (!Number.isSafeInteger(assignedTo) || assignedTo < 1)) return { error: "Choose a valid assignee." };
  if (linkedMessageId !== undefined && linkedMessageId !== null && (!Number.isSafeInteger(linkedMessageId) || linkedMessageId < 1)) return { error: "Choose a valid discussion message." };
  if (!partial && title === undefined) return { error: "Task title is required." };
  return {
    title,
    description,
    status,
    dueAt: dueAt === undefined || dueAt === null ? dueAt : new Date(dueAt).toISOString().slice(0, 19).replace("T", " "),
    assignedTo,
    linkedMessageId,
  };
};

const resolveCommunity = async (groupId, user) => {
  const group = await getGroupAccess(groupId, user.id);
  if (!group || !canAccessGroup(group, user.role)) return { status: 404, message: "Community not found." };
  if (group.groupType !== "community") return { status: 400, message: "Task boards are only available in communities." };
  return { group };
};

const validateTaskReferences = async (groupId, channelId, assignedTo, linkedMessageId) => {
  if (assignedTo !== undefined && assignedTo !== null) {
    const [members] = await pool.execute(
      "SELECT user_id FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1",
      [groupId, assignedTo]
    );
    if (!members.length) return { status: 400, message: "Assignees must belong to this community." };
  }
  if (linkedMessageId !== undefined && linkedMessageId !== null) {
    const [messages] = await pool.execute(
      `SELECT id FROM group_messages
       WHERE id = ? AND group_id = ? AND is_deleted = FALSE AND channel_id <=> ? LIMIT 1`,
      [linkedMessageId, groupId, channelId]
    );
    if (!messages.length) return { status: 400, message: "Link a message from this community channel." };
  }
  return {};
};

const listCommunityTasks = async (req, res) => {
  const groupId = Number(req.params.groupId);
  if (!Number.isSafeInteger(groupId) || groupId < 1) return res.status(400).json({ message: "Invalid community id." });
  try {
    const authorized = await resolveCommunity(groupId, req.user);
    if (authorized.status) return res.status(authorized.status).json({ message: authorized.message });
    const [tasks] = await pool.execute(
      `SELECT task.id, task.channel_id AS channelId, task.created_by AS createdBy,
              channel.name AS channelName,
              creator.username AS creatorName, task.assigned_to AS assignedTo,
              assignee.username AS assigneeName, task.linked_message_id AS linkedMessageId,
              task.title, task.description, task.due_at AS dueAt, task.status,
              task.created_at AS createdAt, task.updated_at AS updatedAt
       FROM community_tasks task
       JOIN users creator ON creator.id = task.created_by
       LEFT JOIN users assignee ON assignee.id = task.assigned_to
      LEFT JOIN group_channels channel ON channel.id = task.channel_id
       WHERE task.group_id = ?
       ORDER BY FIELD(task.status, 'todo', 'in_progress', 'done'), task.due_at IS NULL, task.due_at, task.id DESC
       LIMIT 200`,
      [groupId]
    );
    const [members] = await pool.execute(
      `SELECT member.user_id AS id, member_user.username
       FROM group_members member JOIN users member_user ON member_user.id = member.user_id
       WHERE member.group_id = ? AND member_user.status = 'active' ORDER BY member_user.username`,
      [groupId]
    );
    return res.json({ tasks, members });
  } catch (error) {
    console.error("List community tasks error:", error);
    return res.status(500).json({ message: "Could not load community tasks." });
  }
};

const createCommunityTask = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const channelId = req.body?.channelId === undefined || req.body?.channelId === null ? null : Number(req.body.channelId);
  const task = parseTaskInput(req.body);
  if (!Number.isSafeInteger(groupId) || groupId < 1
    || channelId !== null && (!Number.isSafeInteger(channelId) || channelId < 1)) {
    return res.status(400).json({ message: "Invalid community or channel." });
  }
  if (task.error) return res.status(400).json({ message: task.error });
  try {
    const authorized = await resolveCommunity(groupId, req.user);
    if (authorized.status) return res.status(authorized.status).json({ message: authorized.message });
    if (channelId !== null && !await getActiveChannel(groupId, channelId)) return res.status(404).json({ message: "Channel not found." });
    const referenceError = await validateTaskReferences(groupId, channelId, task.assignedTo, task.linkedMessageId);
    if (referenceError.status) return res.status(referenceError.status).json({ message: referenceError.message });
    const [result] = await pool.execute(
      `INSERT INTO community_tasks
       (group_id, channel_id, created_by, assigned_to, linked_message_id, title, description, due_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'todo')`,
      [groupId, channelId, req.user.id, task.assignedTo ?? null, task.linkedMessageId ?? null,
        task.title, task.description || "", task.dueAt ?? null]
    );
    const [rows] = await pool.execute(
      `SELECT task.id, task.channel_id AS channelId, task.created_by AS createdBy,
              channel.name AS channelName,
              creator.username AS creatorName, task.assigned_to AS assignedTo,
              assignee.username AS assigneeName, task.linked_message_id AS linkedMessageId,
              task.title, task.description, task.due_at AS dueAt, task.status,
              task.created_at AS createdAt, task.updated_at AS updatedAt
      FROM community_tasks task JOIN users creator ON creator.id = task.created_by
      LEFT JOIN group_channels channel ON channel.id = task.channel_id
       LEFT JOIN users assignee ON assignee.id = task.assigned_to WHERE task.id = ?`,
      [result.insertId]
    );
    const created = rows[0];
    req.app.get("io")?.to(`group:${groupId}`).emit("community-task-updated", { groupId, task: created });
    return res.status(201).json({ task: created });
  } catch (error) {
    console.error("Create community task error:", error);
    return res.status(500).json({ message: "Could not create this task." });
  }
};

const updateCommunityTask = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const taskId = Number(req.params.taskId);
  if (!Number.isSafeInteger(groupId) || groupId < 1 || !Number.isSafeInteger(taskId) || taskId < 1) {
    return res.status(400).json({ message: "Invalid community task." });
  }
  const task = parseTaskInput(req.body, { partial: true });
  if (task.error) return res.status(400).json({ message: task.error });
  const channelId = req.body?.channelId === undefined ? undefined : req.body.channelId === null ? null : Number(req.body.channelId);
  if (channelId !== undefined && channelId !== null && (!Number.isSafeInteger(channelId) || channelId < 1)) {
    return res.status(400).json({ message: "Invalid channel." });
  }
  try {
    const authorized = await resolveCommunity(groupId, req.user);
    if (authorized.status) return res.status(authorized.status).json({ message: authorized.message });
    const [existingRows] = await pool.execute(
      "SELECT id, created_by AS createdBy, assigned_to AS assignedTo, channel_id AS channelId FROM community_tasks WHERE id = ? AND group_id = ? LIMIT 1",
      [taskId, groupId]
    );
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ message: "Task not found." });
    const manager = canManageGroup(authorized.group, "manageMessages", req.user.role);
    const canEdit = Number(existing.createdBy) === Number(req.user.id)
      || Number(existing.assignedTo) === Number(req.user.id) || manager;
    if (!canEdit) return res.status(403).json({ message: "Only the task creator, assignee, or a community manager can update this task." });
    const nextChannelId = channelId === undefined ? existing.channelId : channelId;
    if (channelId !== undefined && channelId !== null && !await getActiveChannel(groupId, channelId)) {
      return res.status(404).json({ message: "Channel not found." });
    }
    const referenceError = await validateTaskReferences(
      groupId,
      nextChannelId,
      task.assignedTo === undefined ? undefined : task.assignedTo,
      task.linkedMessageId === undefined ? undefined : task.linkedMessageId
    );
    if (referenceError.status) return res.status(referenceError.status).json({ message: referenceError.message });
    await pool.execute(
      `UPDATE community_tasks SET
         title = COALESCE(?, title), description = COALESCE(?, description),
         status = COALESCE(?, status), due_at = IF(? = 1, ?, due_at),
         assigned_to = IF(? = 1, ?, assigned_to),
         linked_message_id = IF(? = 1, ?, linked_message_id),
         channel_id = IF(? = 1, ?, channel_id)
       WHERE id = ? AND group_id = ?`,
      [task.title ?? null, task.description ?? null, task.status ?? null,
        task.dueAt !== undefined ? 1 : 0, task.dueAt ?? null,
        task.assignedTo !== undefined ? 1 : 0, task.assignedTo ?? null,
        task.linkedMessageId !== undefined ? 1 : 0, task.linkedMessageId ?? null,
        channelId !== undefined ? 1 : 0, channelId ?? null, taskId, groupId]
    );
    const [rows] = await pool.execute(
      `SELECT task.id, task.channel_id AS channelId, task.created_by AS createdBy,
              channel.name AS channelName,
              creator.username AS creatorName, task.assigned_to AS assignedTo,
              assignee.username AS assigneeName, task.linked_message_id AS linkedMessageId,
              task.title, task.description, task.due_at AS dueAt, task.status,
              task.created_at AS createdAt, task.updated_at AS updatedAt
       FROM community_tasks task JOIN users creator ON creator.id = task.created_by
      LEFT JOIN group_channels channel ON channel.id = task.channel_id
       LEFT JOIN users assignee ON assignee.id = task.assigned_to
       WHERE task.id = ?`,
      [taskId]
    );
    const updated = rows[0];
    req.app.get("io")?.to(`group:${groupId}`).emit("community-task-updated", { groupId, task: updated });
    return res.json({ task: updated });
  } catch (error) {
    console.error("Update community task error:", error);
    return res.status(500).json({ message: "Could not update this task." });
  }
};

const deleteCommunityTask = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const taskId = Number(req.params.taskId);
  if (!Number.isSafeInteger(groupId) || groupId < 1 || !Number.isSafeInteger(taskId) || taskId < 1) {
    return res.status(400).json({ message: "Invalid community task." });
  }
  try {
    const authorized = await resolveCommunity(groupId, req.user);
    if (authorized.status) return res.status(authorized.status).json({ message: authorized.message });
    const [tasks] = await pool.execute(
      "SELECT created_by AS createdBy FROM community_tasks WHERE id = ? AND group_id = ? LIMIT 1",
      [taskId, groupId]
    );
    if (!tasks.length) return res.status(404).json({ message: "Task not found." });
    if (Number(tasks[0].createdBy) !== Number(req.user.id) && !canManageGroup(authorized.group, "manageMessages", req.user.role)) {
      return res.status(403).json({ message: "Only the task creator or a community manager can delete this task." });
    }
    await pool.execute("DELETE FROM community_tasks WHERE id = ? AND group_id = ?", [taskId, groupId]);
    req.app.get("io")?.to(`group:${groupId}`).emit("community-task-deleted", { groupId, taskId });
    return res.status(204).end();
  } catch (error) {
    console.error("Delete community task error:", error);
    return res.status(500).json({ message: "Could not delete this task." });
  }
};

module.exports = { createCommunityTask, deleteCommunityTask, listCommunityTasks, parseTaskInput, updateCommunityTask };
