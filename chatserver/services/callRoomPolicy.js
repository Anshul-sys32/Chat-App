const MAX_CALL_PARTICIPANTS = 8;
const MAX_MESH_PARTICIPANTS = 4;

const canInviteToCallRoom = (room, actorId, recipientId) => {
  if (!room || String(room.hostId) !== String(actorId)) return { allowed: false, reason: "not-host" };
  if (room.participants.has(String(recipientId))) return { allowed: true, reason: "already-joined" };
  if (room.participants.size >= MAX_CALL_PARTICIPANTS) return { allowed: false, reason: "full" };
  return { allowed: true, reason: null };
};

const canNegotiateCallRoomOffer = (room, actorId, recipientId) => {
  if (!room) return { allowed: false, reason: "not-in-room" };
  if (String(room.hostId) === String(actorId)) return canInviteToCallRoom(room, actorId, recipientId);
  if (room.mode === "sfu") return { allowed: false, reason: "mesh-disabled" };
  if (room.participants.has(String(actorId)) && room.participants.has(String(recipientId))) {
    return { allowed: true, reason: "mesh" };
  }
  return { allowed: false, reason: "not-participant" };
};

const shouldUpgradeCallRoomToSfu = (room) =>
  room?.mode === "mesh" && room.acceptedParticipants?.size > MAX_MESH_PARTICIPANTS;

const canJoinSfuCallRoom = (room, userId) =>
  Boolean(room?.mode === "sfu" && room.participants.has(String(userId)));

const matchesCallRoomScope = (room, group, channel = null) => {
  if (!room?.groupId || !group || Number(room.groupId) !== Number(group.id)
    || room.groupType !== group.groupType) return false;
  if (group.groupType === "standard") return room.channelId === null;
  return group.groupType === "community"
    && channel
    && Number(channel.id) === Number(room.channelId)
    && channel.channelType === room.callType;
};

module.exports = {
  MAX_CALL_PARTICIPANTS,
  MAX_MESH_PARTICIPANTS,
  canInviteToCallRoom,
  canNegotiateCallRoomOffer,
  canJoinSfuCallRoom,
  matchesCallRoomScope,
  shouldUpgradeCallRoomToSfu,
};
